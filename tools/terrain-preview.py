# Hillshade previews of the baked heightmaps (tools/build/terrain-<map>.png), for eyeballing the erosion.
#   python3 tools/terrain-preview.py mountain_valley
import json, sys
import numpy as np
from PIL import Image

meta = json.load(open('src/data/heightfields.json'))
for mid in sys.argv[1:] or meta.keys():
    m = meta[mid]
    a = np.asarray(Image.open('public/' + m['file'])).astype(np.float64)
    h = m['minM'] + a / 65535 * (m['maxM'] - m['minM'])
    cell = 16000 / (m['res'] - 1)
    gy, gx = np.gradient(h, cell)
    # Sun from the north-west, 45° up.
    nx, ny, nz = -gx, -gy, np.ones_like(h)
    l = np.sqrt(nx * nx + ny * ny + nz * nz)
    shade = np.clip((nx * -0.5 + ny * -0.5 + nz * 0.707) / l, 0, 1)
    col = np.stack([shade * 0.55 + h / 2400, shade * 0.6 + h / 3000, shade * 0.5 + h / 3000], -1)
    col[h < 0] = [0.2, 0.35, 0.5]
    Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).resize((768, 768)).save(f'tools/build/terrain-{mid}.png')
    print('wrote', f'tools/build/terrain-{mid}.png')
