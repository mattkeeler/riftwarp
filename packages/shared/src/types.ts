// ---- Entity ID ----
export type EntityId = number;

// ---- Components ----

export interface Position {
  x: number;
  y: number;
}

export interface Velocity {
  vx: number;
  vy: number;
}

export interface Rotation {
  angle: number; // degrees [0, 360)
  rotateSpeed: number;
}

export interface Physics {
  maxThrust: number;
  thrustPower: number;
  friction: number;
  bounded: boolean;
  rebound: number;
}

export interface Health {
  current: number;
  max: number;
}

export interface CollisionShape {
  type: 'rect' | 'poly';
  width?: number;
  height?: number;
  vertices?: Array<{ x: number; y: number }>;
}

export interface Collision {
  shape: CollisionShape;
  layer: 'good' | 'bad';
  damage: number;
}

export interface Lifespan {
  remaining: number;
}

export interface ShipStats {
  shipType: ShipType;
  gunLevel: number;
  thrustLevel: number;
  hasRetros: boolean;
  specialType: SpecialType;
  trackingCannons: number;
}

export interface PowerupInventory {
  items: PowerupType[];
}

export interface Shield {
  ticksLeft: number;
}

export interface EmpEffect {
  ticksLeft: number;
  scrambleType: number;
}

export interface Portal {
  orbitDegrees: number;
  playerId: string;
  damageAccumulated: number;
}

export interface Tracking {
  targetId: EntityId | null;
  firingRate: number;
  lastFiredTick: number;
}

export interface AIBehavior {
  type: 'track' | 'orbit' | 'wander' | 'wallcrawl';
  targetId: EntityId | null;
}

// ---- Entity ----

export interface Entity {
  id: EntityId;
  type: EntityType;
  ownerId: string; // player who owns/spawned this entity
  position: Position;
  velocity: Velocity;
  rotation: Rotation;
  physics?: Physics;
  health?: Health;
  collision?: Collision;
  lifespan?: Lifespan;
  shipStats?: ShipStats;
  powerupInventory?: PowerupInventory;
  shield?: Shield;
  emp?: EmpEffect;
  portal?: Portal;
  tracking?: Tracking;
  ai?: AIBehavior;
  powerupType?: PowerupType; // for powerup entities
  dead?: boolean;
}

// ---- Enums ----

export enum EntityType {
  Ship = 'ship',
  Bullet = 'bullet',
  Powerup = 'powerup',
  Portal = 'portal',
  HeatSeeker = 'heatseeker',
  Turret = 'turret',
  Mine = 'mine',
  UFO = 'ufo',
  Inflater = 'inflater',
  MineLayer = 'minelayer',
  Gunship = 'gunship',
  Scarab = 'scarab',
  Nuke = 'nuke',
  WallCrawler = 'wallcrawler',
  SweepBeam = 'sweepbeam',
  EMP = 'emp',
  GhostPud = 'ghostpud',
  Artillery = 'artillery',
  Explosion = 'explosion',
  Shrapnel = 'shrapnel',
  Particle = 'particle',
  ThrustParticle = 'thrustparticle',
}

export enum ShipType {
  Tank = 0,
  Wing = 1,
  Squid = 2,
  Rabbit = 3,
  Turtle = 4,
  Flash = 5,
  Hunter = 6,
  Flagship = 7,
}

export enum SpecialType {
  None = 0,
  TurtleCannon = 1,
  Shapeshifter = 2,
  HeatSeekerLauncher = 3,
  PowerupAttractor = 4,
}

export enum PowerupType {
  GunUpgrade = 0,
  ThrustUpgrade = 1,
  Retros = 2,
  Invulnerability = 3,
  ClearScreen = 4,
  ExtraHealth = 5,
  HeatSeeker = 6,
  Turret = 7,
  Mines = 8,
  UFO = 9,
  Inflater = 10,
  MineLayer = 11,
  Gunship = 12,
  Scarab = 13,
  Nuke = 14,
  WallCrawler = 15,
  SweepBeam = 16,
  EMP = 17,
  GhostPud = 18,
  Artillery = 19,
}

export enum TeamId {
  None = 0,
  Blue = 1,
  Gold = 2,
}

export enum RoomState {
  Idle = 'idle',
  Countdown = 'countdown',
  Playing = 'playing',
  GameOver = 'gameover',
}
