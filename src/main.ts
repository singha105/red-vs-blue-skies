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
import { dirFromYawPitch, FORWARD, normalize, quatLookRotation, rotate } from './game/math';
import { createWorldContext, newStats, type GameEvent, type WorldContext } from './game/world';
import { computeResults } from './game/results';
import { createSilhouettes } from './render/silhouettes';
import { createRespawnPicker, type RespawnPicker } from './ui/respawn';
import { createRoomView, type RoomView } from './ui/roomScreens';
import { createSoloSession, type RenderPose, type Session } from './app/session';
import { createClientSession, type ClientSession } from './net/clientSession';
import { createFakeNetwork, type FakeNetwork } from './net/fakeTransport';
import { deviceInfo } from './net/hostAdvice';
import { createHostServer, type HostOptions, type HostServer } from './net/hostServer';
import { iceServers, turnConfigured } from './net/ice';
import { makeRoomCode, parseRoomCode, shareLink } from './net/roomCode';
import { combineHosts, type Network } from './net/transport';
import { createCallsignScreen, createConnecting, createNetMenu, createNetOverlay, saveCallsign, savedCallsign, type StatusScreen } from './ui/netScreens';
import { createChaseCamera } from './render/chaseCamera';
import { createEffects } from './render/effects';
import { createMissileFx, type GlowSource } from './render/missiles';
import { createPylonMissiles } from './render/pylonMissiles';
import { createCockpitAudio } from './core/audio';
import { cockpitState, cycleTarget, targetAt } from './app/weapons';
import { afterburner, launch as launchMissile } from './game/missiles';
import { createMapScene } from './render/mapScene';
import { createGroundRenderer } from './render/groundUnits';
import { bomberFor, isBomber, unitDef } from './game/objectives';
import type { ObjectiveFrame, ObjectiveMarker } from './ui/hud';
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
import { createProfileStore } from './profile/store';
import { openResearch } from './ui/research';
import { openLeaderboard } from './ui/leaderboard';
import type { AccountControls } from './ui/settingsPanel';
import type { EraId } from './data/types';
import type { MatchResults } from './game/results';

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
  const tracers = createTracers(data.guns);
  const effects = createEffects();
  const missileFx = createMissileFx(effects);
  const missileClass = new Map(data.missiles.missiles.map((m) => [m.id, m.class]));
  const pylonMissiles = createPylonMissiles((type) => missileClass.get(type));
  const ground = createGroundRenderer(effects);
  const audio = createCockpitAudio(() => getSettings().volume);
  const silhouettes = createSilhouettes(view.renderer);
  // One scene per map, built the first time a match is voted onto it and kept (at most 4), so switching back is free.
  interface MapWorld {
    ctx: WorldContext;
    scene: ReturnType<typeof createMapScene>;
    titleShot: ReturnType<typeof createTitleShot>;
  }
  const mapWorlds = new Map<string, MapWorld>();
  let titlePlane: (() => Object3D) | null = null;
  const buildMap = (mapId: string): MapWorld => {
    let mw = mapWorlds.get(mapId);
    if (!mw) {
      const c = createWorldContext(data, mapId);
      const scene = createMapScene(c.map, c.terrain);
      mw = { ctx: c, scene, titleShot: createTitleShot(scene.scene, c.terrain) };
      if (titlePlane) mw.titleShot.setModel(titlePlane());
      mapWorlds.set(mapId, mw);
    }
    return mw;
  };
  let current = buildMap(map.id);
  let ctx: WorldContext = current.ctx;
  let mapScene = current.scene;
  let titleShot = current.titleShot;
  mapScene.scene.add(tracers.mesh, effects.mesh, missileFx.root, pylonMissiles.root, ground.root);

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

  /** Switch the scene to another map (the voted one) before a match starts there. */
  const useMap = (mapId: string): void => {
    if (ctx.map.id === mapId || !data.maps.some((m) => m.id === mapId)) return;
    const visible = !document.body.classList.contains('is-flying');
    titleShot.setVisible(false);
    current = buildMap(mapId);
    ctx = current.ctx;
    mapScene = current.scene;
    titleShot = current.titleShot;
    titleShot.setVisible(visible);
    mapScene.scene.add(tracers.mesh, effects.mesh, missileFx.root, pylonMissiles.root, ground.root);
    applyQuality(quality);
  };

  const controls = createPlayerControls();
  const sensitivity = (): number => getSettings().sensitivity;
  const desktop = createDesktopInput(canvas, controls, sensitivity);
  const chase = createChaseCamera(view.camera);

  // --- App state ---
  type Mode = 'title' | 'setup' | 'hangar' | 'callsign' | 'netmenu' | 'connecting' | 'room' | 'match' | 'results';
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

  /** Multiplayer state while hosting or joined: the room, then match after match on the same connection. */
  interface NetState {
    isHost: boolean;
    code: string;
    client: ClientSession;
    /** Host only: the authoritative room and match, and the zero-delay loopback that carries our own player. */
    server: HostServer | null;
    loop: FakeNetwork | null;
    close(): void;
  }
  let net: NetState | null = null;
  let roomView: RoomView | null = null;
  let respawn: RespawnPicker | null = null;
  let callsign = savedCallsign();
  // Progress: profile, research points and unlocks (Firebase, with an offline queue). Loads in the background.
  const profile = createProfileStore({ callsign: savedCallsign });
  /** What this player tells the host: everything earned (team balancing), unlocks, and the uid. */
  let sentProfile = '';
  const helloProfile = () => {
    sentProfile = JSON.stringify([profile.earned(), profile.profile.unlocked]);
    return { rp: profile.earned(), uid: profile.uid, unlocked: profile.profile.unlocked };
  };
  profile.onChange(() => {
    // A second device picks up the callsign saved on the account.
    if (!savedCallsign() && profile.status === 'online') {
      saveCallsign(profile.profile.callsign);
      callsign = profile.profile.callsign;
    }
    // Bought an unlock or saved RP between rounds: tell the host, so plane select and balancing see it.
    const n = net;
    const key = JSON.stringify([profile.earned(), profile.profile.unlocked]);
    if (n && key !== sentProfile && n.client.phase !== 'connecting') {
      sentProfile = key;
      n.client.request({ t: 'profile', rp: profile.earned(), unlocked: profile.profile.unlocked });
    }
  });
  const accountControls: AccountControls = {
    describe() {
      const a = profile.account;
      if (profile.status === 'off') return 'Progress is saved on this device.';
      if (!a) return profile.status === 'connecting' ? 'Connecting…' : "Offline. Progress is kept on this device and syncs when you're back online.";
      return a.anonymous ? 'Guest account: progress is saved online, but only on this device until you link Google.' : `Linked to Google${a.email ? ` (${a.email})` : ''}. Sign in with it on any device.`;
    },
    canLink: () => profile.account?.anonymous === true,
    link: () => profile.linkGoogle(),
    onChange: (fn) => profile.onChange(fn),
  };
  let overlay: { dispose(): void } | null = null;
  const closeOverlay = (): void => {
    overlay?.dispose();
    overlay = null;
  };
  const showResearch = (era?: EraId, onClose?: () => void): void => {
    closeOverlay();
    overlay = openResearch(ui, {
      data,
      store: profile,
      silhouettes,
      ...(era ? { era } : {}),
      onClose: () => {
        overlay = null;
        onClose?.();
      },
    });
  };
  const profileLine = (): string => {
    const p = profile.profile;
    const pending = profile.pendingRp;
    const state = profile.status === 'offline' ? ' · offline' : profile.status === 'connecting' ? ' · connecting…' : '';
    return `<b>${esc(callsign || p.callsign)}</b> · ${p.rp.toLocaleString('en')} RP${pending > 0 ? ` <small>(+${pending.toLocaleString('en')} syncing)</small>` : ''}${state}`;
  };
  /** Save this player's row of a network match (host's results, or our own count if the host left). */
  const recordNetMatch = (r: MatchResults, me: string): void => {
    const client = net?.client;
    const matchId = client?.matchId ?? lastNetMatch.id;
    lastNetMatch.id = profile.recordMatch(matchId, r.rows.find((x) => x.id === me), r.winner, client?.participants ? [...client.participants] : []);
  };
  const lastNetMatch: { id: string | null } = { id: null };
  // When this tab was last hidden: a phone that was locked loses the connection itself, so "Host left" would be wrong.
  let hiddenAt = -Infinity;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) hiddenAt = performance.now();
  });
  // Bumped whenever the player navigates away, so a slow connect that finishes later is thrown away.
  let netAttempt = 0;

  const playerId = (): string => session?.playerId ?? '';
  const player = (): PlaneState | null => session?.world.planes.find((p) => p.id === playerId()) ?? null;
  const pilotName = (id: string | null): string => {
    if (!id || !session) return '';
    const pilot = session.world.pilots[id];
    if (pilot) return pilot.name;
    // Ground units shoot as "u<index>".
    const unit = id.startsWith('u') ? session.world.objectives.units[Number(id.slice(1))] : undefined;
    return unit ? (unit.kind === 'aa' ? 'an AA gun' : `${unitDef(session.ctx, unit.kind).name} AA fire`) : id;
  };
  const planeName = (id: string): string => ctx.planeDefs.get(id)?.name ?? id;

  const clearScreen = (): void => {
    closeOverlay();
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
    respawn?.dispose();
    respawn = null;
    for (const v of visuals.values()) mapScene.scene.remove(v.root);
    visuals.clear();
    visualPlane.clear();
    if (session?.kind === 'solo') session.dispose();
    session = null;
    endedAt = 0;
    controls.target = null;
    missileFx.clear();
    pylonMissiles.clear();
    ground.clear();
    audio.mute();
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
    const title = createTitleScreen(ui, env.version, {
      onSolo: showSetup,
      onHostJoin: () => showCallsign(null),
      onSettings: () => openSettings(ui, { isTouch: env.isTouch, account: accountControls }),
      onResearch: () => showResearch(),
      onLeaderboard: () => {
        closeOverlay();
        overlay = openLeaderboard(ui, profile, () => (overlay = null));
      },
    });
    title.setProfile(profileLine());
    const off = profile.onChange(() => title.setProfile(profileLine()));
    screen = {
      dispose: () => {
        off();
        title.dispose();
      },
    };
  }

  function showSetup(): void {
    clearScreen();
    mode = 'setup';
    screen = createSoloSetup(
      ui,
      data,
      { unlocks: () => profile.unlocks() },
      { onStart: startSolo, onBack: showTitle, onHangar: showHangar, onResearch: (era) => showResearch(era, showSetup) },
    );
  }

  // --- Multiplayer: callsign → Host / Join → room (lobby, vote, teams, plane select, results).
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
      if (mode === 'connecting') showRoom();
    },
    onRoom: (room) => {
      // Get the voted map and era ready while people pick planes.
      if (room.choice) {
        const era = room.choice.era;
        void loadEra(era, data.planes.filter((p) => p.era === era).map((p) => p.id));
        if (mode === 'room') useMap(room.choice.mapId);
      }
      if (mode === 'room' && net) roomView?.update(room, net.client.results);
    },
    onResults: (r) => {
      if (net) recordNetMatch(r, net.client.playerId);
      if (mode === 'room' && net?.client.room) roomView?.update(net.client.room, r);
    },
    onChat: (line) => {
      if (net) roomView?.chat(net.client.chat);
      if (mode === 'match' && hud) hud.killFeed(`<b class="t-${line.team ?? 'none'}">${esc(line.from)}</b> ${esc(line.text)}`, false);
    },
    onStart: (s) => {
      lastNetMatch.id = null;
      useMap(s.world.mapId);
      enterMatch(s);
    },
    onReject: (reason) => showNetMenu(net?.isHost ? null : (net?.code ?? null), reason),
    onClosed: () => {
      // During a match the session reports "host left" itself, and the loop shows the results.
      if (mode === 'room' || mode === 'connecting') showNetMenu(net?.isHost ? null : (net?.code ?? null), 'The host closed the room.');
    },
  });

  function showCallsign(room: string | null): void {
    leaveMatch();
    closeNet();
    clearScreen();
    mode = 'callsign';
    titleShot.setVisible(true);
    screen = createCallsignScreen(ui, { room }, {
      onBack: showTitle,
      onContinue: (cs) => {
        callsign = cs;
        profile.setCallsign(cs);
        if (room) void joinRoom(room);
        else showNetMenu(null);
      },
    });
  }

  function showNetMenu(room: string | null, error?: string): StatusScreen {
    leaveMatch();
    closeNet();
    clearScreen();
    mode = 'netmenu';
    titleShot.setVisible(true);
    const menu = createNetMenu(ui, { room, turn: turnConfigured(), callsign: callsign || 'Pilot' }, {
      onBack: () => showCallsign(null),
      onHost: () => void hostRoom(),
      onJoin: (code) => void joinRoom(code),
    });
    if (error) menu.setStatus(error, true);
    screen = menu;
    return menu;
  }

  function showConnecting(text: string, room: string | null): StatusScreen {
    leaveMatch();
    closeNet();
    clearScreen();
    mode = 'connecting';
    titleShot.setVisible(true);
    const s = createConnecting(ui, text, () => showNetMenu(room));
    screen = s;
    return s;
  }

  async function hostRoom(): Promise<void> {
    const status = showConnecting('Creating a room…', null);
    const attempt = netAttempt;
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
        settings: { difficulty: 'normal', bots: true, matchLengthS: 600 },
        allUnlocked: env.allUnlocked,
        record: profile.recorder,
        ...(matchTime ? { matchTimeS: matchTime } : {}),
      };
      const server = createHostServer(data, transport, opts);
      const loopClient = await loop.join(code);
      opts.hostPeerId = loopClient.id;
      const client = createClientSession(loopClient, data, { version: env.version, callsign, device: deviceInfo(), ...helloProfile() }, clientEvents());
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
      showRoom();
    } catch (err) {
      if (attempt !== netAttempt) return;
      console.warn('Hosting failed', err);
      status.setStatus("Couldn't create a room. Check your internet connection and try again.", true);
    }
  }

  async function joinRoom(code: string): Promise<void> {
    const status = showConnecting(`Connecting to room ${code}…`, code);
    const attempt = netAttempt;
    let notFound: (new (...a: never[]) => Error) | null = null;
    try {
      const { mod, network } = await peerNetwork();
      notFound = mod.RoomNotFoundError;
      const transport = await network.join(code);
      if (attempt !== netAttempt) {
        transport.close();
        return;
      }
      const client = createClientSession(transport, data, { version: env.version, callsign, device: deviceInfo(), ...helloProfile() }, clientEvents());
      net = { isHost: false, code, client, server: null, loop: null, close: () => client.dispose() };
      window.setTimeout(() => {
        if (net?.client === client && client.phase === 'connecting') showNetMenu(code, 'The host did not answer. Check the code and try again.');
      }, 10_000);
    } catch (err) {
      if (attempt !== netAttempt) return;
      console.warn('Joining failed', err);
      status.setStatus(
        notFound && err instanceof notFound
          ? `Room ${code} not found. Check the code, and make sure the host's screen is on.`
          : "Couldn't connect. Check your internet connection and try again.",
        true,
      );
    }
  }

  function showRoom(): void {
    const n = net;
    if (!n) return;
    clearScreen();
    mode = 'room';
    titleShot.setVisible(true);
    const server = n.server;
    const view = createRoomView(ui, {
      data,
      code: n.code,
      link: shareLink(n.code),
      meId: () => n.client.playerId,
      timeLeftMs: () => n.client.timeLeftMs(),
      request: (m) => n.client.request(m),
      host: server
        ? {
            startVote: () => server.startVote(),
            override: (cat, id) => server.override(cat, id),
            setSettings: (st) => server.setSettings(st),
            kick: (id) => server.kick(id),
            playAgain: () => server.playAgain(),
          }
        : null,
      silhouettes,
      onLeave: () => showNetMenu(null),
      onResearch: () => showResearch(n.client.room?.choice?.era),
      saveNote: () => profile.saveText(lastNetMatch.id),
    });
    if (n.client.room) {
      if (n.client.room.choice) useMap(n.client.room.choice.mapId);
      view.update(n.client.room, n.client.results);
    }
    view.chat(n.client.chat);
    roomView = view;
    screen = {
      dispose: () => {
        view.dispose();
        if (roomView === view) roomView = null;
      },
    };
  }

  // --- Hangar: the selected plane parked high above the islands, orbited by the camera.
  const HANGAR_POS = new Vector3(0, 3400, 0);
  const hangarCarrier = [{ id: 'hangar', planeId: '', alive: true, missiles: [] as number[], rockets: 0, bombs: 0 }];
  const hangar = { visual: null as PlaneVisual | null, planeId: '', team: 'blue' as PlaneState['team'], yaw: 2.4, pitch: 0.25, dist: 22, touched: false };
  const setHangarVisual = (): void => {
    if (hangar.visual) mapScene.scene.remove(hangar.visual.root);
    const v = createPlaneVisual(hangar.planeId, hangar.team);
    v.root.position.copy(HANGAR_POS);
    v.root.updateMatrixWorld();
    mapScene.scene.add(v.root);
    hangar.visual = v;
  };
  const leaveHangar = (): void => {
    if (hangar.visual) mapScene.scene.remove(hangar.visual.root);
    hangar.visual = null;
    pylonMissiles.clear();
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
    hangarCarrier[0]!.planeId = plane.id;
    hangarCarrier[0]!.missiles = plane.missiles.map((m) => m.count);
    hangarCarrier[0]!.rockets = plane.ordnance?.rockets ?? 0;
    hangarCarrier[0]!.bombs = plane.ordnance?.bombs ?? 0;
    if (plane.missiles.length > 0 || plane.ordnance) void pylonMissiles.load();
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
    // The full missile load on the pylons.
    if (v) pylonMissiles.update(hangarCarrier, ctx.planeDefs, () => (v.placeholder ? null : v.root));
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
    useMap(data.maps.some((m) => m.id === choice.map) ? choice.map! : map!.id);
    enterMatch(
      createSoloSession(ctx, {
        era: choice.era,
        planeId: choice.planeId,
        difficulty: choice.difficulty,
        mode: data.modes.find((m) => m.id === choice.mode && m.playable)?.id ?? 'tdm',
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
    // Weapon models only for eras whose planes carry missiles, rockets or bombs.
    if (era && data.planes.some((p) => p.era === era && (p.missiles.length > 0 || p.ordnance))) void pylonMissiles.load();
    // Bomber Escort: that era's bomber model.
    if (era && s.world.objectives.escort) void loadPlane(bomberFor(s.ctx, era).id);
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
    controls.target = null;
    if (env.isTouch) {
      // A quick tap on an enemy picks it as the missile target (tapping empty sky clears the pick).
      touch = createTouchControls(ui, controls, sensitivity, (x, y) => {
        const self = player();
        if (session && self) controls.target = targetAt(session.world, self, screenOfPlane, x, y);
      });
      if (me) touch.setPlane(me);
    }
    if (env.debug && s.net) netOverlay = createNetOverlay(ui);
    if (era) {
      const unlocks = s.kind === 'net' && net?.client.room?.allUnlocked ? 'all' : profile.unlocks();
      respawn = createRespawnPicker(ui, { planes: data.planes.filter((p) => p.era === era), unlocks, silhouettes }, (id) => session?.chooseRespawn(id));
    }
    profile.markMatchStart();
    desktop.setEnabled(true);
  }

  function endMatch(): void {
    const s = session;
    if (!s) return;
    const hostLeft = s.ended === 'hostLeft';
    // Multiplayer: back to the room, which shows the host's results and then the lobby, still connected.
    if (s.kind === 'net' && !hostLeft && net) {
      leaveMatch();
      showRoom();
      return;
    }
    const weLeft = hostLeft && (document.hidden || performance.now() - hiddenAt < 20_000);
    const results = computeResults(s.world);
    const me = s.playerId;
    const wasNet = s.kind === 'net';
    // The host left: everyone keeps the points earned so far (counted here, still capped by the rules).
    const saved = wasNet ? (recordNetMatch(results, me), lastNetMatch.id) : profile.recordSolo(results.rows.find((x) => x.id === me), results.winner);
    leaveMatch();
    closeNet();
    mode = 'results';
    const resultsScreen = showResults(
      ui,
      results,
      {
        me,
        planeName,
        ...(hostLeft ? { title: weLeft ? 'Connection lost' : 'Host left' } : {}),
        ...(wasNet ? { againLabel: 'Play with friends' } : {}),
        save: profile.saveText(saved),
      },
      {
        onAgain: () => (wasNet ? showNetMenu(null) : lastChoice ? startSolo(lastChoice) : showSetup()),
        onTitle: showTitle,
        onResearch: () => showResearch(lastChoice?.era),
      },
    );
    const view = resultsScreen;
    const off = profile.onChange(() => view.setSave(profile.saveText(saved)));
    screen = {
      dispose: () => {
        off();
        view.dispose();
      },
    };
  }

  function scoreRows(): ScoreRow[] {
    if (!session) return [];
    const w = session.world;
    const me = session.playerId;
    return Object.values(w.pilots)
      .filter((p) => p.role !== 'bomber')
      .map((p) => {
        const st = w.stats[p.id] ?? newStats();
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
  const visualPlane = new Map<string, string>();
  const ensureVisual = (p: PlaneState): PlaneVisual => {
    let v = visuals.get(p.id);
    // Rebuilt when the model finishes loading, or when the pilot respawns in a different plane.
    if (!v || (v.placeholder && isModelReady(p.planeId)) || visualPlane.get(p.id) !== p.planeId) {
      if (v) mapScene.scene.remove(v.root);
      v = createPlaneVisual(p.planeId, p.team);
      visuals.set(p.id, v);
      visualPlane.set(p.id, p.planeId);
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
  const burners: GlowSource[] = [];
  const burnerPool: GlowSource[] = [];
  /** Where a plane is drawn on screen this frame (its mesh), for target boxes and taps. */
  const screenOfPlane = (id: string): { x: number; y: number } | null => {
    const v = visuals.get(id);
    return v && v.root.visible ? toScreen(vc.copy(v.root.position)) : null;
  };

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
      } else if (e.t === 'detonate') {
        effects.explosion(e.pos[0], e.pos[1], e.pos[2]);
        if (vc.set(e.pos[0], e.pos[1], e.pos[2]).distanceTo(view.camera.position) < 200) chase.shake(e.victim === myId ? 0.6 : 0.3);
      } else if (e.t === 'launch') {
        const shooter = w.planes.find((p) => p.id === e.owner);
        if (shooter) for (let k = 0; k < 3; k++) effects.emit('smoke', shooter.pos[0], shooter.pos[1] - 2, shooter.pos[2]);
      } else if (e.t === 'decoy' && e.kind === 'chaff') {
        missileFx.chaffBurst(e.pos[0], e.pos[1], e.pos[2]);
      } else if (e.t === 'capture') {
        const letter = 'ABC'[e.zone] ?? '?';
        const teamName = (t: string): string => `<b class="t-${t}">${t === 'blue' ? 'Blue' : 'Red'}</b>`;
        hud.killFeed(e.team ? `${teamName(e.team)} captured zone ${letter}` : `Zone ${letter} is neutral`, e.by.includes(myId));
      } else if (e.t === 'unit') {
        const by = e.by ? w.pilots[e.by] : null;
        const name = unitDef(session.ctx, e.kind).name;
        hud.killFeed(by ? `<b class="t-${by.team}">${esc(by.name)}</b> destroyed a <span class="t-${e.team}">${esc(name)}</span>` : `A <span class="t-${e.team}">${esc(name)}</span> was destroyed`, e.by === myId);
        if (e.by === myId) hud.hitMarker(true);
      } else if (e.t === 'bombed') {
        const mine = me?.team === e.team;
        hud.killFeed(mine ? 'Our bombers hit the target' : 'Enemy bombers hit our base', true);
      } else if (e.t === 'wave') {
        const mine = me?.team === e.escort;
        hud.killFeed(mine ? `Bomber wave ${e.wave} is taking off: escort it` : `Enemy bomber wave ${e.wave} inbound: intercept`, true);
      } else if (e.t === 'drop') {
        if (e.kind === 'rocket') effects.emit('smoke', e.pos[0], e.pos[1], e.pos[2]);
      } else if (e.t === 'kill') {
        const victim = w.pilots[e.victim];
        const killer = e.killer ? w.pilots[e.killer] : null;
        const tag = (p: { name: string; team: string } | null | undefined): string => (p ? `<b class="t-${p.team}">${esc(p.name)}</b>` : '');
        const html = killer
          ? `${tag(killer)} shot down ${tag(victim)}`
          : e.killer?.startsWith('u')
            ? `${tag(victim)} was shot down by AA fire`
            : `${tag(victim)} crashed`;
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

  // Firestore operations, for the Spark budget: this match (its saves included) and this session.
  const firestoreLine = (): string => {
    const u = profile.usage();
    return `FS match ${u.match.reads}r+${u.match.ruleReads}rr/${u.match.writes}w · session ${u.session.reads}r+${u.session.ruleReads}rr/${u.session.writes}w`;
  };
  const fps = env.debug ? createFpsCounter(ui, firestoreLine) : null;
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
      lines.push(`host up ${kb(hostOut.perS)} to ${Math.max(0, server.room().players.length - 1)} players`);
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
      // Room timers count down between host updates.
      if (roomView && Math.floor(clock * 4) !== Math.floor((clock - dt) * 4)) roomView.tick();
      if (mode !== 'match' || !session) return;
      const s = session;
      // ?timescale speeds up solo only; a network match runs in real time.
      const steps = s.kind === 'solo' ? timeScale : 1;
      for (let step = 0; step < steps; step++) {
        const me = player();
        let input: ControlInput | null = null;
        if (me?.alive) {
          if (desktop.takeTargetCycle()) controls.target = cycleTarget(s.world, me, controls.target);
          if (controls.target && !s.world.planes.some((p) => p.id === controls.target && p.alive)) controls.target = null;
          controls.fire = desktop.buttons.fire || (touch?.buttons.fire ?? false);
          controls.missile = desktop.buttons.missile || (touch?.buttons.missile ?? false) || desktop.takeMissilePress() || (touch?.takeMissilePress() ?? false);
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

  /** Mode objectives for the HUD: the score label, a role line, zone chips, markers and minimap symbols. */
  function objectiveHud(s: Session, me: PlaneState): { objective: ObjectiveFrame; objMarkers: ObjectiveMarker[]; mapObjects: { x: number; z: number; kind: 'zone' | 'unit'; team: PlaneState['team'] | null; label: string }[] } {
    const w = s.world;
    const o = w.objectives;
    const half = ctx.terrain.half;
    const objMarkers: ObjectiveMarker[] = [];
    const mapObjects: { x: number; z: number; kind: 'zone' | 'unit'; team: PlaneState['team'] | null; label: string }[] = [];
    const cam = view.camera.position;
    let status = '';
    let role = '';
    let scoreLabel = 'Kills';
    if (o.mode === 'air_domination') {
      scoreLabel = 'Tickets';
      role = `Capture zones: fly below ${o.rules.captureAltitudeM} m inside them`;
      o.zones.forEach((z, i) => {
        const letter = 'ABC'[i] ?? '?';
        mapObjects.push({ x: z.x / half, z: z.z / half, kind: 'zone', team: z.owner, label: letter });
        const ground = ctx.terrain.surfaceAt(z.x, z.z);
        const sp = toScreen(vc.set(z.x, ground + 40, z.z));
        const d = Math.round(vc.distanceTo(cam));
        if (sp) objMarkers.push({ x: sp.x, y: sp.y, kind: 'zone', team: z.owner, enemy: z.owner !== null && z.owner !== me.team, label: `${letter} ${d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`}` });
        const inside = Math.hypot(me.pos[0] - z.x, me.pos[2] - z.z) < o.rules.zoneRadiusM;
        if (inside && me.alive) {
          const agl = me.pos[1] - ctx.terrain.surfaceAt(me.pos[0], me.pos[2]);
          const pct = Math.round(Math.abs(z.progress) * 100);
          const ours = (me.team === 'blue') === (z.progress > 0);
          status = agl > o.rules.captureAltitudeM ? `Zone ${letter}: go below ${o.rules.captureAltitudeM} m to capture` : z.owner === me.team ? `Holding zone ${letter}` : `Capturing ${letter} · ${ours ? pct : 0}%`;
        }
      });
    } else if (o.mode === 'ground_strike') {
      scoreLabel = 'Tickets';
      role = me.rockets + me.bombs > 0 ? 'Destroy enemy ground targets: rockets and bombs on Q / Missile' : 'Destroy enemy ground targets, protect yours';
    } else if (o.mode === 'bomber_escort' && o.escort) {
      scoreLabel = 'Points';
      const flying = w.planes.filter((p) => p.alive && isBomber(w, p.id)).length;
      const mine = o.escort.escort === me.team;
      role = mine ? 'Escort your bombers to the target' : 'Shoot down the enemy bombers';
      status = flying > 0 ? `${mine ? 'Our' : 'Enemy'} bombers: ${flying} flying` : `Next bomber wave in ${Math.max(0, Math.ceil(o.escort.nextIn))} s`;
    }
    // Ground targets: diamonds for the nearest ones on screen, squares on the minimap.
    let n = 0;
    for (const u of o.units) {
      if (!u.alive || !u.target) continue;
      mapObjects.push({ x: u.pos[0] / half, z: u.pos[2] / half, kind: 'unit', team: u.team, label: '' });
      if (n >= 10) continue;
      const d = vc.set(u.pos[0], u.pos[1] + 12, u.pos[2]).distanceTo(cam);
      if (d > 6000) continue;
      const sp = toScreen(vc);
      if (!sp) continue;
      n++;
      objMarkers.push({ x: sp.x, y: sp.y, kind: 'unit', team: u.team, enemy: u.team !== me.team, label: u.team !== me.team && d < 2500 ? unitDef(s.ctx, u.kind).name : '' });
    }
    for (const p of w.planes) {
      if (!p.alive || !isBomber(w, p.id)) continue;
      const v = visuals.get(p.id);
      const sp = v ? toScreen(vc.copy(v.root.position)) : null;
      if (sp) objMarkers.push({ x: sp.x, y: sp.y, kind: 'bomber', team: p.team, enemy: p.team !== me.team, label: `${Math.round((p.hp / p.maxHp) * 100)}%` });
    }
    return {
      objective: { scoreLabel, role, status, zones: o.zones.map((z, i) => ({ letter: 'ABC'[i] ?? '?', owner: z.owner, progress: z.progress })) },
      objMarkers: objMarkers.slice(0, 16),
      mapObjects: mapObjects.slice(0, 40),
    };
  }

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
      // Afterburner glow at every exhaust (or the tail when the model has none).
      if (p.alive && afterburner(p, ctx.planeDefs.get(p.planeId))) {
        const size = Math.max(0.8, planeSize(ctx.planeDefs.get(p.planeId)!).lengthM / 16);
        const add = (x: number, y: number, z: number): void => {
          const g = burnerPool[burners.length] ?? { x: 0, y: 0, z: 0, size: 1 };
          burnerPool[burners.length] = g;
          g.x = x;
          g.y = y;
          g.z = z;
          g.size = size;
          burners.push(g);
        };
        if (visual.exhausts.length > 0) {
          for (const ex of visual.exhausts) {
            ex.getWorldPosition(vc);
            add(vc.x, vc.y, vc.z);
          }
        } else {
          const f = rotate(p.quat, FORWARD);
          add(mesh.position.x - f[0] * 7, mesh.position.y - f[1] * 7, mesh.position.z - f[2] * 7);
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
    missileFx.update(w, (1 - alpha) / 60, frameDt, burners);
    pylonMissiles.update(
      w.planes,
      ctx.planeDefs,
      (p) => {
        const v = visuals.get(p.id);
        return v && !v.placeholder && v.root.visible ? v.root : null;
      },
      w.objectives.ordnance,
    );
    ground.update(w.objectives.units, w.objectives.zones, w.objectives.rules.zoneRadiusM, w.objectives.rules.captureAltitudeM, ctx.terrain, frameDt);
    burners.length = 0;
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
    respawn?.update({ visible: !me.alive, sp: Math.floor(w.stats[me.id]?.sp ?? 0), selected: s.respawnChoice ?? me.planeId });

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
        ? `Hold the cursor where you want to fly. Click or Space fires${def.missiles.length ? ', Q missile, R target, F flares' : def.ordnance ? ', Q rockets and bombs' : ''}, Tab shows scores`
        : `Click to steer with the mouse. Space fires${def.missiles.length ? ', Q missile, R target, F flares' : def.ordnance ? ', Q rockets and bombs' : ''}, W/S throttle, Tab shows scores`;

    const cockpit = cockpitState(w, ctx, me, controls.target, screenOfPlane);
    audio.update(cockpit.seeker, cockpit.warning, clock);
    touch?.setWeapons(cockpit.touch);

    hud?.update({
      weapons: cockpit.frame,
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
      ammo: [
        ...def.guns.map((g, i) => ({ label: ctx.guns.get(g.type)?.name.split(' ').slice(0, 2).join(' ') ?? g.type, rounds: me.ammo[i] ?? 0 })),
        ...(def.ordnance ? [{ label: 'Rockets', rounds: me.rockets }, { label: 'Bombs', rounds: me.bombs }] : []),
      ],
      ...objectiveHud(s, me),
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
  if (env.room) {
    const code = parseRoomCode(env.room);
    if (code) showCallsign(code);
    else showNetMenu(null, `"${env.room.slice(0, 8)}" isn't a room code. Codes are 4 letters, like XQZK.`);
  }
  loop.start();
  // The title plane becomes a real Spitfire as soon as its model arrives.
  void loadPlane('spitfire_mk5').then(() => {
    if (!isModelReady('spitfire_mk5')) return;
    titlePlane = () => createPlaneVisual('spitfire_mk5', 'blue').root;
    for (const mw of mapWorlds.values()) mw.titleShot.setModel(titlePlane());
  });
  document.body.dataset['ready'] = 'true';

  if (env.debug) {
    // Test and debugging hooks (Playwright reads these). Only with ?debug=1.
    (window as unknown as { __rvbs: unknown }).__rvbs = {
      mode: () => mode,
      /** Progress: Firebase status, account, RP, unlocks, results waiting to sync. */
      profile: () => ({
        status: profile.status,
        uid: profile.account?.uid ?? null,
        anonymous: profile.account?.anonymous ?? null,
        rp: profile.profile.rp,
        unlocked: { ...profile.profile.unlocked },
        stats: { ...profile.profile.stats },
        pending: profile.pendingRp,
        usage: profile.usage(),
      }),
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
              lobby: (net.client.room?.players ?? []).map((p) => p.name),
              room: net.client.room,
              mode,
              stats: session?.net ? { ...session.net } : null,
            }
          : null,
      /** The plane each pilot flies in the current match, with the team BR totals (balance checks). */
      teamBr: () => {
        if (!session || mode !== 'match') return null;
        const br = { blue: 0, red: 0 };
        for (const p of session.world.planes) if (!isBomber(session.world, p.id)) br[p.team] += ctx.planeDefs.get(p.planeId)?.br ?? 0;
        return br;
      },
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
      /** Missiles in the air and the player's weapon state. */
      missiles: () => {
        if (!session || mode !== 'match') return null;
        const me = player();
        return {
          inAir: session.world.missiles.map((m) => ({ id: m.id, type: m.type, owner: m.owner, target: m.target })),
          picked: controls.target,
          me: me ? { flares: me.flares, chaff: me.chaff, missiles: [...me.missiles], lockTarget: me.lockTarget, lockProgress: me.lockProgress, hp: me.hp } : null,
        };
      },
      /** Solo only: put the nearest enemy `distM` ahead of the player, flying the same way (a tail shot). */
      placeEnemyAhead: (distM: number) => {
        const me = player();
        if (!session || session.kind !== 'solo' || !me) return null;
        const enemy = session.world.planes.filter((p) => p.alive && p.team !== me.team)[0];
        if (!enemy) return null;
        const f = rotate(me.quat, FORWARD);
        enemy.pos = [me.pos[0] + f[0] * distM, me.pos[1] + f[1] * distM, me.pos[2] + f[2] * distM];
        enemy.quat = [...me.quat];
        enemy.vel = [...me.vel];
        enemy.protectedFor = 0;
        return enemy.id;
      },
      /** Solo only: put the player `distM` from a ground unit of `kind` (any team), `heightM` up, facing it. */
      placeNearUnit: (kind: string, distM = 700, heightM = 250) => {
        const me = player();
        if (!session || session.kind !== 'solo' || !me) return null;
        const w = session.world;
        const u = kind === 'bomber' ? w.planes.find((x) => x.alive && isBomber(w, x.id)) : w.objectives.units.find((x) => x.kind === kind && x.alive);
        if (!u) return null;
        const dir = normalize([me.pos[0] - u.pos[0], 0, me.pos[2] - u.pos[2]]);
        me.pos = [u.pos[0] + dir[0] * distM, u.pos[1] + heightM, u.pos[2] + dir[2] * distM];
        const fwd = normalize([u.pos[0] - me.pos[0], u.pos[1] - me.pos[1], u.pos[2] - me.pos[2]]);
        me.quat = quatLookRotation(fwd);
        me.vel = [fwd[0] * 120, fwd[1] * 120, fwd[2] * 120];
        controls.resetTo(me);
        return u.id;
      },
      /** Solo only: an enemy behind the player launches `type` at it. */
      launchAtPlayer: (type: string, distM = 1800) => {
        const me = player();
        const m = ctx.missileDefs.get(type);
        if (!session || session.kind !== 'solo' || !me || !m) return null;
        const w = session.world;
        const enemy = w.planes.filter((p) => p.alive && p.team !== me.team)[0];
        if (!enemy) return null;
        const f = rotate(me.quat, FORWARD);
        enemy.pos = [me.pos[0] - f[0] * distM, me.pos[1] - f[1] * distM, me.pos[2] - f[2] * distM];
        enemy.quat = [...me.quat];
        enemy.vel = [...me.vel];
        const before = w.nextMissileId;
        launchMissile(w, enemy, 0, m, me, []);
        return before;
      },
      player: () => {
        const p = player();
        return p ? (JSON.parse(JSON.stringify(p)) as PlaneState) : null;
      },
      quality: () => quality,
      pylonMissiles: () => ({ total: pylonMissiles.shown, mine: session ? pylonMissiles.shownOn(session.playerId) : 0 }),
      /** The mode's state as this browser sees it: zones, ground targets, bombers, rockets and bombs. */
      objectives: () => {
        if (!session || mode !== 'match') return null;
        const w = session.world;
        const o = w.objectives;
        return {
          mode: o.mode,
          score: { ...w.match.score },
          zones: o.zones.map((z) => ({ owner: z.owner, progress: z.progress })),
          units: o.units.map((u) => ({ kind: u.kind, team: u.team, alive: u.alive, pos: [...u.pos] })),
          drawnUnits: ground.shown,
          bombers: w.planes.filter((p) => isBomber(w, p.id)).map((p) => ({ id: p.id, alive: p.alive, team: p.team, hp: p.hp, pos: [...p.pos] })),
          escort: o.escort?.escort ?? null,
          ordnance: o.ordnance.length,
        };
      },
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
