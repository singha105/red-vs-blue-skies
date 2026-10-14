// Boot: settings → data validation → renderer → title screen with the test scene behind it.
import './fonts.css';
import './styles.css';
import { env } from './core/env';
import { createInput } from './core/input';
import { createLoop } from './core/loop';
import { getSettings, onSettingsChange } from './core/settings';
import { loadGameData } from './data';
import { createView } from './render/renderer';
import { createTestScene } from './render/testScene';
import { showDataErrors } from './ui/errorOverlay';
import { createFpsCounter } from './ui/fps';
import { createTitleScreen } from './ui/title';

function boot(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#game');
  const ui = document.querySelector<HTMLElement>('#ui');
  if (!canvas || !ui) throw new Error('index.html is missing #game or #ui');

  const result = loadGameData();
  if (!result.ok) {
    showDataErrors(ui, result.errors);
    return;
  }
  const data = result.data;
  const map = data.maps.find((m) => m.default) ?? data.maps[0];
  if (!map) throw new Error('maps.json has no maps');

  const settings = getSettings();
  const view = createView(canvas, settings.graphics);
  onSettingsChange((s) => view.setGraphics(s.graphics));
  const scene = createTestScene(map);
  createInput(canvas);

  const title = createTitleScreen(ui, env.version, {
    onSolo: () => title.setNote('Solo matches against bots are coming soon.'),
    onHostJoin: () => title.setNote('Hosting and joining friends is coming soon.'),
  });

  const fps = env.debug ? createFpsCounter(ui) : null;
  let simTime = 0;
  const loop = createLoop({
    update(dt) {
      simTime += dt;
    },
    render(_alpha, frameDt) {
      scene.update(simTime, frameDt, view.camera);
      view.renderer.render(scene.scene, view.camera);
      fps?.frame(frameDt);
    },
  });
  loop.start();
  document.body.dataset['ready'] = 'true';
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
