// Boot and app flow: title screen ↔ free flight. One renderer and one map scene are shared by both.
import './fonts.css';
import './styles.css';
import { Group, Quaternion, Vector3 } from 'three';
import { env } from './core/env';
import { createDesktopInput } from './core/input';
import { createLoop } from './core/loop';
import { createPlayerControls } from './core/playerControls';
import { createAutoQuality, initialLevel, QUALITY, type QualityLevel } from './core/quality';
import { getSettings, onSettingsChange } from './core/settings';
import { loadGameData } from './data';
import type { GameData } from './data/types';
import { speedKmh, type PlaneState } from './game/flight';
import { dirFromYawPitch, FORWARD, rotate, type Quat, type Vec3 } from './game/math';
import { createWorld, createWorldContext, spawnPlane, stepWorld, type WorldState } from './game/world';
import { createChaseCamera } from './render/chaseCamera';
import { createMapScene } from './render/mapScene';
import { createPlaceholderPlane } from './render/planeMesh';
import { createView } from './render/renderer';
import { createTitleShot } from './render/titleShot';
import { showDataErrors } from './ui/errorOverlay';
import { createFpsCounter } from './ui/fps';
import { createHud, type Hud } from './ui/hud';
import { createTitleScreen, type TitleScreen } from './ui/title';
import { createTouchControls, type TouchControls } from './ui/touchControls';

