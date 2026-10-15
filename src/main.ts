// Boot and app flow: title → solo setup or Host/Join → lobby → match → results. One renderer and one map
// scene are shared. A match is always a Session: solo runs locally, multiplayer runs through ClientSession
// (the host's own player too, over an in-memory loopback to the HostServer running in this tab).
import './fonts.css';
import './styles.css';
import { Matrix4, Vector3, type Object3D } from 'three';
import { env } from './core/env';
import { createDesktopInput } from './core/input';
import { createLoop } from './core/loop';
import { createPlayerControls } from './core/playerControls';
import { createAutoQuality, initialLevel, QUALITY, type QualityLevel } from './core/quality';
import { getSettings, onSettingsChange } from './core/settings';
import { loadGameData } from './data';
import type { GameData } from './data/types';
import { leadPoint } from './game/ballistics';
import type { ControlInput } from './game/controls';
import { speedKmh, type PlaneState } from './game/flight';
import { dirFromYawPitch, FORWARD, rotate } from './game/math';
import { createWorldContext, type GameEvent } from './game/world';
import { createSoloSession, type RenderPose, type Session } from './app/session';
import { createClientSession, type ClientSession } from './net/clientSession';
import { createFakeNetwork, type FakeNetwork } from './net/fakeTransport';
import { deviceInfo } from './net/hostAdvice';
import { createHostServer, type HostOptions, type HostServer } from './net/hostServer';
import { iceServers, turnConfigured } from './net/ice';
import { makeRoomCode, parseRoomCode, shareLink } from './net/roomCode';
import { combineHosts, type Network } from './net/transport';
import { createLobby, createNetMenu, createNetOverlay, type LobbyView } from './ui/netScreens';
import { createChaseCamera } from './render/chaseCamera';
import { createEffects } from './render/effects';
import { createMapScene } from './render/mapScene';
import { createPlaneVisual, isModelReady, loadEra, loadPlane, type PlaneVisual } from './render/models';
import { planeSize } from './game/planeModels';
import { createView } from './render/renderer';
import { createTitleShot } from './render/titleShot';
import { createTracers } from './render/tracers';
import { showDataErrors } from './ui/errorOverlay';
import { createFpsCounter } from './ui/fps';
import { createHud, escapeHtml as esc, type Hud, type Marker, type ScoreRow } from './ui/hud';
import { showResults } from './ui/results';
import { openSettings } from './ui/settingsPanel';
import { createSoloSetup, type SoloChoice } from './ui/soloSetup';
import { createHangarUi } from './ui/hangar';
import { createTitleScreen } from './ui/title';
import { createTouchControls, type TouchControls } from './ui/touchControls';

const KILLCAM_S = 3;
const RESULTS_DELAY_S = 2.5;

