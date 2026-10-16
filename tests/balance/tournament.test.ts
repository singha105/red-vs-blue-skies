// Runs the bot tournament for the eras in $ERAS (default all) with $DUELS duels per pair, and writes
// tests/balance/out/<era>.json. Started by `npm run balance` (tools/balance.mjs), one process per era.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { loadGameData, RAW_DATA } from '../../src/data';
import { eraTournament } from './tournament';

// $PLANES: another planes.json (the "before" run uses the Day 9 file from git).
const planesFile = process.env['PLANES'];
const result = loadGameData(planesFile ? { ...RAW_DATA, 'planes.json': JSON.parse(readFileSync(planesFile, 'utf8')) as unknown } : RAW_DATA);
if (!result.ok) throw new Error('data invalid');
const data = result.data;
const eras = (process.env['ERAS'] ?? data.eras.map((e) => e.id).join(',')).split(',');
const duels = Number(process.env['DUELS'] ?? 200);
const seed = Number(process.env['SEED'] ?? 1);
const out = new URL(`./${process.env['OUT'] ?? 'out'}/`, import.meta.url);

for (const era of eras) {
  it(`tournament ${era}`, () => {
    const t0 = Date.now();
    const pairs = eraTournament(data, era, duels, seed);
    mkdirSync(out, { recursive: true });
    writeFileSync(new URL(`${era}.json`, out), JSON.stringify({ era, duels, seed, seconds: (Date.now() - t0) / 1000, pairs }, null, 1));
    for (const p of pairs) console.log(`${era} T${p.lowerTier}→T${p.lowerTier + 1} ${p.lower} vs ${p.higher}: higher ${(p.higherRate * 100).toFixed(1)}% (${p.higherWins}-${p.lowerWins}, ${p.draws} draws)`);
  }, 3_600_000);
}
