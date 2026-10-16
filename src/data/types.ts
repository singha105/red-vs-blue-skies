// Shapes of the JSON files in src/data. Game logic reads these; nothing here imports Three.js.

export const ERA_IDS = ['ww1', 'early_ww2', 'late_ww2', 'early_jets', 'cold_war', 'modern'] as const;
export type EraId = (typeof ERA_IDS)[number];

export const MISSILE_CLASS_IDS = ['ir_rear', 'ir_all_aspect', 'ir_hobs', 'radar_semi_active', 'radar_active'] as const;
export type MissileClassId = (typeof MISSILE_CLASS_IDS)[number];

// Gun types used in planes.json; each has an entry in guns.json with rate of fire, velocity and damage.
export const GUN_TYPES = [
  'mg_792', // 7.92 mm LMG 08/15, MG 17
  'mg_303', // .303 Vickers / Lewis / Browning, 7.7 mm Type 97
  'mg_30', // .30 M1919 Browning
  'mg_762', // 7.62 mm ShKAS
  'mg_127', // 12.7 mm Breda-SAFAT, UBS
  'mg_13', // 13 mm MG 131
  'mg_50', // .50 M2 / M3 Browning
  'cannon_20mm', // 20 mm Hispano, MG 151/20, ShVAK
  'cannon_20mm_mgff', // 20 mm MG FF, Type 99-1 (low velocity)
  'cannon_20mm_colt', // 20 mm Colt Mk 12
  'cannon_20mm_m39', // 20 mm M39 revolver
  'cannon_20mm_m61', // 20 mm M61 Vulcan rotary
  'cannon_23mm', // 23 mm NR-23
  'cannon_23mm_gsh23', // 23 mm GSh-23L twin barrel
  'cannon_27mm', // 27 mm Mauser BK-27
  'cannon_30mm_mk108', // 30 mm MK 108 (low velocity)
  'cannon_30mm_nr30', // 30 mm NR-30
  'cannon_30mm_aden_defa', // 30 mm ADEN / DEFA revolvers
  'cannon_30mm_gsh301', // 30 mm GSh-30-1
  'cannon_30mm_giat', // 30 mm GIAT 30M791
  'cannon_37mm', // 37 mm M4, N-37
] as const;
export type GunType = (typeof GUN_TYPES)[number];

export type Vec3 = [number, number, number];

export interface Era {
  id: EraId;
  name: string;
  yearFrom: number;
  yearTo: number;
  weapons: string;
  missileClasses: MissileClassId[];
  /** Lowest tier allowed to carry missiles, or null if the era has none. */
  missileMinTier: number | null;
  /** Altitude where engines run out of air; thrust fades over the last 30%. */
  ceilingM: number;
  /** Stall speed as a fraction of the plane's (game) top speed. */
  stallSpeedRatio: number;
  /** Seconds of WEP / afterburner from a cold engine before it overheats. */
  wepTimeS: number;
}

export interface PlaneStats {
  topSpeedKmh: number;
  turnRateDegS: number;
  climbMs: number;
  rollRateDegS: number;
  hp: number;
}

export interface GunMount {
  type: GunType;
  count: number;
  ammoPerGun: number;
}

export interface MissileMount {
  type: string;
  count: number;
}

export interface Plane {
  id: string;
  name: string;
  era: EraId;
  tier: number;
  br: number;
  years: string;
  stats: PlaneStats;
  guns: GunMount[];
  missiles: MissileMount[];
  countermeasures: { flares: number; chaff: number };
  model: string;
  /** True only while a value is a placeholder that needs a better guess. Real data where easy, sensible guesses otherwise. */
  verify: boolean;
  /** Multiplier on the range at which enemies can radar-lock this plane (F-22A: 0.5). */
  radarSignature?: number;
  /** Unguided rockets and bombs on the pylons (Late WW2 attackers), released with the missile button. */
  ordnance?: { rockets: number; bombs: number };
  /** Search radar (jets that had one). Game values scaled to the 16 km maps. */
  radar?: PlaneRadar;
}

export type RadarMode = 'search' | 'lock' | 'dogfight';

export interface PlaneRadar {
  /** Detection and lock range, km. */
  rangeKm: number;
  /** Full scan width ahead of the nose, degrees (the scope's cone). */
  coneDeg: number;
  /** Always includes search and lock; dogfight (auto-lock in a narrow cone) on later sets. */
  modes: RadarMode[];
}

export interface MissileClass {
  id: MissileClassId;
  name: string;
  seeker: 'ir' | 'radar';
  aspect: 'rear' | 'all';
  guidance: 'passive' | 'semi_active' | 'active';
  coneDeg: number;
  lockTimeS: number;
  maxRangeM: number;
  beatenBy: string[];
}