function boot(): void {
  const canvasEl = document.querySelector<HTMLCanvasElement>('#game');
  const uiEl = document.querySelector<HTMLElement>('#ui');
  if (!canvasEl || !uiEl) throw new Error('index.html is missing #game or #ui');
  const canvas: HTMLCanvasElement = canvasEl;
  const ui: HTMLElement = uiEl;

  const result = loadGameData();
  if (!result.ok) {
    showDataErrors(ui, result.errors);
    return;
  }
  const data: GameData = result.data;
  const map = data.maps.find((m) => m.default) ?? data.maps[0];
  if (!map) throw new Error('maps.json has no maps');
  if (env.isTouch) document.body.classList.add('has-touch');

  const settings = getSettings();
  const params = new URLSearchParams(window.location.search);
  const gfxParam = params.get('gfx');
  const forced: QualityLevel | null = gfxParam === 'low' || gfxParam === 'medium' || gfxParam === 'high' ? gfxParam : null;
  // Debug-only knobs for testing: run the clock faster, or shorten the match.
  const timeScale = env.debug ? Math.max(1, Math.min(20, Math.round(Number(params.get('timescale')) || 1))) : 1;
  const matchTime = env.debug ? Number(params.get('matchtime')) || undefined : undefined;

  const view = createView(canvas, { antialias: !env.isTouch && settings.graphics !== 'low' && forced !== 'low' });
  const ctx = createWorldContext(data, map.id);
  const mapScene = createMapScene(map, ctx.terrain);
  const titleShot = createTitleShot(mapScene.scene, ctx.terrain);
  const tracers = createTracers(data.guns);
  mapScene.scene.add(tracers.mesh);
  const effects = createEffects();
  mapScene.scene.add(effects.mesh);

  let quality: QualityLevel = forced ?? initialLevel(settings.graphics, env.isTouch);
  const applyQuality = (level: QualityLevel): void => {
    quality = level;
    view.setMaxPixelRatio(QUALITY[level].maxPixelRatio);
    mapScene.setQuality(level, view.renderer, view.camera);
    effects.density = level === 'low' ? 0.5 : 1;
  };
  applyQuality(quality);
  let auto = !forced && settings.graphics === 'auto' ? createAutoQuality((level) => applyQuality(level)) : null;
  onSettingsChange((s) => {
    if (forced) return;
    if (s.graphics === 'auto') auto = createAutoQuality((level) => applyQuality(level));
    else {
      auto = null;
      applyQuality(s.graphics);
    }
  });

  const controls = createPlayerControls();
  const sensitivity = (): number => getSettings().sensitivity;
  const desktop = createDesktopInput(canvas, controls, sensitivity);
  const chase = createChaseCamera(view.camera);

  // --- App state ---
  type Mode = 'title' | 'setup' | 'hangar' | 'netmenu' | 'hostsetup' | 'lobby' | 'match' | 'results';
  let mode: Mode = 'title';
  let screen: { dispose(): void } | null = null;
  let session: Session | null = null;
  let lastChoice: SoloChoice | null = null;
  let hud: Hud | null = null;
  let touch: TouchControls | null = null;
  let netOverlay: ReturnType<typeof createNetOverlay> | null = null;
  const visuals = new Map<string, PlaneVisual>();
  const pose: RenderPose = { pos: [0, 0, 0], quat: [0, 0, 0, 1] };
  const frameEvents: GameEvent[] = [];
  let wasAlive = true;
  let deathAt = 0;
  let killerId: string | null = null;
  let endedAt = 0;
  let clock = 0;

  /** Multiplayer state while hosting or joined, from the lobby to the end of the match. */
  interface NetState {
    isHost: boolean;
    code: string;
    client: ClientSession;
    /** Host only: the authoritative match, and the zero-delay loopback that carries our own player. */
    server: HostServer | null;
    loop: FakeNetwork | null;
    close(): void;
  }
  let net: NetState | null = null;
  let lobbyView: LobbyView | null = null;
  // When this tab was last hidden: a phone that was locked loses the connection itself, so "Host left" would be wrong.
  let hiddenAt = -Infinity;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = performance.now();
  });
  // Bumped whenever the player navigates away, so a slow connect that finishes later is thrown away.
  let netAttempt = 0;

  const playerId = (): string => session?.playerId ?? '';
  const player = (): PlaneState | null => session?.world.planes.find((p) => p.id === playerId()) ?? null;
  const pilotName = (id: string | null): string => (id ? session?.world.pilots[id]?.name ?? id : '');
  const planeName = (id: string): string => ctx.planeDefs.get(id)?.name ?? id;
  const eraName = (id: string): string => data.eras.find((e) => e.id === id)?.name ?? id;

  const clearScreen = (): void => {
    screen?.dispose();
    screen = null;
  };

  const leaveMatch = (): void => {
    desktop.setEnabled(false);
    hud?.dispose();
    hud = null;
    touch?.dispose();
    touch = null;
    netOverlay?.dispose();
    netOverlay = null;
    for (const v of visuals.values()) mapScene.scene.remove(v.root);
    visuals.clear();
    if (session?.kind === 'solo') session.dispose();
    session = null;
    endedAt = 0;
    mapScene.shadowTarget = null;
    document.body.classList.remove('is-flying');
  };

  const closeNet = (): void => {
    netAttempt++;
    if (!net) return;
    const n = net;
    net = null;
    n.close();
  };

  function showTitle(): void {
    leaveMatch();
    closeNet();
    clearScreen();
    mode = 'title';
    titleShot.setVisible(true);
    screen = createTitleScreen(ui, env.version, {
      onSolo: showSetup,
      onHostJoin: () => showNetMenu(null),
      onSettings: () => openSettings(ui, { isTouch: env.isTouch }),
    });
  }

  function showSetup(): void {
    clearScreen();
    mode = 'setup';
    screen = createSoloSetup(ui, data, { allUnlocked: env.debug }, { onStart: startSolo, onBack: showTitle, onHangar: showHangar });
  }

  // --- Multiplayer: Host / Join menu, host setup, lobby.
  const signal = ((): { host: string; port: number; secure: boolean } | null => {
    // A local PeerJS signaling server for the browser tests (?debug=1&signal=localhost:9187).
    const m = (env.debug ? params.get('signal') : null)?.match(/^([\w.-]+):(\d+)$/);
    return m ? { host: m[1]!, port: Number(m[2]), secure: m[1] !== 'localhost' && window.location.protocol === 'https:' } : null;
  })();

  /** PeerJS is only downloaded when someone hosts or joins, so solo stays small and fully offline. */
  async function peerNetwork(): Promise<{ network: Network; mod: typeof import('./net/peerTransport') }> {
    const [mod, ice] = await Promise.all([import('./net/peerTransport'), iceServers()]);
    return { mod, network: mod.createPeerNetwork({ iceServers: ice, ...(signal ? { signal } : {}) }) };
  }

  const clientEvents = (): Parameters<typeof createClientSession>[3] => ({
    onWelcome: () => {
      if (mode === 'netmenu') showLobby();
    },
    onLobby: (players, era) => lobbyView?.update(players, eraName(era)),
    onStart: (s) => enterMatch(s),
    onReject: (reason) => showNetMenu(net?.code ?? null, reason),
    onClosed: () => {
      // During a match the session reports "host left" itself, and the loop shows the results.
      if (mode === 'lobby' || mode === 'netmenu') showNetMenu(net?.isHost ? null : (net?.code ?? null), 'The host closed the room.');
    },
  });

  function showNetMenu(room: string | null, error?: string): ReturnType<typeof createNetMenu> {
    leaveMatch();
    closeNet();
    clearScreen();
    mode = 'netmenu';
    titleShot.setVisible(true);
    const menu = createNetMenu(ui, { room, turn: turnConfigured() }, {
      onBack: showTitle,
      onHost: showHostSetup,
      onJoin: (code, callsign) => void joinRoom(code, callsign, menu),
    });
    if (error) menu.setStatus(error, true);
    screen = menu;
    return menu;
  }

  function showHostSetup(callsign: string): void {
    clearScreen();
    mode = 'hostsetup';
    screen = createSoloSetup(
      ui,
      data,
      {
        allUnlocked: env.debug,
        title: 'Host a match',
        intro: 'Pick the era and your plane. Friends fly planes from the same era, and bots fill the empty seats of a 10 vs 10 Team Deathmatch.',
        startLabel: 'Create room',
        hangar: false,
      },
      { onStart: (choice) => void hostRoom(choice, callsign), onBack: () => showNetMenu(null), onHangar: () => {} },
    );
  }

  /** Until Day 6's plane picker: friends get a random plane within a tier of the host's. */
  const friendPlane = (choice: SoloChoice): string => {
    const mine = ctx.planeDefs.get(choice.planeId);
    const pool = data.planes.filter((p) => p.era === choice.era && (!mine || Math.abs(p.tier - mine.tier) <= 1));
    return pool[Math.floor(Math.random() * pool.length)]?.id ?? choice.planeId;
  };

  async function hostRoom(choice: SoloChoice, callsign: string): Promise<void> {
    const menu = showNetMenu(null);
    const attempt = netAttempt;
    menu.setBusy(true);
    menu.setStatus('Creating a room…');
    lastChoice = choice;
    try {
      const { mod, network } = await peerNetwork();
      let peerHost: Awaited<ReturnType<Network['host']>> | null = null;
      let code = '';
      for (let i = 0; i < 5 && !peerHost; i++) {
        code = makeRoomCode();
        try {
          peerHost = await network.host(code);
        } catch (err) {
          if (!(err instanceof mod.RoomTakenError)) throw err;
        }
      }
      if (!peerHost) throw new Error('no free room code');
      const loop = createFakeNetwork();
      const loopHost = await loop.host(code);
      if (attempt !== netAttempt) {
        peerHost.close();
        return;
      }
      const transport = combineHosts(code, [peerHost, loopHost]);
      const opts: HostOptions = {
        version: env.version,
        era: choice.era,
        mapId: map!.id,
        difficulty: choice.difficulty,
        planeFor: (i) => (i === 0 ? choice.planeId : friendPlane(choice)),
        ...(matchTime ? { timeLimitS: matchTime } : {}),
      };
      const server = createHostServer(ctx, transport, opts);
      const loopClient = await loop.join(code);
      opts.hostPeerId = loopClient.id;
      const client = createClientSession(loopClient, data, { version: env.version, callsign, device: deviceInfo() }, clientEvents());
      net = {
        isHost: true,
        code,
        client,
        server,
        loop,
        close: () => {
          client.dispose();
          server.close();
        },
      };
      showLobby();
    } catch (err) {
      if (attempt !== netAttempt) return;
      console.warn('Hosting failed', err);
      menu.setBusy(false);
      menu.setStatus("Couldn't create a room. Check your internet connection and try again.", true);
    }
  }

  async function joinRoom(code: string, callsign: string, menu: ReturnType<typeof createNetMenu>): Promise<void> {
    const attempt = netAttempt;
    menu.setBusy(true);
    menu.setStatus(`Connecting to room ${code}…`);
    let notFound: (new (...a: never[]) => Error) | null = null;
    try {
      const { mod, network } = await peerNetwork();
      notFound = mod.RoomNotFoundError;
      const transport = await network.join(code);
      if (attempt !== netAttempt) {
        transport.close();
        return;
      }
      const client = createClientSession(transport, data, { version: env.version, callsign, device: deviceInfo() }, clientEvents());
      net = { isHost: false, code, client, server: null, loop: null, close: () => client.dispose() };
      window.setTimeout(() => {
        if (net?.client === client && client.phase === 'connecting') showNetMenu(code, 'The host did not answer. Check the code and try again.');
      }, 10_000);
    } catch (err) {
      if (attempt !== netAttempt) return;
      console.warn('Joining failed', err);
      menu.setBusy(false);
      menu.setStatus(
        notFound && err instanceof notFound
          ? `Room ${code} not found. Check the code, and make sure the host's screen is on.`
          : "Couldn't connect. Check your internet connection and try again.",
        true,
      );
    }
  }

  function showLobby(): void {
    const n = net;
    if (!n) return;
    clearScreen();
    mode = 'lobby';
    titleShot.setVisible(true);
    const view = createLobby(ui, { isHost: n.isHost, code: n.code, link: shareLink(n.code) }, {
      onStart: () => n.server?.start(),
      onLeave: () => showNetMenu(null),
    });
    if (n.client.lobbyPlayers.length > 0) view.update(n.client.lobbyPlayers, lastChoice && n.isHost ? eraName(lastChoice.era) : '');
    if (n.isHost) view.setStatus('Keep this tab open and on screen while you host: the match runs in your browser.');
    lobbyView = view;
    screen = {
      dispose: () => {
        view.dispose();
        if (lobbyView === view) lobbyView = null;
      },
    };
  }

  // --- Hangar: the selected plane parked high above the islands, orbited by the camera.
  const HANGAR_POS = new Vector3(0, 3400, 0);
  const hangar = { visual: null as PlaneVisual | null, planeId: '', team: 'blue' as PlaneState['team'], yaw: 2.4, pitch: 0.25, dist: 22, touched: false };
  const setHangarVisual = (): void => {
    if (hangar.visual) mapScene.scene.remove(hangar.visual.root);
    const v = createPlaneVisual(hangar.planeId, hangar.team);
    v.root.position.copy(HANGAR_POS);
    mapScene.scene.add(v.root);
    hangar.visual = v;
  };
  const leaveHangar = (): void => {
    if (hangar.visual) mapScene.scene.remove(hangar.visual.root);
    hangar.visual = null;
  };

  function showHangar(choice: SoloChoice): void {
    clearScreen();
    mode = 'hangar';
    titleShot.setVisible(false);
    const plane = ctx.planeDefs.get(choice.planeId)!;
    const size = planeSize(plane);
    Object.assign(hangar, { planeId: plane.id, team: 'blue', yaw: 2.4, pitch: 0.25, dist: Math.max(size.lengthM, size.wingspanM) * 1.7, touched: false });
    setHangarVisual();
    void loadPlane(plane.id);
    const ui2 = createHangarUi(ui, plane, data, {
      onRotate: (dx, dy) => {
        hangar.touched = true;
        hangar.yaw -= dx * 0.01;
        hangar.pitch = Math.max(-1.2, Math.min(1.2, hangar.pitch + dy * 0.01));
      },
      onZoom: (f) => {
        hangar.dist = Math.max(size.lengthM * 0.8, Math.min(size.lengthM * 4, hangar.dist * f));
      },
      onTeam: (team) => {
        hangar.team = team;
        setHangarVisual();
      },
      onBack: () => {
        leaveHangar();
        titleShot.setVisible(true);
        showSetup();
      },
    });
    screen = ui2;
  }

  function renderHangar(frameDt: number): void {
    if (hangar.visual?.placeholder && isModelReady(hangar.planeId)) setHangarVisual();
    if (!hangar.touched) hangar.yaw += frameDt * 0.25;
    const v = hangar.visual;
    if (v?.prop) v.prop.rotation.z += frameDt * 6;
    const cp = Math.cos(hangar.pitch);
    view.camera.position.set(
      HANGAR_POS.x + Math.sin(hangar.yaw) * cp * hangar.dist,
      HANGAR_POS.y + Math.sin(hangar.pitch) * hangar.dist,
      HANGAR_POS.z + Math.cos(hangar.yaw) * cp * hangar.dist,
    );
    view.camera.lookAt(HANGAR_POS);
    if (view.camera.fov !== 45) {
      view.camera.fov = 45;
      view.camera.updateProjectionMatrix();
    }
  }

  function startSolo(choice: SoloChoice): void {
    closeNet();
    lastChoice = choice;
    enterMatch(
      createSoloSession(ctx, {
        era: choice.era,
        planeId: choice.planeId,
        difficulty: choice.difficulty,
        assist: env.isTouch ? getSettings().aimAssist : 0,
        ...(matchTime ? { timeLimitS: matchTime } : {}),
      }),
    );
  }

  /** Fly a match, solo or networked. */
  function enterMatch(s: Session): void {
    clearScreen();
    leaveMatch();
    session = s;
    titleShot.setVisible(false);
    mode = 'match';
    document.body.classList.add('is-flying');
    const me = player();
    const mine = me ? ctx.planeDefs.get(me.planeId) : undefined;
    // Only this match's era models are downloaded.
    const era = mine?.era ?? lastChoice?.era;
    if (era) void loadEra(era, data.planes.filter((p) => p.era === era).map((p) => p.id));
    chase.setScale(mine ? planeSize(mine).lengthM / 9 : 1);
    if (me) controls.resetTo(me);
    controls.freeLook = false;
    chase.reset();
    wasAlive = true;
    killerId = null;
    hud = createHud(ui, {
      onMenu: showTitle,
      onScores: (open) => hud?.setScoreboard(open ? scoreRows() : null),
    });
    if (env.isTouch) {
      touch = createTouchControls(ui, controls, sensitivity);
      if (me) touch.setPlane(me);
    }
    if (env.debug && s.net) netOverlay = createNetOverlay(ui);
    desktop.setEnabled(true);
  }

  function endMatch(): void {
    const s = session;
    if (!s) return;
    const m = s.world.match;
    const rows = scoreRows();
    const yourTeam = s.world.pilots[s.playerId]?.team ?? 'blue';
    const hostLeft = s.ended === 'hostLeft';
    const weLeft = hostLeft && (document.hidden || performance.now() - hiddenAt < 20_000);
    const wasNet = s.kind === 'net';
    leaveMatch();
    closeNet();
    mode = 'results';
    screen = showResults(
      ui,
      {
        winner: hostLeft ? null : m.winner,
        score: m.score,
        rows,
        yourTeam,
        ...(hostLeft ? { title: weLeft ? 'Connection lost' : 'Host left' } : {}),
        ...(wasNet ? { againLabel: 'Play with friends' } : {}),
      },
      {
        onAgain: () => (wasNet ? showNetMenu(null) : lastChoice ? startSolo(lastChoice) : showSetup()),
        onTitle: showTitle,
      },
    );
  }

  function scoreRows(): ScoreRow[] {
    if (!session) return [];
    const w = session.world;
    const me = session.playerId;
    return Object.values(w.pilots)
      .map((p) => {
        const st = w.stats[p.id] ?? { kills: 0, deaths: 0, assists: 0, damage: 0 };
        const plane = w.planes.find((x) => x.id === p.id);
        return { name: p.name, team: p.team, plane: plane ? planeName(plane.planeId) : '', ...st, you: p.id === me };
      })
      .sort((a, b) => (a.team === b.team ? b.kills - a.kills || b.damage - a.damage : a.team === 'blue' ? -1 : 1));
  }

  // Tab holds the scoreboard open on desktop.
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Tab' || mode !== 'match') return;
    e.preventDefault();
    if (!hud?.scoreboardOpen) hud?.setScoreboard(scoreRows());
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Tab' && mode === 'match') hud?.setScoreboard(null);
  });

  /** The plane's visual: the placeholder until its model has loaded, then the real model. */
  const ensureVisual = (p: PlaneState): PlaneVisual => {
    let v = visuals.get(p.id);
    if (!v || (v.placeholder && isModelReady(p.planeId))) {
      if (v) mapScene.scene.remove(v.root);
      v = createPlaneVisual(p.planeId, p.team);
      visuals.set(p.id, v);
      mapScene.scene.add(v.root);
    }
    return v;
  };
  const ensureMesh = (p: PlaneState): Object3D => ensureVisual(p).root;

  // Scratch objects reused every frame.
  const va = new Vector3();
  const vb = new Vector3();
  const vc = new Vector3();
  const aimVec = new Vector3();
  const lookVec = new Vector3();
  const proj = new Vector3();
  const camInv = new Matrix4();
  const toScreen = (p: Vector3): { x: number; y: number } | null => {
    proj.copy(p).project(view.camera);
    if (proj.z > 1 || proj.z < -1) return null;
    return { x: (proj.x * 0.5 + 0.5) * window.innerWidth, y: (-proj.y * 0.5 + 0.5) * window.innerHeight };
  };
  const smokeAcc = new Map<string, number>();

  const handleEvents = (): void => {
    if (!session || !hud) {
      frameEvents.length = 0;
      return;
    }
    const w = session.world;
    const me = player();
    const myId = playerId();
    for (const e of frameEvents) {
      if (e.t === 'explode') {
        effects.explosion(e.pos[0], e.pos[1], e.pos[2]);
        if (me && vc.set(e.pos[0], e.pos[1], e.pos[2]).distanceTo(view.camera.position) < 250) chase.shake(0.5);
      } else if (e.t === 'hit') {
        effects.emit('spark', e.pos[0], e.pos[1], e.pos[2]);
        if (e.shooter === myId) hud.hitMarker(false);
        if (e.victim === myId) {
          chase.shake(0.15);
          const attacker = w.planes.find((p) => p.id === e.shooter);
          if (attacker) {
            camInv.copy(view.camera.matrixWorld).invert();
            vc.set(attacker.pos[0], attacker.pos[1], attacker.pos[2]).applyMatrix4(camInv);
            hud.damageFrom(Math.atan2(vc.x, vc.y));
          }
        }
      } else if (e.t === 'kill') {
        const victim = w.pilots[e.victim];
        const killer = e.killer ? w.pilots[e.killer] : null;
        const tag = (p: { name: string; team: string } | null | undefined): string => (p ? `<b class="t-${p.team}">${esc(p.name)}</b>` : '');
        const html = killer ? `${tag(killer)} shot down ${tag(victim)}` : `${tag(victim)} crashed`;
        const mine = e.killer === myId || e.victim === myId || e.assists.includes(myId);
        hud.killFeed(html, mine);
        if (e.killer === myId) hud.hitMarker(true);
        if (e.victim === myId) {
          killerId = e.killer;
          deathAt = w.time;
        }
      }
    }
    frameEvents.length = 0;
  };

  const fps = env.debug ? createFpsCounter(ui) : null;
  let fpsAvg = 0;

  // Host: bytes/s sent to every peer, for the debug overlay.
  let hostOut = { at: 0, bytes: 0, perS: 0 };
  const netLines = (s: Session): string[] => {
    const st = s.net;
    if (!st) return [];
    const kb = (b: number): string => `${(b / 1024).toFixed(1)} KB/s`;
    const lines = [
      `ping ${st.pingMs === null ? '…' : Math.round(st.pingMs)} ms · loss ${(st.loss * 100).toFixed(1)}%`,
      `snapshots ${st.snapshotsPerS.toFixed(1)}/s`,
      `in ${kb(st.bytesInPerS)} · out ${kb(st.bytesOutPerS)}`,
    ];
    const server = net?.server;
    if (server) {
      if (clock - hostOut.at >= 1) {
        hostOut = { at: clock, bytes: server.counters.bytesOut, perS: (server.counters.bytesOut - hostOut.bytes) / Math.max(1e-3, clock - hostOut.at) };
      }
      lines.push(`host up ${kb(hostOut.perS)} to ${Math.max(0, server.lobby().length)} players`);
    }
    return lines;
  };

  /** Host only: let the loopback deliver, then run one authoritative tick. */
  const tickHost = (dt: number): void => {
    if (!net?.server) return;
    net.loop?.advance(dt * 1000);
    net.server.tick(dt);
  };

  const loop = createLoop({
    update(dt) {
      clock += dt;
      if (net && mode !== 'match') {
        tickHost(dt);
        net?.client.idle(dt);
      }
      if (mode !== 'match' || !session) return;
      const s = session;
      // ?timescale speeds up solo only; a network match runs in real time.
      const steps = s.kind === 'solo' ? timeScale : 1;
      for (let step = 0; step < steps; step++) {
        const me = player();
        let input: ControlInput | null = null;
        if (me?.alive) {
          controls.fire = desktop.buttons.fire || (touch?.buttons.fire ?? false);
          controls.missile = desktop.buttons.missile || (touch?.buttons.missile ?? false);
          controls.flare = desktop.buttons.flare || (touch?.buttons.flare ?? false);
          input = controls.sample(me, dt);
        }
        frameEvents.push(...s.step(dt, input));
        tickHost(dt);
        if (session !== s) return; // a network event ended the match mid-step
        const after = player();
        if (after && after.alive && !wasAlive) {
          controls.resetTo(after);
          chase.reset();
          touch?.setPlane(after);
        }
        wasAlive = after?.alive ?? false;
        if (s.ended === 'hostLeft') {
          endMatch();
          return;
        }
        if (s.ended === 'finished' && endedAt === 0) endedAt = clock;
      }
      if (endedAt > 0 && clock - endedAt > RESULTS_DELAY_S) endMatch();
    },
    render(alpha, frameDt) {
      fpsAvg = fpsAvg === 0 ? 1 / frameDt : fpsAvg * 0.95 + (1 / Math.max(frameDt, 1e-3)) * 0.05;
      if (mode === 'hangar') {
        renderHangar(frameDt);
        tracers.update([], 0, 0, view.camera.position);
      } else if (mode !== 'match' || !session) {
        titleShot.update(clock, frameDt, view.camera);
        tracers.update([], 0, 0, view.camera.position);
      } else {
        renderMatch(session, alpha, frameDt);
        if (netOverlay && Math.floor(clock * 2) !== Math.floor((clock - frameDt) * 2)) netOverlay.update(netLines(session));
      }
      effects.update(frameDt);
      mapScene.update(clock, view.camera);
      view.renderer.render(mapScene.scene, view.camera);
      fps?.frame(frameDt);
      auto?.frame(frameDt);
    },
  });

  function renderMatch(s: Session, alpha: number, frameDt: number): void {
    const w = s.world;
    const me = player();
    const myId = s.playerId;
    desktop.update(frameDt, me);
    touch?.sync();
    handleEvents();

    for (const p of w.planes) {
      const visual = ensureVisual(p);
      const mesh = visual.root;
      mesh.visible = p.alive || p.wreck;
      if (!mesh.visible) continue;
      if (s.pose(p.id, alpha, pose)) {
        mesh.position.fromArray(pose.pos);
        mesh.quaternion.fromArray(pose.quat);
      }
      mesh.updateMatrixWorld();
      // Props spin with throttle (a wreck's windmills slowly).
      if (visual.prop) visual.prop.rotation.z += frameDt * (p.alive ? 12 + 55 * p.throttle : 4);
      // Muzzle flashes at every gun muzzle while firing.
      if (p.firing && visual.muzzles.length > 0) {
        for (const mz of visual.muzzles) {
          mz.getWorldPosition(vc);
          effects.emit('muzzle', vc.x, vc.y, vc.z);
        }
      }
      // Smoke from damaged engines, fire, and falling wrecks, out of the exhausts when the model has them.
      const rate = (p.wreck ? 40 : (p.fireFor > 0 ? 30 : 0) + (p.damaged.engine ? 18 : 0)) * effects.density;
      if (rate > 0) {
        let acc = (smokeAcc.get(p.id) ?? 0) + rate * frameDt;
        const ex = visual.exhausts[0];
        if (ex) ex.getWorldPosition(vc);
        else {
          const f = rotate(p.quat, FORWARD);
          vc.set(mesh.position.x - f[0] * 3, mesh.position.y - f[1] * 3, mesh.position.z - f[2] * 3);
        }
        while (acc >= 1) {
          acc -= 1;
          effects.emit(p.fireFor > 0 || (p.wreck && Math.random() < 0.4) ? 'fire' : p.wreck ? 'darkSmoke' : 'smoke', vc.x, vc.y, vc.z);
        }
        smokeAcc.set(p.id, acc);
      }
    }
    tracers.update(w.bullets, 1 - alpha, 1 / 60, view.camera.position);
    if (!me) return;

    const meMesh = ensureMesh(me);
    mapScene.shadowTarget = meMesh;
    const sinceDeath = w.time - deathAt;
    let deathView: { phase: 'killcam' | 'respawn'; killer: string | null; respawnIn: number } | null = null;

    if (me.alive) {
      aimVec.fromArray(controls.aimDir());
      let freeDir: Vector3 | null = null;
      if (controls.freeLook) {
        lookVec.fromArray(dirFromYawPitch(controls.aim.yaw + controls.look.yaw, controls.aim.pitch + controls.look.pitch));
        freeDir = lookVec;
      }
      chase.update(frameDt, meMesh.position, aimVec, speedKmh(me) / 3.6, freeDir);
    } else {
      // Killcam: hang near where we went down and watch the killer for 3 s, then the respawn screen.
      const killer = killerId ? w.planes.find((p) => p.id === killerId && p.alive) : null;
      const focus = killer ? ensureMesh(killer).position : meMesh.position;
      va.copy(meMesh.position).add(vb.set(0, 30, 0));
      view.camera.position.lerp(va, 1 - Math.exp(-2 * frameDt));
      view.camera.lookAt(focus);
      deathView = { phase: sinceDeath < KILLCAM_S ? 'killcam' : 'respawn', killer: killerId ? pilotName(killerId) : null, respawnIn: me.respawnIn };
    }

    // HUD data.
    const nose = rotate(me.quat, FORWARD);
    const def = ctx.planeDefs.get(me.planeId)!;
    const mv = ctx.guns.get(def.guns[0]?.type ?? '')?.muzzleVelocityMs ?? 800;
    const markers: Marker[] = [];
    const dots: { x: number; z: number; team: PlaneState['team'] }[] = [];
    let leadScreen: { x: number; y: number } | null = null;
    let bestAngle = 0.45; // ~25° from the aim
    let leadTarget: PlaneState | null = null;
    const aimDir = controls.aimDir();
    for (const p of w.planes) {
      if (p.id === myId || !p.alive) continue;
      dots.push({ x: p.pos[0] / ctx.terrain.half, z: p.pos[2] / ctx.terrain.half, team: p.team });
      const mesh = ensureMesh(p);
      const dist = mesh.position.distanceTo(view.camera.position);
      const enemy = p.team !== me.team;
      if (dist < (enemy ? 5000 : 2500)) {
        const s = toScreen(vc.copy(mesh.position).add(vb.set(0, 4, 0)));
        if (s) markers.push({ x: s.x, y: s.y, team: p.team, enemy, distM: dist });
      }
      if (enemy && me.alive) {
        const dx = p.pos[0] - me.pos[0], dy = p.pos[1] - me.pos[1], dz = p.pos[2] - me.pos[2];
        const d = Math.hypot(dx, dy, dz);
        if (d < 1500) {
          const angle = Math.acos(Math.max(-1, Math.min(1, (dx * aimDir[0] + dy * aimDir[1] + dz * aimDir[2]) / d)));
          if (angle < bestAngle) {
            bestAngle = angle;
            leadTarget = p;
          }
        }
      }
    }
    if (leadTarget) {
      const lp = leadPoint(me.pos, me.vel, leadTarget.pos, leadTarget.vel, mv);
      // Draw relative to the interpolated mesh so it doesn't jitter between ticks.
      const tm = ensureMesh(leadTarget);
      leadScreen = toScreen(vc.set(lp[0] - leadTarget.pos[0], lp[1] - leadTarget.pos[1], lp[2] - leadTarget.pos[2]).add(tm.position));
    }
    const aimScreen = me.alive ? toScreen(va.copy(meMesh.position).addScaledVector(aimVec.fromArray(aimDir), 1500)) : null;
    const noseScreen = me.alive ? toScreen(vb.copy(meMesh.position).add(vc.set(nose[0], nose[1], nose[2]).multiplyScalar(1500))) : null;
    const hint = env.isTouch || desktop.pointerLocked || desktop.gamepadConnected
      ? ''
      : desktop.cursorSteering
        ? 'Hold the cursor where you want to fly. Click or Space fires, Tab shows scores'
        : 'Click to steer with the mouse. Space fires, W/S throttle, Tab shows scores';

    hud?.update({
      speedKmh: speedKmh(me),
      altitudeM: me.pos[1],
      throttle: me.throttle,
      g: me.g,
      stalled: me.stalled,
      edgeWarning: me.edgeWarning,
      autoTurn: me.autoTurn,
      alive: me.alive,
      hp: me.hp,
      maxHp: me.maxHp,
      damaged: me.damaged,
      onFire: me.fireFor > 0,
      protectedFor: me.protectedFor,
      ammo: def.guns.map((g, i) => ({ label: ctx.guns.get(g.type)?.name.split(' ').slice(0, 2).join(' ') ?? g.type, rounds: me.ammo[i] ?? 0 })),
      aim: aimScreen,
      nose: noseScreen,
      lead: leadScreen,
      markers,
      map: { x: me.pos[0] / ctx.terrain.half, z: me.pos[2] / ctx.terrain.half, heading: Math.atan2(-nose[0], nose[2]) },
      mapDots: dots,
      score: w.match.score,
      timeLeftS: w.match.timeLeftS,
      killLimit: w.match.killLimit,
      freeLook: controls.freeLook,
      hint,
      death: deathView,
    });
    if (hud?.scoreboardOpen && Math.floor(clock * 2) !== Math.floor((clock - frameDt) * 2)) hud.setScoreboard(scoreRows());
  }

  showTitle();
  // A share link (?room=CODE) goes straight to the join screen.
  if (env.room) showNetMenu(parseRoomCode(env.room) ?? env.room.slice(0, 4).toUpperCase());
  loop.start();
  // The title plane becomes a real Spitfire as soon as its model arrives.
  void loadPlane('spitfire_mk5').then(() => {
    if (isModelReady('spitfire_mk5')) titleShot.setModel(createPlaneVisual('spitfire_mk5', 'blue').root);
  });
  document.body.dataset['ready'] = 'true';

  if (env.debug) {
    // Test and debugging hooks (Playwright reads these). Only with ?debug=1.
    (window as unknown as { __rvbs: unknown }).__rvbs = {
      mode: () => mode,
      models: () => [...visuals.values()].map((v) => ({ placeholder: v.placeholder, muzzles: v.muzzles.length, prop: v.prop !== null })),
      hangar: () => (mode === 'hangar' ? { planeId: hangar.planeId, placeholder: hangar.visual?.placeholder ?? true, yaw: hangar.yaw } : null),
      startSolo: (choice?: Partial<SoloChoice>) =>
        startSolo({ era: 'early_ww2', planeId: 'spitfire_mk5', difficulty: 'normal', ...choice }),
      match: () => {
        if (!session || mode !== 'match') return null;
        const w = session.world;
        return { state: w.match.state, score: { ...w.match.score }, timeLeftS: w.match.timeLeftS, planes: w.planes.length, bullets: w.bullets.length };
      },
      net: () =>
        net
          ? {
              isHost: net.isHost,
              code: net.code,
              phase: net.client.phase,
              playerId: net.client.playerId,
              lobby: net.client.lobbyPlayers.map((p) => p.name),
              stats: session?.net ? { ...session.net } : null,
            }
          : null,
      /** Other human players' planes as this browser sees them (the multiplayer test compares these). */
      humans: () => {
        if (!session || mode !== 'match') return [];
        const w = session.world;
        const me = session.playerId;
        return w.planes
          .filter((p) => p.id !== me && w.pilots[p.id] && !w.pilots[p.id]!.bot)
          .map((p) => ({ id: p.id, name: w.pilots[p.id]!.name, pos: [...p.pos], alive: p.alive }));
      },
      aim: () => ({ ...controls.aim }),
      player: () => {
        const p = player();
        return p ? (JSON.parse(JSON.stringify(p)) as PlaneState) : null;
      },
      quality: () => quality,
      fps: () => fpsAvg,
      drawCalls: () => view.renderer.info.render.calls,
      triangles: () => view.renderer.info.render.triangles,
      terrainChunks: () => mapScene.stats.terrainChunks,
      heightAt: (x: number, z: number) => ctx.terrain.heightAt(x, z),
      camera: () => view.camera.position.toArray(),
    };
  }
}

function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch((err: unknown) => {
      console.warn('Service worker registration failed', err);
    });
  });
}

boot();
registerServiceWorker();
