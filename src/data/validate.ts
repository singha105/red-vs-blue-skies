// Validates the raw JSON data files. Pure TypeScript (runs in the browser and in Vitest).
import {
  ERA_IDS,
  GUN_TYPES,
  MISSILE_CLASS_IDS,
  UNIT_KINDS,
  type EraId,
  type GameData,
} from './types';

export const DATA_FILES = ['guns.json', 'eras.json', 'planes.json', 'missiles.json', 'maps.json', 'modes.json', 'objectives.json'] as const;
export type DataFileName = (typeof DATA_FILES)[number];

export interface DataError {
  file: DataFileName;
  path: string;
  message: string;
}

export type RawData = Record<DataFileName, unknown>;

export type ValidationResult = { ok: true; data: GameData } | { ok: false; errors: DataError[] };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const HEX = /^#[0-9a-f]{6}$/i;
const ID = /^[a-z0-9_]+$/;

/** Battle Rating from tier: 1.0 + 0.3 × (tier − 1). */
export function brForTier(tier: number): number {
  return Math.round((1 + 0.3 * (tier - 1)) * 10) / 10;
}

class Checker {
  readonly errors: DataError[] = [];
  constructor(private file: DataFileName) {}

  at(file: DataFileName): this {
    this.file = file;
    return this;
  }

  fail(path: string, message: string): void {
    this.errors.push({ file: this.file, path, message });
  }

  obj(v: unknown, path: string): Obj | null {
    if (isObj(v)) return v;
    this.fail(path, `expected an object, got ${describe(v)}`);
    return null;
  }

  arr(v: unknown, path: string): unknown[] | null {
    if (Array.isArray(v)) return v;
    this.fail(path, `expected an array, got ${describe(v)}`);
    return null;
  }

  str(o: Obj, key: string, path: string, pattern?: RegExp): string | null {
    const v = o[key];
    if (typeof v !== 'string' || v.length === 0) {
      this.fail(`${path}.${key}`, `expected a non-empty string, got ${describe(v)}`);
      return null;
    }
    if (pattern && !pattern.test(v)) {
      this.fail(`${path}.${key}`, `"${v}" does not match ${pattern}`);
      return null;
    }
    return v;
  }

  num(o: Obj, key: string, path: string, min: number, max: number, integer = false): number | null {
    const v = o[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.fail(`${path}.${key}`, `expected a number, got ${describe(v)}`);
      return null;
    }
    if (v < min || v > max) {
      this.fail(`${path}.${key}`, `${v} is outside ${min}–${max}`);
      return null;
    }
    if (integer && !Number.isInteger(v)) {
      this.fail(`${path}.${key}`, `${v} must be a whole number`);
      return null;
    }
    return v;
  }

  bool(o: Obj, key: string, path: string): boolean | null {
    const v = o[key];
    if (typeof v !== 'boolean') {
      this.fail(`${path}.${key}`, `expected true or false, got ${describe(v)}`);
      return null;
    }
    return v;
  }

  oneOf<T extends string>(o: Obj, key: string, path: string, allowed: readonly T[]): T | null {
    const v = o[key];
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      this.fail(`${path}.${key}`, `${describe(v)} is not one of: ${allowed.join(', ')}`);
      return null;
    }
    return v as T;
  }

  vec(v: unknown, path: string, length: number): void {
    if (!Array.isArray(v) || v.length !== length || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      this.fail(path, `expected ${length} numbers, got ${describe(v)}`);
    }
  }

  uniqueIds(items: unknown[], path: string): Set<string> {
    const seen = new Set<string>();
    items.forEach((item, i) => {
      const id = isObj(item) ? item['id'] : undefined;
      if (typeof id !== 'string') return;
      if (seen.has(id)) this.fail(`${path}[${i}].id`, `duplicate id "${id}"`);
      seen.add(id);
    });
    return seen;
  }
}

function describe(v: unknown): string {
  if (v === undefined) return 'nothing';
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'an array';
  if (typeof v === 'string') return `"${v}"`;
  if (typeof v === 'object') return 'an object';
  return String(v);
}

