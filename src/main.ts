// Boot and app flow: title → solo setup or Host/Join → lobby → match → results. One renderer and one map
// scene are shared. A match is always a Session: solo runs locally, multiplayer runs through ClientSession
// (the host's own player too, over an in-memory loopback to the HostServer running in this tab).
import './fonts.css';
import './styles.css';
import { Matrix4, Vector3, type Object3D } from 'three';
import { env } from './core/env';
import { createDesktopInput } from './core/input';
import { createLoop } from './core/loop';
import { createWakeLock } from './core/wakeLock';
import { createPlayerControls } from './core/playerControls';
import { createAutoQuality, initialLevel, QUALITY, type QualityLevel } from './core/quality';
import { getSettings, onSettingsChange } from './core/settings';
import { loadGameData } from './data';
import type { GameData } from './data/types';
import { leadPoint } from './game/ballistics';
import type { ControlInput } from './game/controls';
import { speedKmh, type PlaneState } from './game/flight';
import { dirFromYawPitch, FORWARD, normalize, quatConj, quatLookRotation, rotate, yawPitchFromDir, type Vec3 } from './game/math';
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
import { createRibbons } from './render/ribbons';
import { createMissileFx, type GlowSource } from './render/missiles';
import { createPylonMissiles } from './render/pylonMissiles';
import { createCockpitAudio } from './core/audio';
import { createSound, gunClass, type EngineInput, type GunClass } from './core/sound';
import { cockpitState, targetAt } from './app/weapons';
import { afterburner, isJet, launch as launchMissile } from './game/missiles';
import { createMapScene } from './render/mapScene';
import { createPost } from './render/post';
import { loadHeightfield } from './render/heightfieldLoader';
import { hasBakedTerrain, heightfieldFor } from './game/heightfield';
import { setTeamPalette } from './render/planeMesh';
import { createGroundRenderer } from './render/groundUnits';
import { bomberFor, isBomber, unitDef } from './game/objectives';
import type { ObjectiveFrame, ObjectiveMarker } from './ui/hud';
import { createPlaneVisual, isModelReady, loadEra, loadPlane, setModelDetail, visualOutdated, type PlaneVisual } from './render/models';
import { isProp, PLANE_MODELS, planeSize } from './game/planeModels';
import { createView } from './render/renderer';
import { createTitleShot } from './render/titleShot';
import { createTracers } from './render/tracers';
import { installErrorOverlay, reportError, showDataErrors } from './ui/errorOverlay';
import { createFpsCounter } from './ui/fps';
import { createHud, escapeHtml as esc, type Hud, type Marker, type ScoreRow } from './ui/hud';
import { showResults } from './ui/results';
import { openSettings } from './ui/settingsPanel';
import { openControls } from './ui/controlsPanel';
import { keysText } from './core/keybinds';
import { createFlightHud, type FlightHud, type HudStyle } from './ui/flightHud';
import { createRadarPanel, type PanelFrame, type RadarPanel, type ScopeContact } from './ui/radarPanel';
import { createMatchChat, createMatchMenu, type MatchChat, type MatchMenu } from './ui/matchOverlays';
import { RADAR_RANGES_KM, radarSees } from './game/radar';
import { missileLabel } from './app/weapons';
import { createSoloSetup, type SoloChoice } from './ui/soloSetup';
import { createHangarUi } from './ui/hangar';
import { createTitleScreen } from './ui/title';
import { createTouchControls, type TouchControls } from './ui/touchControls';
import { createProfileStore } from './profile/store';
import { openResearch } from './ui/research';
import { openLeaderboard } from './ui/leaderboard';
import { openHowToPlay } from './ui/howToPlay';
import { createTutorialSession, TUTORIAL_MAP, type TutorialSession } from './app/tutorial';
import { createTutorialProps } from './render/tutorialProps';
import { createTutorialPanel, type TutorialPanel } from './ui/tutorialPanel';
import { readStorage, writeStorage } from './core/storage';
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
  const ribbons = createRibbons();
  const missileFx = createMissileFx(effects);
  const missileClass = new Map(data.missiles.missiles.map((m) => [m.id, m.class]));
  const pylonMissiles = createPylonMissiles((type) => missileClass.get(type));
  const ground = createGroundRenderer(effects);
  const tutorialProps = createTutorialProps();
  const sound = createSound();
  const audio = createCockpitAudio(sound);
  const silhouettes = createSilhouettes(view.renderer);
  // Bloom on Medium and High (post.ts); the map draws its backdrop and scene passes into it.
  const post = createPost(view.renderer);
  const drawScene = (): void => mapScene.render(view.renderer, view.camera);
  // One scene per map, built the first time a match is voted onto it and kept (at most 4), so switching back is free.
  interface MapWorld {
    ctx: WorldContext;
    scene: ReturnType<typeof createMapScene>;
    titleShot: ReturnType<typeof createTitleShot>;
    /** Built on the baked (eroded) heightmap, not the procedural fallback. */
    baked: boolean;
  }
  const mapWorlds = new Map<string, MapWorld>();
  let titlePlane: (() => Object3D) | null = null;
  const buildMap = (mapId: string): MapWorld => {
    let mw = mapWorlds.get(mapId);
    // Built before its heightmap arrived: rebuild now that it's here (never under a match in progress).
    if (mw && !mw.baked && heightfieldFor(mapId) && !(mode === 'match' && ctx.map.id === mapId)) {
      mapWorlds.delete(mapId);
      mw.titleShot.setVisible(false);
      mw.scene.dispose();
      mw = undefined;
    }
    if (!mw) {
      const c = createWorldContext(data, mapId);
      const scene = createMapScene(c.map, c.terrain, view.renderer);
      mw = { ctx: c, scene, titleShot: createTitleShot(scene.scene, c.terrain), baked: Boolean(heightfieldFor(mapId)) || !hasBakedTerrain(mapId) };
      if (titlePlane) mw.titleShot.setModel(titlePlane());
      mapWorlds.set(mapId, mw);
    }
    return mw;
  };
  let current = buildMap(map.id);
  let ctx: WorldContext = current.ctx;
  let mapScene = current.scene;
  let titleShot = current.titleShot;
  mapScene.scene.add(tracers.mesh, effects.mesh, ribbons.mesh, missileFx.root, pylonMissiles.root, ground.root, tutorialProps.root);

  /** Low graphics: no engine heat glow, no vapour ribbons. */
  let effectsLow = false;
  /** The era being flown (its models upgrade when the quality changes). */
  let matchEra: EraId | null = null;
  let quality: QualityLevel = forced ?? initialLevel(settings.graphics, env.isTouch, navigator.webdriver === true);
  const applyQuality = (level: QualityLevel): void => {
    quality = level;
    view.setMaxPixelRatio(QUALITY[level].maxPixelRatio);
    // Detailed plane models on Medium and High (era models already loading get upgraded as they arrive).
    setModelDetail(level === 'low' ? 'lod' : 'high', view.renderer);
    if (matchEra && level !== 'low') void loadEra(matchEra, data.planes.filter((p) => p.era === matchEra).map((p) => p.id));
    mapScene.setQuality(level, view.renderer, view.camera);
    post.setBloom(QUALITY[level].bloom);
    effects.density = level === 'low' ? 0.5 : 1;
    effectsLow = level === 'low';
    effects.heavy = level !== 'low';
  };
  applyQuality(quality);
  const capped = (): boolean => getSettings().cap30;
  let auto = !forced && settings.graphics === 'auto' ? createAutoQuality((level) => applyQuality(level), capped) : null;
  let lastGraphics = settings.graphics;
  onSettingsChange((s) => {
    if (forced || s.graphics === lastGraphics) return;
    lastGraphics = s.graphics;
    if (s.graphics === 'auto') auto = createAutoQuality((level) => applyQuality(level), capped);
    else {
      auto = null;
      applyQuality(s.graphics);
    }
  });

  /** Switch the scene to another map (the voted one) before a match starts there. */
  const useMap = (mapId: string): void => {
    if (!data.maps.some((m) => m.id === mapId)) return;
    if (ctx.map.id === mapId && (current.baked || !heightfieldFor(mapId))) return;
    const visible = !document.body.classList.contains('is-flying');
    titleShot.setVisible(false);
    current = buildMap(mapId);
    ctx = current.ctx;
    mapScene = current.scene;
    titleShot = current.titleShot;
    titleShot.setVisible(visible);
    mapScene.scene.add(tracers.mesh, effects.mesh, ribbons.mesh, missileFx.root, pylonMissiles.root, ground.root, tutorialProps.root);
    applyQuality(quality);
  };
  // Baked heightmaps download when a map is wanted: the title's map at boot, a solo pick as soon as it's picked
  // (startSolo waits for it), a room's voted map at the vote (teams and plane select follow, so it's in before
  // the start). Fetching all of them at boot cost ~2.4 MB that competed with the first match on a slow
  // connection. When the map on screen arrives its scene is rebuilt on it (not during a match).
  const wantMap = (mapId: string): void => {
    void loadHeightfield(mapId).then((ok) => {
      if (ok && ctx.map.id === mapId && mode !== 'match') useMap(mapId);
    });
  };
  wantMap(map.id);

  const controls = createPlayerControls();
  // Display and control settings that apply at once: invert pitch, HUD size, team colours.
  const applyDisplay = (st: ReturnType<typeof getSettings>): void => {
    controls.invertPitch = st.invertPitch;
    controls.mode = st.controlMode;
    document.documentElement.style.setProperty('--hud-scale', String(st.hudScale));
    setTeamPalette(st.teamColours);
  };
  applyDisplay(settings);
  onSettingsChange(applyDisplay);
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
  let flightHud: FlightHud | null = null;
  let radarPanel: RadarPanel | null = null;
  let matchMenu: MatchMenu | null = null;
  let matchChat: MatchChat | null = null;
  let controlsView: { close(): void } | null = null;
  /** Solo only: P or the menu stops the simulation. */
  let paused = false;
  let maxG = 1;
  let mapOpen = false;
  onSettingsChange((st) => touch?.setOptions({ rudder: st.touchRudder, tilt: st.tiltSteer }));
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
  // Tutorial (first launch, or Settings → Play the tutorial again).
  const TUTORIAL_KEY = 'rvbs.tutorial.v1';
  let tutorialPanel: TutorialPanel | null = null;
  const tutorialOf = (s: Session | null): TutorialSession | null => (s && 'tutorial' in s ? (s as TutorialSession) : null);
  const finishTutorial = (): void => {
    writeStorage(TUTORIAL_KEY, 'done');
  };
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
  /** Lost the connection because this tab was hidden (a locked phone), rather than the host leaving. */
  const droppedByUs = (): boolean => document.hidden || performance.now() - hiddenAt < 20_000;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    hiddenAt = performance.now();
    // Backgrounded: let go of every key and button, since their release events won't arrive.
    desktop.releaseAll();
    touch?.releaseAll();
    controls.fire = controls.missile = controls.flare = false;
  });
  // Screen kept on while in a room or a match (a phone that locks itself drops out).
  const wakeLock = createWakeLock();
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
    desktop.setTyping(false);
    hud?.dispose();
    hud = null;
    flightHud = null;
    radarPanel = null;
    matchMenu?.dispose();
    matchMenu = null;
    matchChat?.dispose();
    matchChat = null;
    controlsView?.close();
    controlsView = null;
    paused = false;
    mapOpen = false;
    controls.view = 'chase';
    controls.zoom = false;
    chase.setZoom(false);
    touch?.dispose();
    touch = null;
    netOverlay?.dispose();
    netOverlay = null;
    respawn?.dispose();
    respawn = null;
    tutorialPanel?.dispose();
    tutorialPanel = null;
    tutorialProps.update(null, 0);
    document.body.classList.remove('is-tutorial');
    for (const v of visuals.values()) mapScene.scene.remove(v.root);
    visuals.clear();
    visualPlane.clear();
    if (session?.kind === 'solo') session.dispose();
    session = null;
    endedAt = 0;
    controls.target = null;
    missileFx.clear();
    ribbons.clear();
    ribbonsLive.clear();
    pylonMissiles.clear();
    ground.clear();
    audio.mute();
    sound.quiet();
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

  function showTutorialOffer(): void {
    closeOverlay();
    const el = document.createElement('div');
    el.className = 'modal tut-offer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Tutorial');
    el.innerHTML = `
      <div class="modal__card">
        <h2>New pilot?</h2>
        <p>A one-minute flying lesson: steer through rings, shoot balloons, fire a missile at a drone and beat one with flares.</p>
        <div class="tut-offer__actions">
          <button type="button" class="btn btn--primary btn--small" data-act="start" data-testid="tutorial-start">Start the lesson</button>
          <button type="button" class="btn btn--secondary btn--small" data-act="skip">Not now</button>
        </div>
        <small>You can play it any time from Settings.</small>
      </div>`;
    ui.appendChild(el);
    el.querySelector('[data-act="start"]')!.addEventListener('click', () => {
      closeOverlay();
      startTutorial();
    });
    el.querySelector('[data-act="skip"]')!.addEventListener('click', () => {
      finishTutorial();
      closeOverlay();
    });
    overlay = { dispose: () => el.remove() };
  }

  function startTutorial(): void {
    closeNet();
    useMap(TUTORIAL_MAP);
    lastChoice = null;
    const s = createTutorialSession(ctx);
    enterMatch(s);
    document.body.classList.add('is-tutorial');
    tutorialPanel = createTutorialPanel(ui, () => {
      finishTutorial();
      showTitle('Tutorial skipped. Settings → Play the tutorial again any time.');
    });
  }

  function showTitle(note?: string): void {
    leaveMatch();
    closeNet();
    clearScreen();
    mode = 'title';
    titleShot.setVisible(true);
    const title = createTitleScreen(ui, env.version, {
      onSolo: showSetup,
      onHostJoin: () => showCallsign(null),
      onSettings: () =>
        openSettings(ui, {
          isTouch: env.isTouch,
          account: accountControls,
          onTutorial: startTutorial,
          onControls: () => {
            controlsView = openControls(ui, { capture: (fn) => desktop.captureNext(fn), isTouch: env.isTouch, onClose: () => (controlsView = null) });
          },
        }),
      onHelp: () => {
        closeOverlay();
        overlay = openHowToPlay(ui, { start: env.isTouch ? 'touch' : desktop.gamepadConnected ? 'gamepad' : 'desktop', version: env.version, onClose: () => (overlay = null) });
      },
      onResearch: () => showResearch(),
      onLeaderboard: () => {
        closeOverlay();
        overlay = openLeaderboard(ui, profile, () => (overlay = null));
      },
    });
    title.setProfile(profileLine());
    if (typeof note === 'string') title.setNote(note);
    // First launch: offer the one-minute tutorial (not to automated browsers unless ?tutorial=1, and not to
    // someone opening a friend's room link: they go straight to the room).
    const offer = params.get('tutorial') === '1' || (!navigator.webdriver && !env.room);
    if (offer && readStorage(TUTORIAL_KEY) === null) showTutorialOffer();
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
      { onStart: startSolo, onBack: showTitle, onHangar: showHangar, onResearch: (era) => showResearch(era, showSetup), onMap: wantMap },
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
      // Connected (or reconnected after a lock): a later drop is the host's, not ours.
      hiddenAt = -Infinity;
      if (mode === 'connecting') showRoom();
    },
    onRoom: (room) => {
      // Get the voted map and era ready while people pick planes.
      if (room.choice) {
        const era = room.choice.era;
        void loadEra(era, data.planes.filter((p) => p.era === era).map((p) => p.id));
        wantMap(room.choice.mapId);
        if (mode === 'room') useMap(room.choice.mapId);
      } else {
        // Waiting in the lobby: nothing else is downloading, so every map's heightmap can come in now.
        for (const m of data.maps) wantMap(m.id);
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
      if (mode !== 'room' && mode !== 'connecting') return;
      // Our own phone dropped the connection while locked: rejoin the same room.
      if (net && !net.isHost && droppedByUs()) void joinRoom(net.code, true);
      else showNetMenu(net?.isHost ? null : (net?.code ?? null), 'The host closed the room.');
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

  async function joinRoom(code: string, rejoin = false): Promise<void> {
    const status = showConnecting(rejoin ? `Reconnecting to room ${code}…` : `Connecting to room ${code}…`, code);
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
    if (hangar.visual && visualOutdated(hangar.visual, hangar.planeId)) setHangarVisual();
    if (!hangar.touched) hangar.yaw += frameDt * 0.25;
    const v = hangar.visual;
    for (const prop of v?.props ?? []) prop.rotation.z += frameDt * 6;
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

  async function startSolo(choice: SoloChoice): Promise<void> {
    closeNet();
    lastChoice = choice;
    const mapId = data.maps.some((m) => m.id === choice.map) ? choice.map! : map!.id;
    // The baked heightmap has almost always arrived by now; if not, it's a few hundred KB away.
    await loadHeightfield(mapId);
    useMap(mapId);
    enterMatch(
      createSoloSession(ctx, {
        era: choice.era,
        planeId: choice.planeId,
        difficulty: choice.difficulty,
        mode: data.modes.find((m) => m.id === choice.mode && m.playable)?.id ?? 'tdm',
        assist: env.isTouch ? getSettings().aimAssist : 0,
        flightModel: getSettings().flightModel,
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
    matchEra = era ?? null;
    if (era) void loadEra(era, data.planes.filter((p) => p.era === era).map((p) => p.id));
    // Weapon models only for eras whose planes carry missiles, rockets or bombs.
    if (era && data.planes.some((p) => p.era === era && (p.missiles.length > 0 || p.ordnance))) void pylonMissiles.load();
    // Bomber Escort: that era's bomber model.
    if (era && s.world.objectives.escort) void loadPlane(bomberFor(s.ctx, era).id);
    chase.setScale(mine ? planeSize(mine).lengthM / 9 : 1);
    if (me) controls.resetTo(me, Boolean(mine?.radar));
    controls.freeLook = false;
    chase.reset();
    wasAlive = true;
    killerId = null;
    maxG = 1;
    hud = createHud(ui, {
      onMenu: () => openMatchMenu(),
      onScores: (open) => hud?.setScoreboard(open ? scoreRows() : null),
    });
    flightHud = createFlightHud(hud.el);
    // Tapping a radar contact selects it (phones; the panel takes taps only there).
    radarPanel = createRadarPanel(hud.el, (id) => (controls.target = id));
    const solo = s.kind === 'solo';
    matchMenu = createMatchMenu(ui, {
      solo,
      onResume: () => closeMatchMenu(),
      onControls: () => {
        matchMenu?.hide();
        controlsView = openControls(ui, { capture: (fn) => desktop.captureNext(fn), isTouch: env.isTouch, onClose: () => ((controlsView = null), matchMenu?.show()) });
      },
      onSettings: () => {
        matchMenu?.hide();
        openSettings(ui, {
          isTouch: env.isTouch,
          onClose: () => matchMenu?.show(),
          onControls: () => {
            controlsView = openControls(ui, { capture: (fn) => desktop.captureNext(fn), isTouch: env.isTouch, onClose: () => ((controlsView = null), matchMenu?.show()) });
          },
        });
      },
      onHelp: () => {
        matchMenu?.hide();
        closeOverlay();
        overlay = openHowToPlay(ui, { start: env.isTouch ? 'touch' : desktop.gamepadConnected ? 'gamepad' : 'desktop', version: env.version, onClose: () => ((overlay = null), matchMenu?.show()) });
      },
      onLeave: () => showTitle(),
    });
    matchChat = s.kind === 'net' ? createMatchChat(ui, (text) => net?.client.request({ t: 'chat', text }), (typing) => desktop.setTyping(typing)) : null;
    controls.target = null;
    if (env.isTouch) {
      // A quick tap on an enemy picks it as the missile target (tapping empty sky clears the pick).
      touch = createTouchControls(ui, controls, sensitivity, (x, y) => {
        const self = player();
        if (session && self) controls.target = targetAt(session.world, self, screenOfPlane, x, y);
      });
      if (me) touch.setPlane(me);
      touch.setOptions({ rudder: getSettings().touchRudder, tilt: getSettings().tiltSteer });
    }
    if (env.debug && s.net) netOverlay = createNetOverlay(ui);
    // A phone host can't keep the match running in the background: say so where it can't be missed.
    if (net?.isHost && env.isTouch) hud.notice("You're hosting on a phone: keep this screen on. Locking it or switching apps ends the match for everyone.", 9);
    if (era && !tutorialOf(s)) {
      const unlocks = s.kind === 'net' && net?.client.room?.allUnlocked ? 'all' : profile.unlocks();
      respawn = createRespawnPicker(ui, { planes: data.planes.filter((p) => p.era === era), unlocks, silhouettes }, (id) => session?.chooseRespawn(id));
    }
    profile.markMatchStart();
    desktop.setEnabled(true);
  }

  function endMatch(): void {
    const s = session;
    if (!s) return;
    if (tutorialOf(s)) {
      finishTutorial();
      showTitle('Tutorial done. Play Solo against bots, or Host / Join to fly with friends.');
      return;
    }
    const hostLeft = s.ended === 'hostLeft';
    // Multiplayer: back to the room, which shows the host's results and then the lobby, still connected.
    if (s.kind === 'net' && !hostLeft && net) {
      leaveMatch();
      showRoom();
      return;
    }
    const weLeft = hostLeft && droppedByUs();
    const results = computeResults(s.world);
    const me = s.playerId;
    const wasNet = s.kind === 'net';
    // The host left: everyone keeps the points earned so far (counted here, still capped by the rules).
    const saved = wasNet ? (recordNetMatch(results, me), lastNetMatch.id) : profile.recordSolo(results.rows.find((x) => x.id === me), results.winner);
    // A client whose phone was locked comes back to the same room (join in progress takes a bot's seat).
    const rejoin = wasNet && weLeft && net && !net.isHost ? net.code : null;
    leaveMatch();
    closeNet();
    if (rejoin) {
      void joinRoom(rejoin, true);
      return;
    }
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

  // In-match menu: pauses a solo match while open.
  function openMatchMenu(): void {
    if (!matchMenu || matchMenu.open) return;
    desktop.exitLock();
    desktop.releaseAll();
    touch?.releaseAll();
    if (session?.kind === 'solo') paused = true;
    matchMenu.show();
  }
  function closeMatchMenu(): void {
    matchMenu?.hide();
    paused = false;
  }
  // Quick chat (J) takes the digit keys while it's open, before the radar keys see them.
  window.addEventListener(
    'keydown',
    (e) => {
      if (mode === 'match' && matchChat?.quickKey(e.code)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
  let scoreHeld = false;

  /** One-shot actions from keys, buttons and touch: targets, secondary weapon, radar, views, menus. */
  function handlePresses(s: Session, me: PlaneState | null): void {
    const def = me ? ctx.planeDefs.get(me.planeId) : undefined;
    if (desktop.takeLockLost() && !matchMenu?.open && !controlsView) openMatchMenu();
    if (desktop.takePress('menu')) {
      if (matchMenu?.open) closeMatchMenu();
      else openMatchMenu();
    }
    if (desktop.takePress('pause') && s.kind === 'solo') {
      paused = !paused;
      hud?.notice(paused ? 'Paused. Press P to carry on.' : 'Carry on', paused ? 3600 : 1);
    }
    if (desktop.takePress('chat')) matchChat?.openInput();
    if (desktop.takePress('quickChat')) matchChat?.toggleQuick();
    if (desktop.takePress('map')) {
      mapOpen = !mapOpen;
      hud?.el.classList.toggle('is-map-open', mapOpen);
    }
    // Scoreboard: held on keyboard and gamepad.
    const scores = desktop.held('scoreboard');
    if (scores !== scoreHeld) {
      scoreHeld = scores;
      hud?.setScoreboard(scores ? scoreRows() : null);
    }
    desktop.takePress('scoreboard');
    if (desktop.takePress('switchView')) controls.view = controls.view === 'chase' ? 'hud' : 'chase';
    if (!me || !me.alive || !def) {
      for (const a of ['selectTarget', 'cycleSecondary', 'radarPower', 'radarMode', 'radarRange', 'radarLock'] as const) desktop.takePress(a);
      return;
    }
    if (desktop.takePress('selectTarget')) controls.target = selectTarget(s, me);
    const secondaryCount = def.missiles.length || (def.ordnance ? 2 : 0);
    if (desktop.takePress('cycleSecondary') || touch?.takePress('cycleSecondary')) {
      controls.cycleSecondary(secondaryCount);
      hud?.notice(`Secondary: ${secondaryName(me, controls.secondary)}`, 1.2);
    }
    if (def.radar) {
      if (desktop.takePress('radarPower')) {
        controls.radarOn = !controls.radarOn;
        if (!controls.radarOn) controls.radarLockWanted = false;
      }
      if (desktop.takePress('radarMode') || touch?.takePress('radarMode')) controls.cycleRadarMode(def.radar.modes);
      if (desktop.takePress('radarRange')) controls.cycleRadarRange();
      if (desktop.takePress('radarLock') || touch?.takePress('radarLock')) controls.toggleRadarLock(me);
    } else {
      for (const a of ['radarPower', 'radarMode', 'radarRange', 'radarLock'] as const) desktop.takePress(a);
      touch?.takePress('radarLock');
      touch?.takePress('radarMode');
    }
  }

  /** Middle mouse / T / Y: the enemy nearest the crosshair; pressed again within 1.5 s, the next one. */
  let lastSelectAt = -10;
  function selectTarget(s: Session, me: PlaneState): string | null {
    const again = clock - lastSelectAt < 1.5;
    lastSelectAt = clock;
    const aim = controls.aimDir();
    const list = s.world.planes
      .filter((p) => p.alive && p.team !== me.team)
      .map((p) => {
        const dx = p.pos[0] - me.pos[0], dy = p.pos[1] - me.pos[1], dz = p.pos[2] - me.pos[2];
        const d = Math.hypot(dx, dy, dz) || 1;
        return { id: p.id, d, angle: Math.acos(Math.max(-1, Math.min(1, (dx * aim[0] + dy * aim[1] + dz * aim[2]) / d))) };
      })
      .filter((t) => t.d < 12000 && t.angle < Math.PI / 2)
      // Nearest the crosshair, with a nudge toward closer planes (a far one barely off the nose loses to a near one).
      .sort((a, b) => a.angle + a.d / 60000 - (b.angle + b.d / 60000));
    if (list.length === 0) return null;
    const i = again ? list.findIndex((t) => t.id === controls.target) : -1;
    return i >= 0 ? list[(i + 1) % list.length]!.id : list[0]!.id;
  }

  function secondaryName(me: PlaneState, index: number): string {
    const def = ctx.planeDefs.get(me.planeId);
    if (!def) return '';
    if (def.ordnance) return index === 1 ? 'Bombs' : index === 0 ? 'Rockets' : 'Rockets, then bombs';
    if (index < 0) return 'Auto (best missile for the range)';
    const md = ctx.missileDefs.get(def.missiles[index]?.type ?? '');
    return md ? missileLabel(md) : '';
  }

  /** The plane's visual: the placeholder until its model has loaded, then the real model. */
  const visualPlane = new Map<string, string>();
  const ensureVisual = (p: PlaneState): PlaneVisual => {
    let v = visuals.get(p.id);
    // Rebuilt when the model finishes loading, or when the pilot respawns in a different plane.
    if (!v || visualOutdated(v, p.planeId) || visualPlane.get(p.id) !== p.planeId) {
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
  const NO_LOOK = { yaw: 0, pitch: 0 };
  const def0 = (p: PlaneState) => ctx.planeDefs.get(p.planeId)!;
  const projVec = new Vector3();
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

  // ---------------------------------------------------------------- sound
  const camPos = new Vector3();
  const camRel = new Vector3();
  /** Loudness 0–1 and stereo pan for a sound at a world position, heard from the camera. */
  const hear = (x: number, y: number, z: number, refM = 250): { gain: number; pan: number } => {
    camPos.copy(view.camera.position);
    const d = camRel.set(x, y, z).distanceTo(camPos);
    camRel.applyMatrix4(camInvSound.copy(view.camera.matrixWorld).invert());
    const pan = d > 1 ? Math.max(-1, Math.min(1, camRel.x / Math.max(30, d))) : 0;
    return { gain: 1 / (1 + Math.pow(d / refM, 1.4)), pan };
  };
  const camInvSound = new Matrix4();
  const soundForEvent = (e: GameEvent, myId: string): void => {
    if (e.t === 'explode' || e.t === 'detonate') {
      const h = hear(e.pos[0], e.pos[1], e.pos[2], 500);
      sound.explosion(h.gain, h.pan);
    } else if (e.t === 'unit') {
      const u = session?.world.objectives.units[e.id];
      if (u) {
        const h = hear(u.pos[0], u.pos[1], u.pos[2], 700);
        sound.explosion(h.gain, h.pan, true);
      }
    } else if (e.t === 'hit') {
      if (e.shooter === myId) sound.hit('dealt');
      if (e.victim === myId) sound.hit('taken');
    } else if (e.t === 'launch') {
      const shooter = session?.world.planes.find((p) => p.id === e.owner);
      if (shooter) {
        const h = hear(shooter.pos[0], shooter.pos[1], shooter.pos[2], 300);
        sound.whoosh(h.gain, h.pan);
      }
    } else if (e.t === 'drop' && e.kind === 'rocket') {
      const h = hear(e.pos[0], e.pos[1], e.pos[2], 300);
      sound.whoosh(h.gain * 0.7, h.pan);
    }
  };
  /** The loudest gun class on a plane (its heaviest gun). */
  const gunClassCache = new Map<string, GunClass>();
  const planeGunClass = (planeId: string): GunClass => {
    let c = gunClassCache.get(planeId);
    if (!c) {
      const order: GunClass[] = ['mg', 'hmg', 'cannon', 'heavy'];
      c = 'mg';
      for (const g of ctx.planeDefs.get(planeId)?.guns ?? []) {
        const k = gunClass(g.type);
        if (order.indexOf(k) > order.indexOf(c)) c = k;
      }
      gunClassCache.set(planeId, c);
    }
    return c;
  };
  const gunAcc = new Map<string, number>();
  const engineInputs: EngineInput[] = [];
  const enginePool: EngineInput[] = [];
  const engineNear: { p: PlaneState; d: number }[] = [];
  /** Engines (yours and the three nearest), and gunfire from you, nearby planes, AA sites and bomber gunners. */
  const updateSound = (s: Session, me: PlaneState | null, frameDt: number): void => {
    if (!sound.unlocked) return;
    const w = s.world;
    engineInputs.length = 0;
    engineNear.length = 0;
    const cam = view.camera.position;
    for (const p of w.planes) {
      if (!p.alive) continue;
      const d = Math.hypot(p.pos[0] - cam.x, p.pos[1] - cam.y, p.pos[2] - cam.z);
      if (p === me || d < 1600) engineNear.push({ p, d: p === me ? -1 : d });
    }
    engineNear.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(4, engineNear.length); i++) {
      const { p } = engineNear[i]!;
      const def = ctx.planeDefs.get(p.planeId);
      const params = ctx.params.get(p.planeId);
      if (!def || !params) continue;
      const e = enginePool[i] ?? ({} as EngineInput);
      enginePool[i] = e;
      const h = p === me ? { gain: 1, pan: 0 } : hear(p.pos[0], p.pos[1], p.pos[2], isBomber(w, p.id) ? 400 : 180);
      e.kind = PLANE_MODELS[p.planeId]?.engine ?? (isProp(def.era) ? 'inline' : 'jet');
      e.throttle = p.throttle;
      e.speed = Math.hypot(p.vel[0], p.vel[1], p.vel[2]) / params.topSpeedMs;
      e.afterburner = afterburner(p, def);
      e.gain = h.gain * (p === me ? 0.8 : 0.9);
      e.pan = h.pan;
      engineInputs.push(e);
    }
    sound.engines(engineInputs);
    // Guns: one shot sound per ~1/14 s while firing (yours), fewer and quieter for others.
    for (const p of w.planes) {
      if (!p.alive || !p.firing) {
        gunAcc.delete(p.id);
        continue;
      }
      const mine = p === me;
      const h = mine ? { gain: 0.9, pan: 0 } : hear(p.pos[0], p.pos[1], p.pos[2], 160);
      if (h.gain < 0.03) continue;
      const cls = isBomber(w, p.id) ? 'hmg' : planeGunClass(p.planeId);
      const rate = mine ? (cls === 'heavy' ? 9 : 14) : 8;
      let acc = (gunAcc.get(p.id) ?? Math.random()) + rate * frameDt;
      while (acc >= 1) {
        acc -= 1;
        sound.gunshot(cls, h.gain, h.pan);
      }
      gunAcc.set(p.id, acc);
    }
    for (const u of w.objectives.units) {
      if (!u.firing) continue;
      const key = `u${u.id}`;
      const h = hear(u.pos[0], u.pos[1], u.pos[2], 220);
      if (h.gain < 0.03) continue;
      let acc = (gunAcc.get(key) ?? Math.random()) + 5 * frameDt;
      while (acc >= 1) {
        acc -= 1;
        sound.gunshot('cannon', h.gain * 0.8, h.pan);
      }
      gunAcc.set(key, acc);
    }
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
      soundForEvent(e, myId);
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
        const u = w.objectives.units[e.id];
        if (u) effects.explosion(u.pos[0], u.pos[1] + 4, u.pos[2], true);
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
      // The screen's name goes into error reports.
      if (document.body.dataset['screen'] !== mode) {
        document.body.dataset['screen'] = mode;
        wakeLock.want(mode === 'room' || mode === 'match' || mode === 'connecting');
      }
      if (net && mode !== 'match') {
        tickHost(dt);
        net?.client.idle(dt);
      }
      // Room timers count down between host updates.
      if (roomView && Math.floor(clock * 4) !== Math.floor((clock - dt) * 4)) roomView.tick();
      if (mode !== 'match' || !session) return;
      const s = session;
      handlePresses(s, player());
      if (paused && s.kind === 'solo') return;
      // ?timescale speeds up solo only; a network match runs in real time.
      const steps = s.kind === 'solo' ? timeScale : 1;
      for (let step = 0; step < steps; step++) {
        const me = player();
        let input: ControlInput | null = null;
        if (me?.alive) {
          if (controls.target && !s.world.planes.some((p) => p.id === controls.target && p.alive)) controls.target = null;
          controls.fire = desktop.buttons.fire || (touch?.buttons.fire ?? false);
          controls.missile = desktop.buttons.missile || (touch?.buttons.missile ?? false) || desktop.takePress('fireSecondary') || (touch?.takeMissilePress() ?? false);
          controls.flare = desktop.buttons.flare || (touch?.buttons.flare ?? false);
          input = controls.sample(me, dt);
        }
        frameEvents.push(...s.step(dt, input));
        tickHost(dt);
        if (session !== s) return; // a network event ended the match mid-step
        const after = player();
        if (after && after.alive && !wasAlive) {
          controls.resetTo(after, Boolean(ctx.planeDefs.get(after.planeId)?.radar));
          maxG = 1;
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
      effects.update(frameDt, view.camera.position);
      ribbons.update(frameDt, view.camera.position);
      mapScene.update(clock, view.camera);
      // Count every pass of the frame (backdrop, scene, bloom) for the debug draw-call numbers.
      view.renderer.info.reset();
      post.render(drawScene);
      fps?.frame(frameDt);
      auto?.frame(frameDt);
    },
  }, () => (getSettings().cap30 ? 30 : 0));

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

  const trailAcc = new Map<string, number>();
  const tipLocal = new Vector3();
  const CONTRAIL_ALT_M = 8000;
  /** Planes whose ribbons are still being fed (they keep their last point at the wingtip until G drops). */
  const ribbonsLive = new Set<string>();
  function emitTrails(p: PlaneState, visual: PlaneVisual, mesh: Object3D, frameDt: number): void {
    const def = ctx.planeDefs.get(p.planeId);
    if (!def) return;
    const jet = !isProp(def.era) || PLANE_MODELS[p.planeId]?.engine === 'jet';
    const contrail = jet && p.pos[1] > CONTRAIL_ALT_M;
    const threshold = jet ? 6 : 5;
    const vapour = p.g > threshold;
    // Wingtip vapour ribbons (Medium/High): fed every frame while pulling, so they curve with the turn.
    if (!effectsLow && (vapour || ribbonsLive.has(p.id))) {
      const half = planeSize(def).wingspanM * 0.49;
      const strength = Math.min(1, Math.max(0, (p.g - threshold) / 2.5));
      for (const side of [1, -1]) {
        tipLocal.set(side * half, 0, -0.4).applyMatrix4(mesh.matrixWorld);
        ribbons.feed(`${p.id}${side}`, tipLocal, strength, frameDt);
      }
      if (vapour) ribbonsLive.add(p.id);
      else ribbonsLive.delete(p.id);
    }
    if (!contrail && !(vapour && effectsLow)) return;
    let acc = (trailAcc.get(p.id) ?? 0) + frameDt * (contrail ? 22 : 30);
    const half = planeSize(def).wingspanM * 0.48;
    while (acc >= 1) {
      acc -= 1;
      if (contrail) {
        if (visual.exhausts.length > 0) {
          for (const ex of visual.exhausts) {
            ex.getWorldPosition(vc);
            effects.emit('contrail', vc.x, vc.y, vc.z);
          }
        } else {
          const f = rotate(p.quat, FORWARD);
          effects.emit('contrail', mesh.position.x - f[0] * 8, mesh.position.y - f[1] * 8, mesh.position.z - f[2] * 8);
        }
      }
      if (vapour && effectsLow) {
        for (const side of [1, -1]) {
          tipLocal.set(side * half, 0, -0.5).applyMatrix4(mesh.matrixWorld);
          effects.emit('vapour', tipLocal.x, tipLocal.y, tipLocal.z);
        }
      }
    }
    trailAcc.set(p.id, acc);
  }

  const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
  const contacts: ScopeContact[] = [];
  const scopeMissiles: { mb: number; md: number; tb: number; td: number }[] = [];
  const projectDir = (d: Vec3): { x: number; y: number } | null => toScreen(projVec.copy(view.camera.position).add(vc.set(d[0], d[1], d[2]).multiplyScalar(3000)));

  /** The canvas HUD and the bottom-right panel: era HUD, radar scope, RWR, throttle / heat / hull bars. */
  let cockpitFrame = 0;
  let cockpitDt = 0;
  function drawCockpit(s: Session, me: PlaneState, def: NonNullable<ReturnType<typeof ctx.planeDefs.get>>, rwr: { angle: number; kind: string }[], frameDt: number, nose: { x: number; y: number } | null): void {
    if (!flightHud || !radarPanel) return;
    // On Low the two HUD canvases redraw at most 30 times a second (they're whole-screen 2D draws).
    cockpitDt += frameDt;
    if (quality === 'low' && cockpitFrame++ % 2 === 1 && cockpitDt < 1 / 20) return;
    frameDt = cockpitDt;
    cockpitDt = 0;
    const st = getSettings();
    const params = ctx.params.get(me.planeId)!;
    const compact = env.isTouch && window.innerHeight < 520;
    const speed = Math.hypot(me.vel[0], me.vel[1], me.vel[2]);
    const fwd = rotate(me.quat, FORWARD);
    const { yaw: heading, pitch } = yawPitchFromDir(fwd);
    const ground = Math.max(0, ctx.terrain.surfaceAt(me.pos[0], me.pos[2]));
    if (me.alive) maxG = Math.max(maxG, me.g);
    const local = rotate(quatConj(me.quat), me.vel);
    const aoa = speed > 5 ? (Math.atan2(-local[1], Math.max(1, local[2])) * 180) / Math.PI : 0;
    // Terrain under 4 s ahead along the flight path (or straight down while sinking).
    let pullUp = false;
    if (me.alive && speed > 20) {
      for (let t = 0.25; t <= 4; t += 0.25) {
        const x = me.pos[0] + me.vel[0] * t, y = me.pos[1] + me.vel[1] * t, z = me.pos[2] + me.vel[2] * t;
        if (y < ctx.terrain.surfaceAt(x, z) + 8) {
          pullUp = true;
          break;
        }
      }
    }
    const era = def.era;
    const style: HudStyle = era === 'cold_war' || era === 'modern' ? 'jet' : era === 'early_jets' ? 'gyro' : 'gunsight';
    const mslMax = def.missiles.reduce((a, m) => a + m.count, 0);
    const mslNow = me.missiles.reduce((a, b) => a + b, 0);
    const pick = controls.secondary;
    const secondary = def.ordnance
      ? `RKT ${me.rockets}  BMB ${me.bombs}${pick === 0 ? ' ‹R›' : pick === 1 ? ' ‹B›' : ''}`
      : mslMax > 0
        ? `MSL ${mslNow}/${mslMax}${pick >= 0 ? ` ${secondaryName(me, pick)}` : ''}`
        : '';
    const vdir: Vec3 = speed > 1 ? [me.vel[0] / speed, me.vel[1] / speed, me.vel[2] / speed] : fwd;
    flightHud.draw({
      style,
      units: st.units,
      compact,
      alive: me.alive,
      speedMs: speed,
      altM: me.pos[1],
      radarAltM: me.pos[1] - ground,
      heading,
      pitch,
      mach: speed / Math.max(295, 340.3 - 0.0041 * me.pos[1]),
      g: me.g,
      maxG,
      gLimit: params.maxG,
      aoaDeg: aoa,
      throttle: me.throttle,
      wep: me.wep,
      jet: isJet(def),
      heat: me.engineHeat,
      wepLeftS: (1 - me.engineHeat) * params.wepTimeS,
      overheatS: me.overheatFor,
      airbrake: controls.airbrake || controls.airbrakeHeld,
      flaps: controls.flaps,
      guns: me.ammo.reduce((a, b) => a + b, 0),
      secondary,
      flares: me.flares,
      pullUp,
      nose,
      fpm: me.alive ? projectDir(vdir) : null,
      project: projectDir,
    });

    // Radar scope.
    let radar: PanelFrame['radar'] = null;
    if (def.radar) {
      contacts.length = 0;
      scopeMissiles.length = 0;
      const w = s.world;
      const rangeKm = RADAR_RANGES_KM[controls.radarRange] ?? 10;
      const rangeM = Math.min(rangeKm * 1000, def.radar.rangeKm * 1000);
      let lock: NonNullable<PanelFrame['radar']>['lock'] = null;
      const bearingOf = (x: number, z: number): number => wrapAngle(Math.atan2(-(x - me.pos[0]), z - me.pos[2]) - heading);
      for (const p of w.planes) {
        if (p.id === me.id || !p.alive) continue;
        const dx = p.pos[0] - me.pos[0], dy = p.pos[1] - me.pos[1], dz = p.pos[2] - me.pos[2];
        const d = Math.hypot(dx, dy, dz);
        if (p.id === me.radarLock) {
          const closing = -((p.vel[0] - me.vel[0]) * dx + (p.vel[1] - me.vel[1]) * dy + (p.vel[2] - me.vel[2]) * dz) / Math.max(1, d);
          lock = { id: p.id, bearing: bearingOf(p.pos[0], p.pos[2]), distM: d, altM: p.pos[1], closingMs: closing };
          continue;
        }
        if (!controls.radarOn || d > rangeM || !radarSees(me, def.radar, p, ctx.planeDefs.get(p.planeId))) continue;
        contacts.push({ id: p.id, bearing: bearingOf(p.pos[0], p.pos[2]), distM: d, enemy: p.team !== me.team });
      }
      for (const m of w.missiles) {
        if (m.owner !== me.id || !m.target) continue;
        const t = w.planes.find((p) => p.id === m.target);
        if (!t) continue;
        scopeMissiles.push({
          mb: bearingOf(m.pos[0], m.pos[2]),
          md: Math.hypot(m.pos[0] - me.pos[0], m.pos[1] - me.pos[1], m.pos[2] - me.pos[2]),
          tb: bearingOf(t.pos[0], t.pos[2]),
          td: Math.hypot(t.pos[0] - me.pos[0], t.pos[1] - me.pos[1], t.pos[2] - me.pos[2]),
        });
      }
      radar = {
        on: controls.radarOn,
        mode: controls.radarDogfight ? 'dogfight' : 'search',
        rangeKm,
        coneDeg: def.radar.coneDeg,
        contacts,
        lock,
        missiles: scopeMissiles,
        lockWanted: controls.radarLockWanted,
      };
    }
    const cb = st.teamColours === 'colourblind';
    radarPanel.draw(
      {
        compact,
        radar,
        rwr: rwr as PanelFrame['rwr'],
        showRwr: def.missiles.length > 0 || def.countermeasures.flares + def.countermeasures.chaff > 0 || isJet(def),
        throttle: me.throttle,
        wep: me.wep,
        heat: me.engineHeat,
        overheat: me.overheatFor > 0,
        hp: Math.max(0, me.hp / me.maxHp),
        units: st.units,
        friendColor: '#5aa9ff',
        enemyColor: cb ? '#ff9f1c' : '#ff5a5a',
      },
      frameDt,
    );
    radarPanel.el.hidden = !me.alive;
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
      for (const prop of visual.props) prop.rotation.z += frameDt * (p.alive ? 12 + 55 * p.throttle : 4);
      // Muzzle flashes at every gun muzzle while firing.
      if (p.firing && visual.muzzles.length > 0) {
        for (const mz of visual.muzzles) {
          mz.getWorldPosition(vc);
          effects.emit('muzzle', vc.x, vc.y, vc.z);
        }
      }
      // Afterburner glow at every exhaust (or the tail when the model has none); jets out of afterburner get a
      // dull heat glow there instead (Day 11), brighter with throttle.
      const pDef = ctx.planeDefs.get(p.planeId);
      const lit = p.alive && afterburner(p, pDef);
      if (p.alive && pDef && (lit || (isJet(pDef) && p.throttle > 0.3 && !effectsLow))) {
        const size = Math.max(0.8, planeSize(pDef).lengthM / 16);
        const heat = lit ? 1 : Math.min(0.9, p.throttle * 0.8);
        const add = (x: number, y: number, z: number): void => {
          const g = burnerPool[burners.length] ?? { x: 0, y: 0, z: 0, size: 1, heat: 1 };
          burnerPool[burners.length] = g;
          g.x = x;
          g.y = y;
          g.z = z;
          g.size = size;
          g.heat = heat;
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
      // Contrails behind jets above 8,000 m, and vapour off the wingtips in hard turns (heavy effects only).
      if (p.alive && effects.heavy) emitTrails(p, visual, mesh, frameDt);
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
    const tut = tutorialOf(s);
    if (tut) {
      tutorialProps.update(tut.tutorial, clock);
      tutorialPanel?.update(tut.tutorial, env.isTouch ? 'touch' : desktop.gamepadConnected ? 'gamepad' : 'mouse');
    }
    burners.length = 0;
    if (!me) return;

    const meMesh = ensureMesh(me);
    mapScene.shadowTarget = meMesh;
    const sinceDeath = w.time - deathAt;
    let deathView: { phase: 'killcam' | 'respawn'; killer: string | null; respawnIn: number } | null = null;

    chase.setZoom(controls.zoom && me.alive);
    const hudView = controls.view === 'hud' && me.alive;
    // HUD view: no plane in the way (the camera sits at its nose).
    meMesh.visible = (me.alive || me.wreck) && !hudView;
    if (me.alive && hudView) {
      chase.updateCockpit(frameDt, meMesh.position, meMesh.quaternion, planeSize(def0(me)).lengthM * 0.5, controls.freeLook ? controls.look : NO_LOOK, speedKmh(me) / 3.6);
    } else if (me.alive) {
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
    // Tutorial balloons get the lead diamond too (where to put the nose).
    const tutBalloons = tutorialOf(s)?.tutorial;
    if (!leadScreen && me.alive && tutBalloons?.step === 'balloons') {
      let best = 1600;
      for (const b of tutBalloons.balloons) {
        if (b.popped) continue;
        const d = Math.hypot(b.pos[0] - me.pos[0], b.pos[1] - me.pos[1], b.pos[2] - me.pos[2]);
        if (d >= best || (b.pos[0] - me.pos[0]) * nose[0] + (b.pos[1] - me.pos[1]) * nose[1] + (b.pos[2] - me.pos[2]) * nose[2] < 0) continue;
        best = d;
        const lp = leadPoint(me.pos, me.vel, b.pos, [0, 0, 0], mv);
        leadScreen = toScreen(vc.set(lp[0] - me.pos[0], lp[1] - me.pos[1], lp[2] - me.pos[2]).add(meMesh.position));
      }
    }
    const aimScreen = me.alive ? toScreen(va.copy(meMesh.position).addScaledVector(aimVec.fromArray(aimDir), 1500)) : null;
    const noseScreen = me.alive ? toScreen(vb.copy(meMesh.position).add(vc.set(nose[0], nose[1], nose[2]).multiplyScalar(1500))) : null;
    const secondaryKeys = def.missiles.length
      ? `, ${keysText('fireSecondary')} missile, ${keysText('selectTarget')} target, ${keysText('countermeasures')} flares`
      : def.ordnance
        ? `, ${keysText('fireSecondary')} rockets and bombs`
        : '';
    const hint = env.isTouch || desktop.pointerLocked || desktop.gamepadConnected
      ? ''
      : desktop.cursorSteering
        ? `Hold the cursor where you want to fly. ${keysText('fireGuns')} fires guns${secondaryKeys}, ${keysText('scoreboard')} shows scores`
        : `Click to steer with the mouse. ${keysText('fireGuns')} fires guns${secondaryKeys}, ${keysText('throttleUp')}/${keysText('throttleDown')} throttle, ${keysText('scoreboard')} shows scores`;

    const cockpit = cockpitState(w, ctx, me, controls.target, screenOfPlane);
    audio.update(cockpit.seeker, cockpit.warning, clock);
    updateSound(s, me.alive ? me : null, frameDt);
    const secCount = def.missiles.length || (def.ordnance ? 2 : 0);
    touch?.setWeapons(
      cockpit.touch
        ? { ...cockpit.touch, label: controls.secondary >= 0 ? secondaryName(me, controls.secondary).split(' ')[0] ?? '' : 'AUTO', canSwitch: secCount > 1 }
        : def.ordnance
          ? { progress: 0, locked: false, missiles: me.rockets + me.bombs, flares: 0, chaff: 0, label: controls.secondary === 1 ? 'BOMB' : controls.secondary === 0 ? 'RKT' : 'AUTO', canSwitch: true }
          : null,
    );
    touch?.setRadar(def.radar ? { locked: Boolean(me.radarLock), dogfight: controls.radarDogfight, on: controls.radarOn } : null);
    drawCockpit(s, me, def, cockpit.frame?.rwr ?? [], frameDt, noseScreen);

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
  // A host's tab keeps simulating when hidden (timers instead of animation frames), so the match goes on.
  loop.keepRunningHidden(() => Boolean(net?.server));
  loop.start();
  // The title plane becomes a real Spitfire as soon as its model arrives.
  void loadPlane('spitfire_mk5').then(() => {
    if (!isModelReady('spitfire_mk5')) return;
    titlePlane = () => createPlaneVisual('spitfire_mk5', 'blue').root;
    for (const mw of mapWorlds.values()) mw.titleShot.setModel(titlePlane());
  });
  document.body.dataset['ready'] = 'true';

  // Day 11 renderer experiment: ?debug=1&webgpuprobe=1 (src/dev/webgpuProbe.ts, loaded only then).
  if (env.debug && params.get('webgpuprobe') === '1') {
    loop.stop();
    void import('./dev/webgpuProbe').then(async ({ runWebGpuProbe }) => {
      const r = await runWebGpuProbe(view.renderer);
      (window as unknown as { __webgpuProbe: unknown }).__webgpuProbe = r;
      console.info('webgpu probe', JSON.stringify(r));
    });
  }

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
      /** Day 11 cockpit switches and views, for the controls e2e tests. */
      cockpit: () => ({
        throttle: controls.throttle,
        rudder: controls.rudder,
        airbrake: controls.airbrake,
        flaps: controls.flaps,
        radarOn: controls.radarOn,
        radarDogfight: controls.radarDogfight,
        radarRange: controls.radarRange,
        radarLockWanted: controls.radarLockWanted,
        secondary: controls.secondary,
        target: controls.target,
        view: controls.view,
        zoom: controls.zoom,
        freeLook: controls.freeLook,
        mode: controls.mode,
        paused,
        menuOpen: matchMenu?.open ?? false,
        mapOpen,
      }),
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
      /** Solo only: put the player at x, z, `aglM` above the ground, flying toward `headingDeg` (0 = +Z). */
      placePlayer: (x: number, z: number, aglM: number, headingDeg = 0) => {
        const me = player();
        if (!session || session.kind !== 'solo' || !me) return false;
        const h = (headingDeg * Math.PI) / 180;
        const fwd = normalize([-Math.sin(h), 0, Math.cos(h)]);
        me.pos = [x, ctx.terrain.surfaceAt(x, z) + aglM, z];
        me.quat = quatLookRotation(fwd);
        me.vel = [fwd[0] * 200, 0, fwd[2] * 200];
        me.protectedFor = 30;
        controls.resetTo(me);
        chase.reset();
        return true;
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
      /** A phone being locked mid-match: hidden, then the connection found dead when it comes back. */
      lockAndDrop: () => {
        hiddenAt = performance.now();
        net?.client.dropForTest();
      },
      /** Tutorial: start it, read its state, skip to the next step. */
      startTutorial: () => startTutorial(),
      tutorial: () => {
        const t = tutorialOf(session)?.tutorial;
        return t ? { step: t.step, ring: t.ring, ringsHit: t.ringsHit, popped: t.balloons.filter((b) => b.popped).length, shots: t.shots, rings: t.rings.map((r) => [...r.pos]), balloons: t.balloons.map((b) => [...b.pos]) } : null;
      },
      tutorialNext: () => tutorialOf(session)?.advance(),
      /** Sound engine state (the iPhone test checks the first tap unlocks it). */
      sound: () => ({ state: sound.ctx?.state ?? 'none', unlocked: sound.unlocked, level: sound.level() }),
      drawCalls: () => view.renderer.info.render.calls,
      triangles: () => view.renderer.info.render.triangles,
      /** Profiling: hide or show one part of the map scene (sky, terrain, forest, clouds, ocean, horizon, far). */
      part: (name: string, visible: boolean) => {
        const o = mapScene.parts[name];
        if (o) o.visible = visible;
        return Object.keys(mapScene.parts);
      },
      forest: () => ({ trees: mapScene.stats.trees(), near: mapScene.stats.nearTrees(), terrainTriangles: mapScene.stats.terrainTriangles() }),
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

// Uncaught errors show a friendly card with "Copy error" (the screen name goes into the report).
const uiRoot = document.querySelector<HTMLElement>('#ui');
if (uiRoot) installErrorOverlay(uiRoot, env.version, () => document.body.dataset['screen'] ?? 'boot');
try {
  boot();
} catch (err) {
  console.error(err);
  reportError(err);
}
registerServiceWorker();
