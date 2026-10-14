// Boot and app flow: title → solo setup → match → results. One renderer and one map scene are shared.
import './fonts.css';
import './styles.css';
import { Matrix4, Quaternion, Vector3, type Mesh } from 'three';
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
import { createSoloMatch, PLAYER_ID, stepMatch, type Match } from './game/match';
import { dirFromYawPitch, FORWARD, rotate, type Quat, type Vec3 } from './game/math';
import { createWorldContext, type GameEvent } from './game/world';
import { createChaseCamera } from './render/chaseCamera';
import { createEffects } from './render/effects';
import { createMapScene } from './render/mapScene';
import { createPlaceholderPlane } from './render/planeMesh';
import { createView } from './render/renderer';
import { createTitleShot } from './render/titleShot';
import { createTracers } from './render/tracers';
import { showDataErrors } from './ui/errorOverlay';
import { createFpsCounter } from './ui/fps';
import { createHud, escapeHtml as esc, type Hud, type Marker, type ScoreRow } from './ui/hud';
import { showResults } from './ui/results';
import { openSettings } from './ui/settingsPanel';
import { createSoloSetup, type SoloChoice } from './ui/soloSetup';
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
  type Mode = 'title' | 'setup' | 'match' | 'results';
  let mode: Mode = 'title';
  let screen: { dispose(): void } | null = null;
  let match: Match | null = null;
  let lastChoice: SoloChoice | null = null;
  let hud: Hud | null = null;
  let touch: TouchControls | null = null;
  const meshes = new Map<string, Mesh>();
  const prev = new Map<string, { pos: Vec3; quat: Quat }>();
  const frameEvents: GameEvent[] = [];
  let wasAlive = true;
  let deathAt = 0;
  let killerId: string | null = null;
  let endedAt = 0;
  let clock = 0;

  const player = (): PlaneState | null => match?.world.planes.find((p) => p.id === PLAYER_ID) ?? null;
  const pilotName = (id: string | null): string => (id ? match?.world.pilots[id]?.name ?? id : '');
  const planeName = (id: string): string => ctx.planeDefs.get(id)?.name ?? id;

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
    for (const mesh of meshes.values()) mapScene.scene.remove(mesh);
    meshes.clear();
    prev.clear();
    match = null;
    endedAt = 0;
    mapScene.shadowTarget = null;
    document.body.classList.remove('is-flying');
  };

  function showTitle(): void {
    leaveMatch();
    clearScreen();
    mode = 'title';
    titleShot.setVisible(true);
    const title = createTitleScreen(ui, env.version, {
      onSolo: showSetup,
      onHostJoin: () => title.setNote('Hosting and joining friends is coming soon.'),
      onSettings: () => openSettings(ui, { isTouch: env.isTouch }),
    });
    screen = title;
  }

  function showSetup(): void {
    clearScreen();
    mode = 'setup';
    screen = createSoloSetup(ui, data, { allUnlocked: env.debug }, { onStart: startMatch, onBack: showTitle });
  }

  function startMatch(choice: SoloChoice): void {
    clearScreen();
    leaveMatch();
    lastChoice = choice;
    titleShot.setVisible(false);
    mode = 'match';
    document.body.classList.add('is-flying');
    match = createSoloMatch(ctx, {
      era: choice.era,
      planeId: choice.planeId,
      difficulty: choice.difficulty,
      assist: env.isTouch ? getSettings().aimAssist : 0,
      ...(matchTime ? { timeLimitS: matchTime } : {}),
    });
    const me = player()!;
    controls.resetTo(me);
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
      touch.setPlane(me);
    }
    desktop.setEnabled(true);
  }

  function endMatch(): void {
    if (!match) return;
    const m = match.world.match;
    const rows = scoreRows();
    leaveMatch();
    mode = 'results';
    screen = showResults(ui, { winner: m.winner, score: m.score, rows, yourTeam: 'blue' }, {
      onAgain: () => (lastChoice ? startMatch(lastChoice) : showSetup()),
      onTitle: showTitle,
    });
  }

  function scoreRows(): ScoreRow[] {
    if (!match) return [];
    const w = match.world;
    return Object.values(w.pilots)
      .map((p) => {
        const st = w.stats[p.id]!;
        const plane = w.planes.find((x) => x.id === p.id);
        return { name: p.name, team: p.team, plane: plane ? planeName(plane.planeId) : '', ...st, you: p.id === PLAYER_ID };
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

  const ensureMesh = (p: PlaneState): Mesh => {
    let mesh = meshes.get(p.id);
    if (!mesh) {
      mesh = createPlaceholderPlane(p.team);
      meshes.set(p.id, mesh);
      mapScene.scene.add(mesh);
    }
    return mesh;
  };

  // Scratch objects reused every frame.
  const qa = new Quaternion();
  const qb = new Quaternion();
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
    if (!match || !hud) {
      frameEvents.length = 0;
      return;
    }
    const me = player();
    for (const e of frameEvents) {
      if (e.t === 'explode') {
        effects.explosion(e.pos[0], e.pos[1], e.pos[2]);
        if (me && vc.set(e.pos[0], e.pos[1], e.pos[2]).distanceTo(view.camera.position) < 250) chase.shake(0.5);
      } else if (e.t === 'hit') {
        effects.emit('spark', e.pos[0], e.pos[1], e.pos[2]);
        if (e.shooter === PLAYER_ID) hud.hitMarker(false);
        if (e.victim === PLAYER_ID) {
          chase.shake(0.15);
          const attacker = match.world.planes.find((p) => p.id === e.shooter);
          if (attacker) {
            camInv.copy(view.camera.matrixWorld).invert();
            vc.set(attacker.pos[0], attacker.pos[1], attacker.pos[2]).applyMatrix4(camInv);
            hud.damageFrom(Math.atan2(vc.x, vc.y));
          }
        }
      } else if (e.t === 'kill') {
        const victim = match.world.pilots[e.victim];
        const killer = e.killer ? match.world.pilots[e.killer] : null;
        const tag = (p: { name: string; team: string } | null | undefined): string => (p ? `<b class="t-${p.team}">${esc(p.name)}</b>` : '');
        const html = killer ? `${tag(killer)} shot down ${tag(victim)}` : `${tag(victim)} crashed`;
        const mine = e.killer === PLAYER_ID || e.victim === PLAYER_ID || e.assists.includes(PLAYER_ID);
        hud.killFeed(html, mine);
        if (e.killer === PLAYER_ID) hud.hitMarker(true);
        if (e.victim === PLAYER_ID) {
          killerId = e.killer;
          deathAt = match.world.time;
        }
      }
    }
    frameEvents.length = 0;
  };

  const fps = env.debug ? createFpsCounter(ui) : null;
  let fpsAvg = 0;

  const loop = createLoop({
    update(dt) {
      clock += dt;
      if (mode !== 'match' || !match) return;
      for (let step = 0; step < timeScale; step++) {
        const w = match.world;
        for (const p of w.planes) {
          const before = prev.get(p.id);
          if (before) {
            before.pos[0] = p.pos[0]; before.pos[1] = p.pos[1]; before.pos[2] = p.pos[2];
            before.quat[0] = p.quat[0]; before.quat[1] = p.quat[1]; before.quat[2] = p.quat[2]; before.quat[3] = p.quat[3];
          } else prev.set(p.id, { pos: [...p.pos], quat: [...p.quat] });
        }
        const me = player();
        const inputs: Record<string, ControlInput> = {};
        if (me?.alive) {
          controls.fire = desktop.buttons.fire || (touch?.buttons.fire ?? false);
          controls.missile = desktop.buttons.missile || (touch?.buttons.missile ?? false);
          controls.flare = desktop.buttons.flare || (touch?.buttons.flare ?? false);
          inputs[PLAYER_ID] = controls.sample(me, dt);
        }
        stepMatch(match, ctx, inputs, dt);
        frameEvents.push(...w.events);
        for (const e of w.events) if (e.t === 'spawn') prev.delete(e.id);
        const after = player();
        if (after && after.alive && !wasAlive) {
          controls.resetTo(after);
          chase.reset();
          touch?.setPlane(after);
        }
        wasAlive = after?.alive ?? false;
        if (w.match.state === 'ended' && endedAt === 0) endedAt = clock;
      }
      if (endedAt > 0 && clock - endedAt > RESULTS_DELAY_S) endMatch();
    },
    render(alpha, frameDt) {
      fpsAvg = fpsAvg === 0 ? 1 / frameDt : fpsAvg * 0.95 + (1 / Math.max(frameDt, 1e-3)) * 0.05;
      if (mode !== 'match' || !match) {
        titleShot.update(clock, frameDt, view.camera);
        tracers.update([], 0, 0, view.camera.position);
      } else {
        renderMatch(match, alpha, frameDt);
      }
      effects.update(frameDt);
      mapScene.update(clock, view.camera);
      view.renderer.render(mapScene.scene, view.camera);
      fps?.frame(frameDt);
      auto?.frame(frameDt);
    },
  });

  function renderMatch(m: Match, alpha: number, frameDt: number): void {
    const w = m.world;
    const me = player();
    desktop.update(frameDt, me);
    touch?.sync();
    handleEvents();

    for (const p of w.planes) {
      const mesh = ensureMesh(p);
      mesh.visible = p.alive || p.wreck;
      if (!mesh.visible) continue;
      const before = prev.get(p.id);
      if (before) {
        mesh.position.lerpVectors(va.fromArray(before.pos), vb.fromArray(p.pos), alpha);
        mesh.quaternion.slerpQuaternions(qa.fromArray(before.quat), qb.fromArray(p.quat), alpha);
      } else {
        mesh.position.fromArray(p.pos);
        mesh.quaternion.fromArray(p.quat);
      }
      // Smoke from damaged engines, fire, and falling wrecks.
      const rate = (p.wreck ? 40 : (p.fireFor > 0 ? 30 : 0) + (p.damaged.engine ? 18 : 0)) * effects.density;
      if (rate > 0) {
        let acc = (smokeAcc.get(p.id) ?? 0) + rate * frameDt;
        const f = rotate(p.quat, FORWARD);
        while (acc >= 1) {
          acc -= 1;
          const x = mesh.position.x - f[0] * 3, y = mesh.position.y - f[1] * 3, z = mesh.position.z - f[2] * 3;
          effects.emit(p.fireFor > 0 || (p.wreck && Math.random() < 0.4) ? 'fire' : p.wreck ? 'darkSmoke' : 'smoke', x, y, z);
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
      if (p.id === PLAYER_ID || !p.alive) continue;
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
  loop.start();
  document.body.dataset['ready'] = 'true';

  if (env.debug) {
    // Test and debugging hooks (Playwright reads these). Only with ?debug=1.
    (window as unknown as { __rvbs: unknown }).__rvbs = {
      mode: () => mode,
      startSolo: (choice?: Partial<SoloChoice>) =>
        startMatch({ era: 'early_ww2', planeId: 'spitfire_mk5', difficulty: 'normal', ...choice }),
      match: () =>
        match
          ? { state: match.world.match.state, score: { ...match.world.match.score }, timeLeftS: match.world.match.timeLeftS, planes: match.world.planes.length, bullets: match.world.bullets.length }
          : null,
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
