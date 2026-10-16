// Day 11 renderer experiment (debug only: ?debug=1&webgpuprobe=1). Draws the same benchmark scene, a terrain
// grid like one map chunk ring plus 60,000 instanced trees with standard (PBR) materials, five seconds with
// three's WebGPURenderer (WebGPU, or its WebGL 2 fallback where the browser has no WebGPU) and five seconds with
// the WebGLRenderer the game uses, and puts the frame rates on window.__webgpuProbe.
// The game itself can't switch: its terrain, sky, clouds, impostor and effect shaders are GLSL (ShaderMaterial and
// onBeforeCompile), which WebGPURenderer doesn't run; they'd all have to be rewritten in TSL. See PROGRESS.md.
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  type WebGLRenderer,
} from 'three';

export interface ProbeResult {
  webgpuAvailable: boolean;
  /** Which backend WebGPURenderer actually used. */
  webgpuBackend: 'webgpu' | 'webgl2-fallback' | 'failed';
  webgpuFps: number;
  webglFps: number;
  error: string | null;
}

function benchScene(): { scene: Scene; camera: PerspectiveCamera; tick(t: number): void } {
  const scene = new Scene();
  scene.background = new Color('#bcd7ec');
  scene.add(new HemisphereLight(0xdaf0ff, 0x3d5a66, 1.2));
  const sun = new DirectionalLight(0xfff1d6, 2.5);
  sun.position.set(-0.4, 0.8, 0.5);
  scene.add(sun);
  const ground = new PlaneGeometry(8000, 8000, 200, 200).rotateX(-Math.PI / 2);
  const pos = ground.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, Math.sin(pos.getX(i) / 300) * 80 + Math.cos(pos.getZ(i) / 230) * 60);
  ground.computeVertexNormals();
  scene.add(new Mesh(ground, new MeshStandardMaterial({ color: '#4f7a3a', roughness: 0.95 })));
  const tree = new ConeGeometry(4, 18, 7).translate(0, 9, 0);
  const n = 60000;
  const trees = new InstancedMesh(tree, new MeshStandardMaterial({ color: '#1f4a2c', roughness: 0.9 }), n);
  const m = new Matrix4();
  for (let i = 0; i < n; i++) {
    const x = (Math.random() - 0.5) * 7000;
    const z = (Math.random() - 0.5) * 7000;
    m.makeTranslation(x, Math.sin(x / 300) * 80 + Math.cos(z / 230) * 60, z);
    trees.setMatrixAt(i, m);
  }
  scene.add(trees);
  scene.add(new Mesh(new BoxGeometry(12, 3, 16), new MeshStandardMaterial({ color: '#d9dde2', metalness: 0.3, roughness: 0.5 })));
  const camera = new PerspectiveCamera(65, innerWidth / innerHeight, 1, 9000);
  return {
    scene,
    camera,
    tick(t) {
      camera.position.set(Math.sin(t * 0.1) * 1500, 420, Math.cos(t * 0.1) * 1500);
      camera.lookAt(0, 60, 0);
    },
  };
}

async function measure(render: () => void, seconds: number): Promise<number> {
  let frames = 0;
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const f = (): void => {
      render();
      frames++;
      if (performance.now() - t0 < seconds * 1000) requestAnimationFrame(f);
      else resolve();
    };
    requestAnimationFrame(f);
  });
  return frames / ((performance.now() - t0) / 1000);
}

export async function runWebGpuProbe(webgl: WebGLRenderer, seconds = 5): Promise<ProbeResult> {
  const result: ProbeResult = { webgpuAvailable: 'gpu' in navigator, webgpuBackend: 'failed', webgpuFps: 0, webglFps: 0, error: null };
  const bench = benchScene();
  const t0 = performance.now();
  // WebGPURenderer on its own canvas over the game's.
  try {
    const { WebGPURenderer } = await import('three/webgpu');
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:40';
    document.body.appendChild(canvas);
    const r = new WebGPURenderer({ canvas, antialias: true });
    await r.init();
    r.setSize(innerWidth, innerHeight, false);
    r.setPixelRatio(Math.min(2, devicePixelRatio));
    const backend = (r as unknown as { backend: { isWebGPUBackend?: boolean } }).backend;
    result.webgpuBackend = backend.isWebGPUBackend ? 'webgpu' : 'webgl2-fallback';
    result.webgpuFps = await measure(() => {
      bench.tick((performance.now() - t0) / 1000);
      r.render(bench.scene, bench.camera);
    }, seconds);
    r.dispose();
    canvas.remove();
  } catch (err) {
    result.error = String(err);
  }
  // The game's WebGLRenderer, same scene.
  result.webglFps = await measure(() => {
    bench.tick((performance.now() - t0) / 1000);
    webgl.setRenderTarget(null);
    webgl.render(bench.scene, bench.camera);
  }, seconds);
  return result;
}