const PLAYER_ID = 'p1';
const DEFAULT_PLANE = 'spitfire_mk5';

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
  const planeParam = params.get('plane');

  const view = createView(canvas, { antialias: !env.isTouch && settings.graphics !== 'low' && forced !== 'low' });
  const ctx = createWorldContext(data, map.id);
  const mapScene = createMapScene(map, ctx.terrain);
  const titleShot = createTitleShot(mapScene.scene, ctx.terrain);

  let quality: QualityLevel = forced ?? initialLevel(settings.graphics, env.isTouch);
  const applyQuality = (level: QualityLevel): void => {
    quality = level;
    view.setMaxPixelRatio(QUALITY[level].maxPixelRatio);
    mapScene.setQuality(level, view.renderer, view.camera);
  };
  applyQuality(quality);
  let auto = !forced && settings.graphics === 'auto' ? createAutoQuality((level) => applyQuality(level)) : null;
  onSettingsChange((s) => {
    if (forced) return;
    if (s.graphics === 'auto') {
      auto = createAutoQuality((level) => applyQuality(level));
    } else {
      auto = null;
      applyQuality(s.graphics);
    }
  });

  const controls = createPlayerControls();
  const sensitivity = (): number => getSettings().sensitivity;
  const desktop = createDesktopInput(canvas, controls, sensitivity);
  const chase = createChaseCamera(view.camera);

  // --- Flight session state ---
  let mode: 'title' | 'flight' = 'title';
  let world: WorldState | null = null;
  let hud: Hud | null = null;
  let touch: TouchControls | null = null;
  let title: TitleScreen | null = null;
  const meshes = new Map<string, Group>();
  const prev = new Map<string, { pos: Vec3; quat: Quat }>();
  let wasAlive = true;

  const player = (): PlaneState | null => world?.planes.find((p) => p.id === PLAYER_ID) ?? null;

  const showTitle = (): void => {
    mode = 'title';
    document.body.classList.remove('is-flying');
    desktop.setEnabled(false);
    hud?.dispose();
    hud = null;
    touch?.dispose();
    touch = null;
    for (const mesh of meshes.values()) mapScene.scene.remove(mesh);
    meshes.clear();
    world = null;
    mapScene.shadowTarget = null;
    titleShot.setVisible(true);
    title = createTitleScreen(ui, env.version, {
      onSolo: startFlight,
      onHostJoin: () => title?.setNote('Hosting and joining friends is coming soon.'),
    });
  };

  function startFlight(): void {
    title?.dispose();
    title = null;
    titleShot.setVisible(false);
    mode = 'flight';
    document.body.classList.add('is-flying');
    world = createWorld(ctx);
    const planeId = planeParam && ctx.params.has(planeParam) ? planeParam : DEFAULT_PLANE;
    const p = spawnPlane(world, ctx, { id: PLAYER_ID, team: 'blue', planeId });
    controls.resetTo(p);
    controls.freeLook = false;
    chase.reset();
    wasAlive = true;
    hud = createHud(ui, showTitle);
    if (env.isTouch) {
      touch = createTouchControls(ui, controls, sensitivity);
      touch.setPlane(p);
    }
    desktop.setEnabled(true);
  }

  const ensureMesh = (p: PlaneState): Group => {
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
  const aimVec = new Vector3();
  const lookVec = new Vector3();
  const proj = new Vector3();
  const toScreen = (world: Vector3): { x: number; y: number } | null => {
    proj.copy(world).project(view.camera);
    if (proj.z > 1 || proj.z < -1) return null;
    return { x: (proj.x * 0.5 + 0.5) * window.innerWidth, y: (-proj.y * 0.5 + 0.5) * window.innerHeight };
  };

  const fps = env.debug ? createFpsCounter(ui) : null;
  let fpsAvg = 0;
  let clock = 0;

  const loop = createLoop({
    update(dt) {
      clock += dt;
      if (mode !== 'flight' || !world) return;
      for (const p of world.planes) prev.set(p.id, { pos: [...p.pos], quat: [...p.quat] });
      const me = player();
      const inputs: Record<string, ReturnType<typeof controls.sample>> = {};
      if (me?.alive) {
        controls.fire = desktop.buttons.fire || (touch?.buttons.fire ?? false);
        controls.missile = desktop.buttons.missile || (touch?.buttons.missile ?? false);
        controls.flare = desktop.buttons.flare || (touch?.buttons.flare ?? false);
        inputs[PLAYER_ID] = controls.sample(me, dt);
      }
      stepWorld(world, ctx, inputs, dt);
      const after = player();
      if (after && after.alive && !wasAlive) {
        // Respawned: aim at the new heading and snap the camera behind.
        controls.resetTo(after);
        chase.reset();
        prev.delete(after.id);
        touch?.setPlane(after);
      }
      wasAlive = after?.alive ?? false;
    },
    render(alpha, frameDt) {
      fpsAvg = fpsAvg === 0 ? 1 / frameDt : fpsAvg * 0.95 + (1 / Math.max(frameDt, 1e-3)) * 0.05;
      if (mode === 'title') {
        titleShot.update(clock, frameDt, view.camera);
      } else if (world) {
        const me = player();
        desktop.update(frameDt, me);
        touch?.sync();
        for (const p of world.planes) {
          const mesh = ensureMesh(p);
          mesh.visible = p.alive;
          if (!p.alive) continue;
          const before = prev.get(p.id);
          if (before) {
            va.fromArray(before.pos);
            vb.fromArray(p.pos);
            mesh.position.lerpVectors(va, vb, alpha);
            qa.fromArray(before.quat);
            qb.fromArray(p.quat);
            mesh.quaternion.slerpQuaternions(qa, qb, alpha);
          } else {
            mesh.position.fromArray(p.pos);
            mesh.quaternion.fromArray(p.quat);
          }
        }
        if (me) {
          const mesh = ensureMesh(me);
          mapScene.shadowTarget = mesh;
          aimVec.fromArray(controls.aimDir());
          let freeDir: Vector3 | null = null;
          if (controls.freeLook) {
            lookVec.fromArray(dirFromYawPitch(controls.aim.yaw + controls.look.yaw, controls.aim.pitch + controls.look.pitch));
            freeDir = lookVec;
          }
          const speed = speedKmh(me);
          chase.update(frameDt, mesh.position, aimVec, speed / 3.6, freeDir);
          const aimPoint = va.copy(mesh.position).addScaledVector(aimVec, 1500);
          const aimScreen = toScreen(aimPoint);
          const nose = rotate(me.quat, FORWARD);
          const nosePoint = vb.copy(mesh.position).add(proj.set(nose[0], nose[1], nose[2]).multiplyScalar(1500));
          const noseScreen = toScreen(nosePoint);
          const hint = env.isTouch || desktop.pointerLocked || desktop.gamepadConnected
            ? ''
            : desktop.cursorSteering
              ? 'Hold the cursor where you want to fly. W/S throttle, C looks around'
              : 'Click to steer with the mouse. W/S throttle, arrow keys fly directly, C looks around';
          hud?.update({
            speedKmh: speed,
            altitudeM: me.pos[1],
            throttle: me.throttle,
            g: me.g,
            stalled: me.stalled,
            edgeWarning: me.edgeWarning,
            autoTurn: me.autoTurn,
            alive: me.alive,
            respawnIn: me.respawnIn,
            aim: aimScreen,
            nose: noseScreen,
            map: { x: me.pos[0] / ctx.terrain.half, z: me.pos[2] / ctx.terrain.half, heading: Math.atan2(-nose[0], nose[2]) },
            freeLook: controls.freeLook,
            hint,
          });
        }
      }
      mapScene.update(clock, view.camera);
      view.renderer.render(mapScene.scene, view.camera);
      fps?.frame(frameDt);
      auto?.frame(frameDt);
    },
  });

  showTitle();
  loop.start();
  document.body.dataset['ready'] = 'true';

  if (env.debug) {
    // Test and debugging hooks (Playwright reads these). Only with ?debug=1.
    (window as unknown as { __rvbs: unknown }).__rvbs = {
      mode: () => mode,
      startSolo: () => {
        if (mode === 'title') startFlight();
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
