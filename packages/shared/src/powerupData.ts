import { PowerupType } from './types.js';

export interface PowerupDefinition {
  type: PowerupType;
  name: string;
  selfUse: boolean; // true = apply immediately on collection, false = add to inventory
  color: number;
}

export const POWERUP_DEFINITIONS: Record<PowerupType, PowerupDefinition> = {
  [PowerupType.GunUpgrade]:     { type: PowerupType.GunUpgrade,     name: 'Gun+',       selfUse: true,  color: 0xff4444 },
  [PowerupType.ThrustUpgrade]:  { type: PowerupType.ThrustUpgrade,  name: 'Thrust+',    selfUse: true,  color: 0x44ff44 },
  [PowerupType.Retros]:         { type: PowerupType.Retros,         name: 'Retros',      selfUse: true,  color: 0x4444ff },
  [PowerupType.Invulnerability]:{ type: PowerupType.Invulnerability, name: 'Shield',     selfUse: true,  color: 0x44ffff },
  [PowerupType.ClearScreen]:    { type: PowerupType.ClearScreen,    name: 'Zap',         selfUse: true,  color: 0xffff44 },
  [PowerupType.ExtraHealth]:    { type: PowerupType.ExtraHealth,    name: 'Health+',     selfUse: true,  color: 0xff44ff },
  [PowerupType.HeatSeeker]:     { type: PowerupType.HeatSeeker,     name: 'Seekers',     selfUse: false, color: 0xff8800 },
  [PowerupType.Turret]:         { type: PowerupType.Turret,         name: 'Turret',      selfUse: false, color: 0x888888 },
  [PowerupType.Mines]:          { type: PowerupType.Mines,          name: 'Mines',       selfUse: false, color: 0xaa4400 },
  [PowerupType.UFO]:            { type: PowerupType.UFO,            name: 'UFO',         selfUse: false, color: 0x00aaff },
  [PowerupType.Inflater]:       { type: PowerupType.Inflater,       name: 'Inflater',    selfUse: false, color: 0xffaa44 },
  [PowerupType.MineLayer]:      { type: PowerupType.MineLayer,      name: 'MineLayer',   selfUse: false, color: 0x884400 },
  [PowerupType.Gunship]:        { type: PowerupType.Gunship,        name: 'Gunship',     selfUse: false, color: 0x666666 },
  [PowerupType.Scarab]:         { type: PowerupType.Scarab,         name: 'Scarab',      selfUse: false, color: 0x44aa44 },
  [PowerupType.Nuke]:           { type: PowerupType.Nuke,           name: 'Nuke',        selfUse: false, color: 0xff0000 },
  [PowerupType.WallCrawler]:    { type: PowerupType.WallCrawler,    name: 'Crawler',     selfUse: false, color: 0x886688 },
  [PowerupType.SweepBeam]:      { type: PowerupType.SweepBeam,      name: 'Beam',        selfUse: false, color: 0x44ffaa },
  [PowerupType.EMP]:            { type: PowerupType.EMP,            name: 'EMP',         selfUse: false, color: 0x4488ff },
  [PowerupType.GhostPud]:       { type: PowerupType.GhostPud,       name: 'Ghost',      selfUse: false, color: 0xaaaaaa },
  [PowerupType.Artillery]:      { type: PowerupType.Artillery,      name: 'Artillery',   selfUse: false, color: 0xaa8844 },
};

/**
 * Spawn weight ratios for sendable powerups (types 6-19).
 * From g_enemyRatios: [0,0,0,0,0,0, 0,1,0,3,4,2,1,2,1,1,1,1,1,2]
 */
export const SENDABLE_SPAWN_WEIGHTS: Partial<Record<PowerupType, number>> = {
  [PowerupType.HeatSeeker]: 0,
  [PowerupType.Turret]: 1,
  [PowerupType.Mines]: 0,
  [PowerupType.UFO]: 3,
  [PowerupType.Inflater]: 4,
  [PowerupType.MineLayer]: 2,
  [PowerupType.Gunship]: 1,
  [PowerupType.Scarab]: 2,
  [PowerupType.Nuke]: 1,
  [PowerupType.WallCrawler]: 1,
  [PowerupType.SweepBeam]: 1,
  [PowerupType.EMP]: 1,
  [PowerupType.GhostPud]: 1,
  [PowerupType.Artillery]: 2,
};

// Self-use powerup types (0-5)
export const SELF_USE_TYPES = [
  PowerupType.GunUpgrade,
  PowerupType.ThrustUpgrade,
  PowerupType.Retros,
  PowerupType.Invulnerability,
  PowerupType.ClearScreen,
  PowerupType.ExtraHealth,
];

/**
 * Generate a random powerup type, following the original algorithm:
 * - 1/3 chance: self-use (0-5)
 * - 2/3 chance: sendable (6-19), weighted by SENDABLE_SPAWN_WEIGHTS
 */
export function generateRandomPowerupType(gameTimeTicks: number): PowerupType {
  if (Math.random() < 1 / 3) {
    // Self-use
    return SELF_USE_TYPES[Math.floor(Math.random() * SELF_USE_TYPES.length)];
  }

  // Sendable — weighted random
  const entries = Object.entries(SENDABLE_SPAWN_WEIGHTS) as Array<[string, number]>;
  const totalWeight = entries.reduce((sum, [, w]) => sum + w, 0);
  if (totalWeight === 0) return PowerupType.UFO;

  let roll = Math.random() * totalWeight;
  for (const [typeStr, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return Number(typeStr) as PowerupType;
  }
  return PowerupType.UFO;
}
