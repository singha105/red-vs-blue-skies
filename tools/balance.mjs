// Bot tournament driver: one Vitest process per era, all at once (each era is independent).
//   npm run balance                 200 duels per adjacent pair in every era → tests/balance/out/<era>.json + a table
//   npm run balance -- tune         tune HP and turn rate per era (tests/balance/tune.test.ts), then write planes.json
//   npm run balance -- before       the same tournament on the planes.json in git HEAD → tests/balance/before/
// Env: DUELS, SEED, ROUNDS (tune), ERAS (comma list).
import { spawn, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const mode = process.argv[2] ?? 'run';
const eras = (process.env.ERAS ?? 'ww1,early_ww2,late_ww2,early_jets,cold_war,modern').split(',');

function run(file, env) {
  return Promise.all(
    eras.map(
      (era) =>
        new Promise((resolve, reject) => {
          const child = spawn('npx', ['vitest', 'run', '--config', 'vitest.balance.config.ts', file], {
            cwd: root,
            env: { ...process.env, ...env, ERAS: era },
            stdio: ['ignore', 'pipe', 'inherit'],
          });
          let text = '';
          child.stdout.on('data', (d) => (text += d));
          child.on('exit', (code) => (code === 0 ? resolve(text) : reject(new Error(`${era}: exit ${code}\n${text}`))));
        }),
    ),
  );
}

function table(dir) {
  const rows = [];
  for (const era of eras) {
    const d = JSON.parse(readFileSync(new URL(`tests/balance/${dir}/${era}.json`, root), 'utf8'));
    for (const p of d.pairs) rows.push(`${era.padEnd(11)} T${p.lowerTier}→${p.lowerTier + 1} ${p.lower.padEnd(14)} vs ${p.higher.padEnd(14)} ${(p.higherRate * 100).toFixed(1).padStart(5)}%  ${p.higherWins}-${p.lowerWins} (${p.draws} draws)`);
  }
  console.log(rows.join('\n'));
}

const t0 = Date.now();
if (mode === 'tune') {
  await run('tests/balance/tune.test.ts', {});
  const file = new URL('src/data/planes.json', root);
  let text = readFileSync(file, 'utf8');
  for (const era of eras) {
    const tuned = JSON.parse(readFileSync(new URL(`tests/balance/out/tune-${era}.json`, root), 'utf8'));
    console.log(`${era}: best band distance ${tuned.best.score.toFixed(3)}`);
    for (const s of tuned.best.stats) {
      // planes.json keeps one line per stats block: rewrite hp and turn rate in the block after this id.
      const at = text.indexOf(`"id": "${s.id}"`);
      const line = text.indexOf('"stats":', at);
      const end = text.indexOf('}', line);
      const stats = text.slice(line, end).replace(/"turnRateDegS": [\d.]+/, `"turnRateDegS": ${s.turnRateDegS}`).replace(/"hp": \d+/, `"hp": ${s.hp}`);
      text = text.slice(0, line) + stats + text.slice(end);
    }
  }
  writeFileSync(file, text);
  console.log('planes.json updated');
} else if (mode === 'before') {
  const dir = new URL('tests/balance/before/', root);
  mkdirSync(dir, { recursive: true });
  const old = new URL('planes.head.json', dir);
  writeFileSync(old, execSync('git show HEAD:src/data/planes.json', { cwd: root }));
  await run('tests/balance/tournament.test.ts', { PLANES: old.pathname, OUT: 'before' });
  table('before');
} else {
  await run('tests/balance/tournament.test.ts', {});
  table('out');
}
console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