export function validateGameData(raw: RawData): ValidationResult {
  const c = new Checker('guns.json');

  // guns.json
  const guns = c.arr(raw['guns.json'], 'guns') ?? [];
  const gunIds = new Set<string>();
  guns.forEach((g, i) => {
    const p = `guns[${i}]`;
    const o = c.obj(g, p);
    if (!o) return;
    const id = c.oneOf(o, 'id', p, GUN_TYPES);
    c.str(o, 'name', p);
    c.num(o, 'rpm', p, 60, 7000, true);
    c.num(o, 'muzzleVelocityMs', p, 200, 1500);
    c.num(o, 'damage', p, 0.1, 100);
    c.num(o, 'spreadDeg', p, 0, 5);
    c.str(o, 'tracerColor', p, HEX);
    if (id) gunIds.add(id);
  });
  c.uniqueIds(guns, 'guns');
  for (const id of GUN_TYPES) {
    if (!gunIds.has(id)) c.fail('guns', `missing gun type "${id}"`);
  }

  c.at('eras.json');

  // eras.json
  const eras = c.arr(raw['eras.json'], 'eras') ?? [];
  const eraMissileClasses = new Map<EraId, string[]>();
  const eraMinTier = new Map<EraId, number | null>();
  eras.forEach((e, i) => {
    const p = `eras[${i}]`;
    const o = c.obj(e, p);
    if (!o) return;
    const id = c.oneOf(o, 'id', p, ERA_IDS);
    c.str(o, 'name', p);
    c.str(o, 'weapons', p);
    const from = c.num(o, 'yearFrom', p, 1900, 2100, true);
    const to = c.num(o, 'yearTo', p, 1900, 2100, true);
    if (from !== null && to !== null && from > to) c.fail(p, `yearFrom ${from} is after yearTo ${to}`);
    c.num(o, 'ceilingM', p, 2000, 25000, true);
    c.num(o, 'stallSpeedRatio', p, 0.05, 0.8);
    c.num(o, 'wepTimeS', p, 5, 600);
    const classes = c.arr(o['missileClasses'], `${p}.missileClasses`) ?? [];
    classes.forEach((cls, j) => {
      if (typeof cls !== 'string' || !(MISSILE_CLASS_IDS as readonly string[]).includes(cls)) {
        c.fail(`${p}.missileClasses[${j}]`, `${describe(cls)} is not a missile class`);
      }
    });
    const minTier = o['missileMinTier'];
    if (minTier !== null) c.num(o, 'missileMinTier', p, 1, 10, true);
    if (classes.length > 0 && minTier === null) c.fail(`${p}.missileMinTier`, 'era has missile classes but no missileMinTier');
    if (id) {
      eraMissileClasses.set(id, classes.filter((x): x is string => typeof x === 'string'));
      eraMinTier.set(id, typeof minTier === 'number' ? minTier : null);
    }
  });
  c.uniqueIds(eras, 'eras');
  for (const id of ERA_IDS) {
    if (!eraMissileClasses.has(id)) c.fail('eras', `missing era "${id}"`);
  }

  // missiles.json
  c.at('missiles.json');
  const missilesFile = c.obj(raw['missiles.json'], 'missiles.json');
  const missileClassById = new Map<string, string>();
  if (missilesFile) {
    const classes = c.arr(missilesFile['classes'], 'classes') ?? [];
    classes.forEach((cl, i) => {
      const p = `classes[${i}]`;
      const o = c.obj(cl, p);
      if (!o) return;
      c.oneOf(o, 'id', p, MISSILE_CLASS_IDS);
      c.str(o, 'name', p);
      c.oneOf(o, 'seeker', p, ['ir', 'radar'] as const);
      c.oneOf(o, 'aspect', p, ['rear', 'all'] as const);
      c.oneOf(o, 'guidance', p, ['passive', 'semi_active', 'active'] as const);
      c.num(o, 'coneDeg', p, 1, 180);
      c.num(o, 'lockTimeS', p, 0, 10);
      c.num(o, 'maxRangeM', p, 100, 20000);
      c.arr(o['beatenBy'], `${p}.beatenBy`);
    });
    c.uniqueIds(classes, 'classes');

    const missiles = c.arr(missilesFile['missiles'], 'missiles') ?? [];
    missiles.forEach((mi, i) => {
      const p = `missiles[${i}]`;
      const o = c.obj(mi, p);
      if (!o) return;
      const id = c.str(o, 'id', p, ID);
      c.str(o, 'name', p);
      const cls = c.oneOf(o, 'class', p, MISSILE_CLASS_IDS);
      c.num(o, 'coneDeg', p, 1, 180);
      c.num(o, 'lockTimeS', p, 0, 10);
      const min = c.num(o, 'minRangeM', p, 0, 20000);
      const max = c.num(o, 'maxRangeM', p, 100, 20000);
      if (min !== null && max !== null && min >= max) c.fail(p, `minRangeM ${min} must be below maxRangeM ${max}`);
      c.num(o, 'speedMs', p, 100, 2000);
      c.num(o, 'maxG', p, 1, 100);
      c.num(o, 'burnTimeS', p, 0, 60);
      c.num(o, 'flareResistance', p, 0, 1);
      c.num(o, 'chaffResistance', p, 0, 1);
      c.num(o, 'damage', p, 70, 100);
      if (id && cls) missileClassById.set(id, cls);
    });
    c.uniqueIds(missiles, 'missiles');
  }

  // planes.json
  c.at('planes.json');
  const planes = c.arr(raw['planes.json'], 'planes') ?? [];
  const tiersByEra = new Map<string, Set<number>>();
  planes.forEach((pl, i) => {
    const o = c.obj(pl, `planes[${i}]`);
    if (!o) return;
    const p = `planes[${i}] (${typeof o['id'] === 'string' ? o['id'] : '?'})`;
    const id = c.str(o, 'id', p, ID);
    c.str(o, 'name', p);
    const era = c.oneOf(o, 'era', p, ERA_IDS);
    const tier = c.num(o, 'tier', p, 1, 10, true);
    const br = c.num(o, 'br', p, 1, 3.7);
    if (tier !== null && br !== null && Math.abs(br - brForTier(tier)) > 1e-6) {
      c.fail(`${p}.br`, `${br} should be ${brForTier(tier)} for tier ${tier}`);
    }
    c.str(o, 'years', p, /^\d{4}(–\d{4})?$/);
    const stats = c.obj(o['stats'], `${p}.stats`);
    if (stats) {
      c.num(stats, 'topSpeedKmh', `${p}.stats`, 80, 3500);
      c.num(stats, 'turnRateDegS', `${p}.stats`, 5, 60);
      c.num(stats, 'climbMs', `${p}.stats`, 1, 400);
      c.num(stats, 'rollRateDegS', `${p}.stats`, 20, 400);
      c.num(stats, 'hp', `${p}.stats`, 20, 300, true);
    }
    const guns = c.arr(o['guns'], `${p}.guns`) ?? [];
    if (guns.length === 0) c.fail(`${p}.guns`, 'every plane needs at least one gun');
    guns.forEach((g, j) => {
      const gp = `${p}.guns[${j}]`;
      const go = c.obj(g, gp);
      if (!go) return;
      c.oneOf(go, 'type', gp, GUN_TYPES);
      c.num(go, 'count', gp, 1, 12, true);
      c.num(go, 'ammoPerGun', gp, 1, 2000, true);
    });
    const missiles = c.arr(o['missiles'], `${p}.missiles`) ?? [];
    let missileTotal = 0;
    missiles.forEach((mi, j) => {
      const mp = `${p}.missiles[${j}]`;
      const mo = c.obj(mi, mp);
      if (!mo) return;
      const type = c.str(mo, 'type', mp);
      const count = c.num(mo, 'count', mp, 1, 8, true);
      if (count !== null) missileTotal += count;
      if (!type) return;
      const cls = missileClassById.get(type);
      if (!cls) {
        c.fail(`${mp}.type`, `unknown missile "${type}" (not in missiles.json)`);
        return;
      }
      if (era && !(eraMissileClasses.get(era) ?? []).includes(cls)) {
        c.fail(`${mp}.type`, `${type} is class ${cls}, which era ${era} does not allow`);
      }
    });
    if (missiles.length > 0) {
      if (missileTotal < 2 || missileTotal > 6) c.fail(`${p}.missiles`, `carries ${missileTotal} missiles; the rule is 2–6`);
      const minTier = era ? eraMinTier.get(era) : null;
      if (tier !== null && (minTier === null || minTier === undefined || tier < minTier)) {
        c.fail(`${p}.missiles`, `tier ${tier} in era ${era} may not carry missiles`);
      }
    }
    const cm = c.obj(o['countermeasures'], `${p}.countermeasures`);
    if (cm) {
      c.num(cm, 'flares', `${p}.countermeasures`, 0, 120, true);
      c.num(cm, 'chaff', `${p}.countermeasures`, 0, 120, true);
    }
    if (era && id) {
      const model = c.str(o, 'model', p);
      if (model && model !== `models/${era}/${id}.glb`) c.fail(`${p}.model`, `should be "models/${era}/${id}.glb"`);
    }
    c.bool(o, 'verify', p);
    if (o['radarSignature'] !== undefined) c.num(o, 'radarSignature', p, 0.1, 1);
    if (o['radar'] !== undefined) {
      const r = c.obj(o['radar'], `${p}.radar`);
      if (r) {
        c.num(r, 'rangeKm', `${p}.radar`, 3, 40);
        c.num(r, 'coneDeg', `${p}.radar`, 20, 140);
        const modes = r['modes'];
        if (!Array.isArray(modes) || !modes.every((m) => m === 'search' || m === 'lock' || m === 'dogfight') || !modes.includes('search') || !modes.includes('lock')) {
          c.fail(`${p}.radar.modes`, 'must list "search" and "lock", optionally "dogfight"');
        }
      }
      if (era && !['early_jets', 'cold_war', 'modern'].includes(era)) c.fail(`${p}.radar`, 'only jets carry a radar');
    }
    // Radar-guided missiles need the launcher's radar lock (semi-active: until impact).
    const radarMissile = missiles.some((mi) => {
      const t = typeof mi === 'object' && mi !== null ? (mi as Record<string, unknown>)['type'] : null;
      return typeof t === 'string' && (missileClassById.get(t) ?? '').startsWith('radar');
    });
    if (radarMissile && o['radar'] === undefined) c.fail(`${p}.radar`, 'carries radar-guided missiles, so it needs a radar block');
    if (o['ordnance'] !== undefined) {
      const ord = c.obj(o['ordnance'], `${p}.ordnance`);
      if (ord) {
        c.num(ord, 'rockets', `${p}.ordnance`, 0, 12, true);
        c.num(ord, 'bombs', `${p}.ordnance`, 0, 4, true);
      }
      if (missiles.length > 0) c.fail(`${p}.ordnance`, 'a plane carries missiles or ordnance, not both (one button fires them)');
    }
    if (era && tier !== null) {
      const set = tiersByEra.get(era) ?? new Set<number>();
      if (set.has(tier)) c.fail(`${p}.tier`, `era ${era} already has a tier ${tier} plane`);
      set.add(tier);
      tiersByEra.set(era, set);
    }
  });
  c.uniqueIds(planes, 'planes');
  for (const era of ERA_IDS) {
    const n = tiersByEra.get(era)?.size ?? 0;
    if (n !== 10) c.fail('planes', `era ${era} has ${n} planes; it needs exactly 10 (tiers 1–10)`);
  }

  // maps.json
  c.at('maps.json');
  const maps = c.arr(raw['maps.json'], 'maps') ?? [];
  maps.forEach((mp, i) => {
    const p = `maps[${i}]`;
    const o = c.obj(mp, p);
    if (!o) return;
    c.str(o, 'id', p, ID);
    c.str(o, 'name', p);
    c.str(o, 'description', p);
    c.bool(o, 'default', p);
    const size = c.num(o, 'sizeM', p, 2000, 64000, true);
    c.num(o, 'seed', p, 0, 2 ** 32 - 1, true);
    c.oneOf(o, 'terrain', p, ['islands', 'canyon', 'mesas', 'ocean'] as const);
    const colors = c.obj(o['colors'], `${p}.colors`);
    if (colors) {
      for (const k of ['skyTop', 'skyHorizon', 'water', 'sand', 'grass', 'rock']) c.str(colors, k, `${p}.colors`, HEX);
    }
    const sun = c.obj(o['sun'], `${p}.sun`);
    if (sun) {
      c.num(sun, 'azimuthDeg', `${p}.sun`, -360, 360);
      c.num(sun, 'elevationDeg', `${p}.sun`, 10, 85);
    }
    c.num(o, 'snowLineM', p, 0, 20000);
    c.str(o, 'forestColor', p, HEX);
    c.num(o, 'horizonRangeM', p, 0, 5000);
    const spawns = c.obj(o['spawns'], `${p}.spawns`);
    if (spawns) {
      c.vec(spawns['red'], `${p}.spawns.red`, 3);
      c.vec(spawns['blue'], `${p}.spawns.blue`, 3);
    }
    const zones = c.arr(o['zones'], `${p}.zones`) ?? [];
    zones.forEach((z, j) => {
      c.vec(z, `${p}.zones[${j}]`, 2);
      if (size !== null && Array.isArray(z) && z.some((n) => typeof n === 'number' && Math.abs(n) > size / 2)) {
        c.fail(`${p}.zones[${j}]`, 'zone is outside the map');
      }
    });
  });
  c.uniqueIds(maps, 'maps');
  if (maps.filter((m) => isObj(m) && m['default'] === true).length !== 1) c.fail('maps', 'exactly one map must be default');

  // modes.json
  c.at('modes.json');
  const modes = c.arr(raw['modes.json'], 'modes') ?? [];
  modes.forEach((md, i) => {
    const p = `modes[${i}]`;
    const o = c.obj(md, p);
    if (!o) return;
    c.oneOf(o, 'id', p, ['tdm', 'air_domination', 'ground_strike', 'bomber_escort'] as const);
    c.str(o, 'name', p);
    c.str(o, 'description', p);
    c.bool(o, 'default', p);
    c.bool(o, 'playable', p);
    c.num(o, 'timeLimitS', p, 60, 3600, true);
    for (const k of ['killLimit', 'zones', 'captureAltitudeM', 'tickets', 'zoneRadiusM', 'ticketsPerDeath', 'formation', 'pointsDelivered', 'pointsDowned', 'pointsPerKill', 'dropRadiusM']) {
      if (o[k] !== undefined) c.num(o, k, p, 1, 10000, true);
    }
    for (const k of ['captureS', 'drainPerZonePerS', 'waveGapS']) {
      if (o[k] !== undefined) c.num(o, k, p, 0.01, 600);
    }
    // A playable mode needs its rules' numbers.
    if (o['playable'] === true) {
      const need: Record<string, string[]> = {
        air_domination: ['zones', 'captureAltitudeM', 'tickets', 'zoneRadiusM', 'captureS', 'drainPerZonePerS', 'ticketsPerDeath'],
        ground_strike: ['tickets', 'ticketsPerDeath'],
        bomber_escort: ['formation', 'waveGapS', 'pointsDelivered', 'pointsDowned', 'pointsPerKill', 'dropRadiusM'],
      };
      for (const k of need[String(o['id'])] ?? []) if (o[k] === undefined) c.fail(`${p}.${k}`, `${String(o['id'])} needs ${k} to be playable`);
    }
  });
  c.uniqueIds(modes, 'modes');
  if (modes.filter((m) => isObj(m) && m['default'] === true).length !== 1) c.fail('modes', 'exactly one mode must be default');
  if (!modes.some((m) => isObj(m) && m['default'] === true && m['playable'] === true)) c.fail('modes', 'the default mode must be playable');

  // objectives.json: ground units, AA, bomber gunners, rockets and bombs, AI bombers
  c.at('objectives.json');
  const obj = c.obj(raw['objectives.json'], 'objectives');
  if (obj) {
    const scale = c.obj(obj['eraHpScale'], 'eraHpScale');
    if (scale) for (const era of ERA_IDS) c.num(scale, era, 'eraHpScale', 0.01, 10);
    const units = c.arr(obj['units'], 'units') ?? [];
    const kinds = new Set<string>();
    units.forEach((u, i) => {
      const p = `units[${i}]`;
      const o = c.obj(u, p);
      if (!o) return;
      const id = c.oneOf(o, 'id', p, UNIT_KINDS);
      if (id) kinds.add(id);
      c.str(o, 'name', p);
      c.num(o, 'hp', p, 1, 100000);
      c.num(o, 'radiusM', p, 1, 100);
      if (o['lengthM'] !== undefined) c.num(o, 'lengthM', p, 1, 400);
      c.num(o, 'tickets', p, 0, 1000, true);
      c.num(o, 'speedKmh', p, 0, 100);
    });
    for (const k of UNIT_KINDS) if (!kinds.has(k)) c.fail('units', `missing unit "${k}"`);
    for (const key of ['aa', 'gunners']) {
      const t = c.obj(obj[key], key);
      if (!t) continue;
      c.num(t, 'rangeM', key, 50, 5000);
      c.num(t, 'roundsPerS', key, 0.1, 60);
      c.num(t, 'muzzleVelocityMs', key, 100, 2000);
      c.num(t, 'damage', key, 0, 100);
      c.num(t, 'spreadDeg', key, 0, 10);
      c.num(t, 'leadQuality', key, 0, 1);
      c.num(t, 'burstS', key, 0.1, 30);
      c.num(t, 'pauseS', key, 0, 30);
    }
    const ord = c.obj(obj['ordnance'], 'ordnance');
    if (ord) {
      for (const key of ['rocket', 'bomb']) {
        const t = c.obj(ord[key], `ordnance.${key}`);
        if (!t) continue;
        c.num(t, 'speedMs', `ordnance.${key}`, 0, 2000);
        c.num(t, 'damage', `ordnance.${key}`, 1, 100000);
        c.num(t, 'splashM', `ordnance.${key}`, 1, 500);
        c.num(t, 'intervalS', `ordnance.${key}`, 0.05, 10);
      }
    }
    const bombers = c.arr(obj['bombers'], 'bombers') ?? [];
    const covered = new Set<string>();
    bombers.forEach((b, i) => {
      const p = `bombers[${i}]`;
      const o = c.obj(b, p);
      if (!o) return;
      c.str(o, 'id', p, ID);
      c.str(o, 'name', p);
      const eras = c.arr(o['eras'], `${p}.eras`) ?? [];
      eras.forEach((e, j) => {
        if (typeof e !== 'string' || !(ERA_IDS as readonly string[]).includes(e)) c.fail(`${p}.eras[${j}]`, `unknown era ${describe(e)}`);
        else if (covered.has(e)) c.fail(`${p}.eras[${j}]`, `era ${e} already has a bomber`);
        else covered.add(e);
      });
      c.num(o, 'speedKmh', p, 50, 1500);
      c.num(o, 'hp', p, 1, 100000);
      c.num(o, 'altitudeM', p, 200, 12000);
      c.num(o, 'missileHp', p, 1, 100000);
    });
    for (const era of ERA_IDS) if (!covered.has(era)) c.fail('bombers', `no bomber for era ${era}`);
  }

  if (c.errors.length > 0) return { ok: false, errors: c.errors };
  return {
    ok: true,
    data: {
      guns: raw['guns.json'],
      eras: raw['eras.json'],
      planes: raw['planes.json'],
      missiles: raw['missiles.json'],
      maps: raw['maps.json'],
      modes: raw['modes.json'],
      objectives: raw['objectives.json'],
    } as GameData,
  };
}