export interface Missile {
  id: string;
  name: string;
  class: MissileClassId;
  coneDeg: number;
  lockTimeS: number;
  minRangeM: number;
  maxRangeM: number;
  speedMs: number;
  maxG: number;
  burnTimeS: number;
  /** 0–1: chance a single flare fails to decoy it. */
  flareResistance: number;
  /** 0–1: chance a single chaff bundle fails to decoy it. */
  chaffResistance: number;
  /** Percent of the target's max HP removed on a hit. */
  damage: number;
}

export interface MissilesFile {
  classes: MissileClass[];
  missiles: Missile[];
}

export interface GameMap {
  id: string;
  name: string;
  default: boolean;
  sizeM: number;
  seed: number;
  terrain: 'islands' | 'canyon' | 'mesas' | 'ocean';
  description: string;
  colors: Record<'skyTop' | 'skyHorizon' | 'water' | 'sand' | 'grass' | 'rock', string>;
  spawns: { red: Vec3; blue: Vec3 };
  zones: [number, number][];
}

export interface GameMode {
  id: 'tdm' | 'air_domination' | 'ground_strike' | 'bomber_escort';
  name: string;
  default: boolean;
  /** False until the mode's rules exist (Day 9); the lobby vote shows it as coming soon. */
  playable: boolean;
  description: string;
  timeLimitS: number;
  killLimit?: number;
  zones?: number;
  captureAltitudeM?: number;
  tickets?: number;
  /** Air Domination: zone radius, seconds for one plane to capture, tickets drained per held zone per second. */
  zoneRadiusM?: number;
  captureS?: number;
  drainPerZonePerS?: number;
  /** Tickets a team loses each time one of its planes goes down (ticket modes). */
  ticketsPerDeath?: number;
  /** Bomber Escort: bombers per wave, pause between waves, points for a bomber over the target or shot down,
   *  points per plane kill, and how close to the target a bomber must pass to drop. */
  formation?: number;
  waveGapS?: number;
  pointsDelivered?: number;
  pointsDowned?: number;
  pointsPerKill?: number;
  dropRadiusM?: number;
}

export const UNIT_KINDS = ['truck', 'tank', 'bunker', 'aa', 'ship', 'carrier', 'depot'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/** A ground target (Ground Strike, Carrier Strike, the Bomber Escort depot). HP is for Late WW2 and scales per era. */
export interface UnitDef {
  id: UnitKind;
  name: string;
  hp: number;
  /** Hit sphere radius; long units (ships) get a row of spheres along lengthM. */
  radiusM: number;
  lengthM?: number;
  /** Tickets the owning team loses when it is destroyed (Ground Strike). */
  tickets: number;
  speedKmh: number;
}

/** Guns that aren't on fighters: AA sites and bomber gunners. They fire in bursts with imperfect lead. */
export interface TurretDef {
  rangeM: number;
  roundsPerS: number;
  muzzleVelocityMs: number;
  damage: number;
  spreadDeg: number;
  leadQuality: number;
  burstS: number;
  pauseS: number;
}

export interface OrdnanceDef {
  /** Rocket motor speed added to the plane's (0 for bombs, which just fall). */
  speedMs: number;
  /** Damage at the centre, falling off to zero at splashM. */
  damage: number;
  splashM: number;
  /** Seconds between releases while the button is held. */
  intervalS: number;
}

export interface BomberDef {
  /** Model id in planeModels.json (public/models/bombers). */
  id: string;
  name: string;
  eras: EraId[];
  speedKmh: number;
  /** Late WW2 HP; scaled per era like ground units. */
  hp: number;
  altitudeM: number;
  /** A missile hit removes its damage % of this many HP (not of the bomber's whole HP). */
  missileHp: number;
}

export interface ObjectivesFile {
  eraHpScale: Record<EraId, number>;
  units: UnitDef[];
  aa: TurretDef;
  gunners: TurretDef;
  ordnance: { rocket: OrdnanceDef; bomb: OrdnanceDef };
  bombers: BomberDef[];
}

export interface Gun {
  id: GunType;
  name: string;
  /** Real rate of fire, rounds per minute. */
  rpm: number;
  /** Real muzzle velocity, m/s. */
  muzzleVelocityMs: number;
  /** HP removed per round that hits (game value). */
  damage: number;
  spreadDeg: number;
  tracerColor: string;
}

export interface GameData {
  guns: Gun[];
  eras: Era[];
  planes: Plane[];
  missiles: MissilesFile;
  maps: GameMap[];
  modes: GameMode[];
  objectives: ObjectivesFile;
}
