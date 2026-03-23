import { ShipType, SpecialType } from './types.js';

/**
 * Ship stats ported from g_fighterData in PlayerSprite.java.
 */
export interface ShipDefinition {
  name: string;
  type: ShipType;
  rotateSpeed: number;
  maxThrust: number;
  accel: number; // thrust power per tick
  hitpoints: number;
  gunUpgradeLevel: number; // starting gun level (0-3)
  thrustUpgradeLevel: number; // starting thrust upgrades
  trackingCannons: number; // 0, 1, or 2
  trackingCannonRate: number; // firing rate (ticks between shots)
  specialType: SpecialType;
  subLevel: number;
  description: string;
}

export const SHIP_DEFINITIONS: Record<ShipType, ShipDefinition> = {
  [ShipType.Tank]: {
    name: 'Tank',
    type: ShipType.Tank,
    rotateSpeed: 5.0,
    maxThrust: 6.0,
    accel: 0.10,
    hitpoints: 280,
    gunUpgradeLevel: 2,
    thrustUpgradeLevel: 0,
    trackingCannons: 0,
    trackingCannonRate: 0,
    specialType: SpecialType.None,
    subLevel: 10,
    description: 'Heavily armored with dual guns. Slow but powerful.',
  },
  [ShipType.Wing]: {
    name: 'Wing',
    type: ShipType.Wing,
    rotateSpeed: 7.0,
    maxThrust: 7.0,
    accel: 0.25,
    hitpoints: 240,
    gunUpgradeLevel: 1,
    thrustUpgradeLevel: 1,
    trackingCannons: 0,
    trackingCannonRate: 0,
    specialType: SpecialType.None,
    subLevel: 10,
    description: 'Balanced fighter. Good all-around performance.',
  },
  [ShipType.Squid]: {
    name: 'Squid',
    type: ShipType.Squid,
    rotateSpeed: 10.0,
    maxThrust: 10.0,
    accel: 0.48,
    hitpoints: 200,
    gunUpgradeLevel: 0,
    thrustUpgradeLevel: 3,
    trackingCannons: 0,
    trackingCannonRate: 0,
    specialType: SpecialType.None,
    subLevel: 10,
    description: 'Lightning fast with maxed thrust. Fragile but agile.',
  },
  [ShipType.Rabbit]: {
    name: 'Rabbit',
    type: ShipType.Rabbit,
    rotateSpeed: 12.0,
    maxThrust: 11.0,
    accel: 0.35,
    hitpoints: 180,
    gunUpgradeLevel: 0,
    thrustUpgradeLevel: 2,
    trackingCannons: 1,
    trackingCannonRate: 12,
    specialType: SpecialType.None,
    subLevel: 12,
    description: 'Fastest rotation. Auto-targeting tracking cannon.',
  },
  [ShipType.Turtle]: {
    name: 'Turtle',
    type: ShipType.Turtle,
    rotateSpeed: 4.5,
    maxThrust: 5.2,
    accel: 0.15,
    hitpoints: 250,
    gunUpgradeLevel: 1,
    thrustUpgradeLevel: 1,
    trackingCannons: 0,
    trackingCannonRate: 0,
    specialType: SpecialType.TurtleCannon,
    subLevel: 12,
    description: 'Press D to clear screen (costs 20 HP). Sturdy.',
  },
  [ShipType.Flash]: {
    name: 'Flash',
    type: ShipType.Flash,
    rotateSpeed: 1.0,
    maxThrust: 1.0,
    accel: 0.1,
    hitpoints: 190,
    gunUpgradeLevel: 3,
    thrustUpgradeLevel: 3,
    trackingCannons: 0,
    trackingCannonRate: 0,
    specialType: SpecialType.Shapeshifter,
    subLevel: 14,
    description: 'Press D to shapeshift between Squid and Tank forms.',
  },
  [ShipType.Hunter]: {
    name: 'Hunter',
    type: ShipType.Hunter,
    rotateSpeed: 4.8,
    maxThrust: 7.0,
    accel: 0.3,
    hitpoints: 220,
    gunUpgradeLevel: 0,
    thrustUpgradeLevel: 1,
    trackingCannons: 0,
    trackingCannonRate: 0,
    specialType: SpecialType.HeatSeekerLauncher,
    subLevel: 12,
    description: 'Press D to fire homing Piranha missiles. 3 charges.',
  },
  [ShipType.Flagship]: {
    name: 'Flagship',
    type: ShipType.Flagship,
    rotateSpeed: 2.0,
    maxThrust: 3.9,
    accel: 0.11,
    hitpoints: 300,
    gunUpgradeLevel: 0,
    thrustUpgradeLevel: 2,
    trackingCannons: 2,
    trackingCannonRate: 14,
    specialType: SpecialType.PowerupAttractor,
    subLevel: 14,
    description: 'Massive. Press D to attract powerups / repel enemies.',
  },
};

/**
 * Gun upgrade level data from g_shotData.
 * [damage, size, numShots, maxBullets, fireDelay]
 */
export interface GunLevel {
  damage: number;
  size: number;
  numShots: number;
  maxBullets: number;
  fireDelay: number; // ticks between shots
}

export const GUN_LEVELS: GunLevel[] = [
  { damage: 10, size: 5, numShots: 1, maxBullets: 20, fireDelay: 8 },
  { damage: 14, size: 5, numShots: 1, maxBullets: 14, fireDelay: 6 },
  { damage: 8, size: 5, numShots: 2, maxBullets: 28, fireDelay: 6 },
  { damage: 10, size: 5, numShots: 2, maxBullets: 34, fireDelay: 6 },
];
