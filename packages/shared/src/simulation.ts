import type { Entity, EntityId } from './types.js';
import { EntityType, ShipType, PowerupType, SpecialType } from './types.js';
import type { InputState, SnapshotEntity } from './protocol.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  DECEL,
  REBOUND_COEFF,
  DEFAULT_ORBIT_DISTANCE,
  PORTAL_ARC_SPEED,
  PORTAL_DAMAGE_THRESHOLD,
  BULLET_SPEED,
  BULLET_NOSE_OFFSET,
  BULLET_LIFESPAN,
  POWERUP_COLLISION_SIZE,
  POWERUP_LIFESPAN,
  POWERUP_INVULNERABLE_TICKS,
  MAX_POWERUPS_INVENTORY,
  POWERUP_BULLET_DAMAGE,
  POWERUP_BULLET_SIZE,
} from './constants.js';
import { applyRotation, stepEntityPhysics, applyMovement, handleBounce, degToRad } from './physics.js';
import { SHIP_DEFINITIONS, GUN_LEVELS } from './shipData.js';
import { POWERUP_DEFINITIONS, generateRandomPowerupType } from './powerupData.js';

// ---- World State ----

export interface CrossWorldEvent {
  type: 'spawnEnemies';
  targetPlayerId: string;
  senderPlayerId: string;
  powerupType: PowerupType;
}

export interface PendingSpawn {
  powerupType: PowerupType;
  spawnAtTick: number;
  senderOwnerId: string;
}

export interface PlayerCooldownState {
  fireCooldown: number;
  bulletCount: number;
  specialCooldown: number;
  hunterCharges: number;
  hunterRegenTick: number;
  attractorActive: boolean;
}

export interface WorldState {
  tick: number;
  entities: Map<EntityId, Entity>;
  nextEntityId: EntityId;
  ownerId: string;
  cooldowns: PlayerCooldownState;
  crossWorldEvents: CrossWorldEvent[];
  pendingSpawns: PendingSpawn[];
}

export function createWorldState(ownerId: string): WorldState {
  return {
    tick: 0,
    entities: new Map(),
    nextEntityId: 1,
    ownerId,
    cooldowns: { fireCooldown: 0, bulletCount: 0, specialCooldown: 0, hunterCharges: 3, hunterRegenTick: 0, attractorActive: false },
    crossWorldEvents: [],
    pendingSpawns: [],
  };
}

// ---- Powerup spawning state ----
const SPAWN_START_TICK = 40 * 20; // 40 seconds at 20Hz
const SPAWN_RATE_INITIAL = 500; // 1 in 500 chance per tick
const SPAWN_RATE_FAST = 400;
const SPAWN_RATE_FAST_TICK = 120 * 20; // 120 seconds

// ---- Entity creation ----

export function createShipEntity(
  world: WorldState,
  ownerId: string,
  shipType: ShipType,
  spawnX: number,
  spawnY: number,
): Entity {
  const def = SHIP_DEFINITIONS[shipType];
  const id = world.nextEntityId++;
  const entity: Entity = {
    id,
    type: EntityType.Ship,
    ownerId,
    position: { x: spawnX, y: spawnY },
    velocity: { vx: 0, vy: 0 },
    rotation: { angle: 0, rotateSpeed: def.rotateSpeed },
    physics: {
      maxThrust: def.maxThrust,
      thrustPower: def.accel,
      friction: DECEL,
      bounded: true,
      rebound: REBOUND_COEFF,
    },
    health: { current: def.hitpoints, max: def.hitpoints },
    shipStats: {
      shipType,
      gunLevel: def.gunUpgradeLevel,
      thrustLevel: def.thrustUpgradeLevel,
      hasRetros: false,
      specialType: def.specialType,
      trackingCannons: def.trackingCannons,
    },
    powerupInventory: { items: [] },
  };
  world.entities.set(id, entity);
  world.cooldowns.fireCooldown = 0;
  world.cooldowns.bulletCount = 0;
  return entity;
}

export function createPortalEntity(
  world: WorldState,
  ownerId: string,
  startDegrees: number,
): Entity {
  const centerX = ARENA_WIDTH / 2;
  const centerY = ARENA_HEIGHT / 2;
  const rad = degToRad(startDegrees);
  const id = world.nextEntityId++;
  const entity: Entity = {
    id,
    type: EntityType.Portal,
    ownerId,
    position: {
      x: centerX + Math.cos(rad) * DEFAULT_ORBIT_DISTANCE,
      y: centerY + Math.sin(rad) * DEFAULT_ORBIT_DISTANCE,
    },
    velocity: { vx: 0, vy: 0 },
    rotation: { angle: 0, rotateSpeed: 0 },
    portal: {
      orbitDegrees: startDegrees,
      playerId: ownerId,
      damageAccumulated: 0,
    },
  };
  world.entities.set(id, entity);
  return entity;
}

function createBulletEntity(
  world: WorldState,
  ownerId: string,
  x: number, y: number,
  vx: number, vy: number,
  damage: number, size: number,
): Entity {
  const id = world.nextEntityId++;
  const entity: Entity = {
    id,
    type: EntityType.Bullet,
    ownerId,
    position: { x, y },
    velocity: { vx, vy },
    rotation: { angle: 0, rotateSpeed: 0 },
    physics: {
      maxThrust: 0, thrustPower: 0,
      friction: 1.0,
      bounded: true, rebound: REBOUND_COEFF,
    },
    collision: {
      shape: { type: 'rect', width: size, height: size },
      layer: 'good',
      damage,
    },
    lifespan: { remaining: BULLET_LIFESPAN },
  };
  world.entities.set(id, entity);
  return entity;
}

function createPowerupEntity(
  world: WorldState,
  x: number, y: number,
  powerupType: PowerupType,
): Entity {
  const id = world.nextEntityId++;
  // Random velocity
  const angle = Math.random() * Math.PI * 2;
  const speed = 1 + Math.random() * 2;
  const entity: Entity = {
    id,
    type: EntityType.Powerup,
    ownerId: '', // no owner
    position: { x, y },
    velocity: { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed },
    rotation: { angle: 0, rotateSpeed: 0 },
    physics: {
      maxThrust: 0, thrustPower: 0,
      friction: 1.0, // no friction
      bounded: true, rebound: REBOUND_COEFF,
    },
    lifespan: { remaining: POWERUP_LIFESPAN },
    powerupType,
  };
  world.entities.set(id, entity);
  return entity;
}

function createExplosionEntity(
  world: WorldState,
  ownerId: string,
  x: number, y: number,
): Entity {
  const id = world.nextEntityId++;
  const entity: Entity = {
    id,
    type: EntityType.Explosion,
    ownerId,
    position: { x, y },
    velocity: { vx: 0, vy: 0 },
    rotation: { angle: 0, rotateSpeed: 0 },
    lifespan: { remaining: 20 },
  };
  world.entities.set(id, entity);
  return entity;
}

// ---- Simulation tick ----

export type PlayerInputs = Map<string, InputState>;

export function simulationTick(world: WorldState, inputs: PlayerInputs): void {
  world.tick++;

  // Decrement cooldowns
  if (world.cooldowns.fireCooldown > 0) world.cooldowns.fireCooldown--;
  if (world.cooldowns.specialCooldown > 0) world.cooldowns.specialCooldown--;
  // Hunter charge regen
  if (world.cooldowns.hunterRegenTick > 0 && world.tick >= world.cooldowns.hunterRegenTick) {
    if (world.cooldowns.hunterCharges < 3) {
      world.cooldowns.hunterCharges++;
      world.cooldowns.hunterRegenTick = world.tick + 400; // next regen in 20s
    } else {
      world.cooldowns.hunterRegenTick = 0;
    }
  }

  // Step entities
  for (const entity of world.entities.values()) {
    if (entity.dead) continue;
    switch (entity.type) {
      case EntityType.Ship:
        stepShip(world, entity, inputs.get(entity.ownerId));
        break;
      case EntityType.Portal:
        stepPortal(world, entity);
        break;
      case EntityType.Bullet:
        stepBullet(world, entity);
        break;
      case EntityType.Powerup:
        stepPowerup(entity);
        break;
      case EntityType.Explosion:
        stepLifespan(entity);
        break;
      default:
        // All enemy types use the same step
        if (isEnemyType(entity.type)) {
          stepEnemy(world, entity);
        }
        break;
    }
  }

  // Collisions
  resolveCollisions(world);

  // Process pending enemy spawns
  for (let i = world.pendingSpawns.length - 1; i >= 0; i--) {
    if (world.tick >= world.pendingSpawns[i].spawnAtTick) {
      const spawn = world.pendingSpawns.splice(i, 1)[0];
      // Find a random portal position to spawn enemies at
      const portals = [...world.entities.values()].filter(e => e.type === EntityType.Portal && !e.dead);
      const portal = portals.length > 0 ? portals[Math.floor(Math.random() * portals.length)] : null;
      if (portal) {
        spawnEnemiesFromPortal(world, portal, spawn.powerupType, spawn.senderOwnerId);
      }
    }
  }

  // Powerup spawning
  spawnPowerups(world);

  // Clean up dead entities
  for (const [id, entity] of world.entities) {
    if (entity.dead) {
      world.entities.delete(id);
      if (entity.type === EntityType.Bullet) {
        world.cooldowns.bulletCount = Math.max(0, world.cooldowns.bulletCount - 1);
      }
    }
  }
}

function stepShip(world: WorldState, entity: Entity, input: InputState | undefined): void {
  if (!input) return;

  // EMP countdown
  if (entity.emp && entity.emp.ticksLeft > 0) {
    entity.emp.ticksLeft--;
    if (entity.emp.ticksLeft <= 0) entity.emp = undefined;
  }

  // Scramble controls if EMP active
  let effectiveInput = input;
  if (entity.emp && entity.emp.ticksLeft > 0) {
    const s = entity.emp.scrambleType;
    effectiveInput = {
      left: s === 0 ? input.right : input.left,
      right: s === 0 ? input.left : input.right,
      thrust: s === 1 ? false : input.thrust,
      fire: s === 2 ? false : input.fire,
      secondaryFire: input.secondaryFire,
      special: input.special,
    };
  }

  // Check if flagship attractor is active — disables thrust, fire, and tracking
  const attractorOn = world.cooldowns.attractorActive;

  const rotDir = (effectiveInput.left ? -1 : 0) + (effectiveInput.right ? 1 : 0);
  applyRotation(entity, rotDir as -1 | 0 | 1);
  stepEntityPhysics(entity, attractorOn ? false : effectiveInput.thrust);

  // Primary fire (disabled during attractor)
  if (!attractorOn && effectiveInput.fire && entity.shipStats) {
    tryFireBullets(world, entity);
  }

  // Secondary fire (fire powerup from inventory)
  if (effectiveInput.secondaryFire && entity.powerupInventory && entity.powerupInventory.items.length > 0) {
    tryFirePowerup(world, entity);
  }

  // Shield countdown
  if (entity.shield) {
    entity.shield.ticksLeft--;
    if (entity.shield.ticksLeft <= 0) {
      entity.shield = undefined;
    }
  }

  // Special ability (D key / 'e' key)
  if (input.special && entity.shipStats) {
    tryUseSpecial(world, entity);
  }

  // Tracking cannon auto-fire (disabled during attractor)
  if (!attractorOn && entity.shipStats && entity.shipStats.trackingCannons > 0) {
    stepTrackingCannons(world, entity);
  }

  // Flagship attractor: attract powerups, repulse enemies
  if (attractorOn) {
    applyAttractorForces(world, entity);
  }
}

function tryUseSpecial(world: WorldState, ship: Entity): void {
  const stats = ship.shipStats!;
  if (world.cooldowns.specialCooldown > 0) return;

  switch (stats.specialType) {
    case SpecialType.TurtleCannon: {
      // Destroy all visible enemies; 75% chance costs 20 HP
      if (!ship.health || ship.health.current <= 20) break;
      if (Math.random() < 0.75) ship.health.current -= 20;
      world.cooldowns.specialCooldown = 10; // 10-cycle cooldown (matches original)

      for (const e of world.entities.values()) {
        if (e.dead) continue;
        if (!isEnemyType(e.type)) continue;
        if (e.ownerId !== ship.ownerId) continue; // only enemies targeting this ship
        const dx = e.position.x - ship.position.x;
        const dy = e.position.y - ship.position.y;
        if (dx * dx + dy * dy < 300 * 300) { // visible range
          e.dead = true;
          createExplosionEntity(world, e.ownerId, e.position.x, e.position.y);
        }
      }
      break;
    }

    case SpecialType.Shapeshifter: {
      // Toggle between Squid and Tank forms
      world.cooldowns.specialCooldown = 4; // 4-cycle cooldown (matches original)
      const currentType = stats.shipType;
      const newType = currentType === ShipType.Squid ? ShipType.Tank : ShipType.Squid;
      const newDef = SHIP_DEFINITIONS[newType];

      stats.shipType = newType;
      ship.rotation.rotateSpeed = newDef.rotateSpeed;
      if (ship.physics) {
        ship.physics.maxThrust = newDef.maxThrust;
        ship.physics.thrustPower = newDef.accel;
      }
      break;
    }

    case SpecialType.HeatSeekerLauncher: {
      // Fire 17 homing Piranha missiles, 3 charges max, regen 1 every 20s
      if (world.cooldowns.hunterCharges <= 0) break;
      world.cooldowns.hunterCharges--;
      world.cooldowns.specialCooldown = 4; // 4-cycle cooldown (matches original)

      // Schedule next charge regen
      if (world.cooldowns.hunterRegenTick === 0) {
        world.cooldowns.hunterRegenTick = world.tick + 400; // 20s at 20Hz
      }

      // Fire 17 missiles in a spread toward a point 200px ahead
      const baseAngle = ship.rotation.angle;
      for (let i = 0; i < 17; i++) {
        const spread = (i - 8) * 8; // -64 to +64 degrees
        const angle = baseAngle + spread;
        const rad = degToRad(angle);
        const spawnX = ship.position.x + Math.cos(rad) * 15;
        const spawnY = ship.position.y + Math.sin(rad) * 15;

        // Create as friendly bullets that track nearest enemy
        const speed = 7;
        const bullet = createBulletEntity(
          world, ship.ownerId, spawnX, spawnY,
          Math.cos(rad) * speed, Math.sin(rad) * speed,
          8, 4,
        );
        bullet.lifespan = { remaining: 200 };
        bullet.ai = { type: 'track', targetId: null }; // homing behavior
      }
      break;
    }

    case SpecialType.PowerupAttractor: {
      // Toggle attractor/repulser field
      world.cooldowns.attractorActive = !world.cooldowns.attractorActive;
      ship.attractorActive = world.cooldowns.attractorActive;
      world.cooldowns.specialCooldown = 4; // 4-cycle cooldown (matches original)
      break;
    }
  }
}

/** Flagship attractor: attract powerups toward ship, repulse enemies away */
function applyAttractorForces(world: WorldState, ship: Entity): void {
  const ATTRACTOR_RANGE = 300;
  for (const e of world.entities.values()) {
    if (e.dead) continue;
    if (e.id === ship.id) continue;

    const dx = e.position.x - ship.position.x;
    const dy = e.position.y - ship.position.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1 || dist > ATTRACTOR_RANGE) continue;

    const strength = 0.3 * ((ATTRACTOR_RANGE - dist) / ATTRACTOR_RANGE);
    const nx = dx / dist;
    const ny = dy / dist;

    if (e.type === EntityType.Powerup) {
      // Attract powerups toward ship
      e.velocity.vx -= nx * strength;
      e.velocity.vy -= ny * strength;
    } else if (isEnemyType(e.type)) {
      // Repulse enemies (weaker, 20% strength like original)
      e.velocity.vx += nx * strength * 0.2;
      e.velocity.vy += ny * strength * 0.2;
    }
  }
}

function stepTrackingCannons(world: WorldState, ship: Entity): void {
  if (!ship.shipStats || ship.shipStats.trackingCannons <= 0) return;

  // Find nearest enemy entity
  let nearestEnemy: Entity | null = null;
  let nearestDist = Infinity;
  for (const e of world.entities.values()) {
    if (e.dead) continue;
    if (!isEnemyType(e.type)) continue;
    if (e.ownerId !== ship.ownerId) continue; // only target enemies attacking this ship
    const dx = e.position.x - ship.position.x;
    const dy = e.position.y - ship.position.y;
    const dist = dx * dx + dy * dy;
    if (dist < nearestDist) {
      nearestDist = dist;
      nearestEnemy = e;
    }
  }

  if (!nearestEnemy) return;
  if (nearestDist > 250 * 250) return; // range limit

  // Fire tracking bullet at enemy
  if (!ship.tracking) {
    ship.tracking = { targetId: nearestEnemy.id, firingRate: 14, lastFiredTick: 0 };
  }
  ship.tracking.targetId = nearestEnemy.id;

  const ticksSinceLastFire = world.tick - ship.tracking.lastFiredTick;
  if (ticksSinceLastFire < ship.tracking.firingRate) return;
  ship.tracking.lastFiredTick = world.tick;

  // Aim at enemy with lead calculation
  const dx = nearestEnemy.position.x - ship.position.x;
  const dy = nearestEnemy.position.y - ship.position.y;
  const angle = Math.atan2(dy, dx);
  const bvx = Math.cos(angle) * BULLET_SPEED;
  const bvy = Math.sin(angle) * BULLET_SPEED;
  createBulletEntity(world, ship.ownerId, ship.position.x, ship.position.y, bvx, bvy, 8, 4);
}

function tryFireBullets(world: WorldState, ship: Entity): void {
  const stats = ship.shipStats!;
  const gunLevel = GUN_LEVELS[Math.min(stats.gunLevel, GUN_LEVELS.length - 1)];
  if (world.cooldowns.fireCooldown > 0) return;
  if (world.cooldowns.bulletCount >= gunLevel.maxBullets) return;

  world.cooldowns.fireCooldown = gunLevel.fireDelay;

  const rad = degToRad(ship.rotation.angle);
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const spawnX = ship.position.x + cosA * BULLET_NOSE_OFFSET;
  const spawnY = ship.position.y + sinA * BULLET_NOSE_OFFSET;
  const bvx = ship.velocity.vx + cosA * BULLET_SPEED;
  const bvy = ship.velocity.vy + sinA * BULLET_SPEED;

  if (gunLevel.numShots === 1) {
    createBulletEntity(world, ship.ownerId, spawnX, spawnY, bvx, bvy, gunLevel.damage, gunLevel.size);
    world.cooldowns.bulletCount++;
  } else {
    const perpX = -sinA * 4;
    const perpY = cosA * 4;
    createBulletEntity(world, ship.ownerId, spawnX + perpX, spawnY + perpY, bvx, bvy, gunLevel.damage, gunLevel.size);
    createBulletEntity(world, ship.ownerId, spawnX - perpX, spawnY - perpY, bvx, bvy, gunLevel.damage, gunLevel.size);
    world.cooldowns.bulletCount += 2;
  }
}

function tryFirePowerup(world: WorldState, ship: Entity): void {
  const inv = ship.powerupInventory!;
  if (inv.items.length === 0) return;

  // Cooldown check (reuse fire cooldown)
  if (world.cooldowns.fireCooldown > 0) return;
  world.cooldowns.fireCooldown = 10; // cooldown between powerup shots

  // Pop first powerup from inventory
  const pType = inv.items.shift()!;

  // Fire as an orange projectile toward the nearest enemy portal
  const rad = degToRad(ship.rotation.angle);
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const spawnX = ship.position.x + cosA * BULLET_NOSE_OFFSET;
  const spawnY = ship.position.y + sinA * BULLET_NOSE_OFFSET;
  const speed = 8;
  const bvx = cosA * speed;
  const bvy = sinA * speed;

  const bullet = createBulletEntity(world, ship.ownerId, spawnX, spawnY, bvx, bvy, POWERUP_BULLET_DAMAGE, POWERUP_BULLET_SIZE);
  bullet.powerupType = pType; // Tag the bullet so we know it carries a powerup
  // Powerup bullets don't count against normal bullet limit
}

function stepBullet(world: WorldState, entity: Entity): void {
  // Homing bullets (Hunter missiles) — steer toward nearest enemy
  if (entity.ai?.type === 'track') {
    let nearestEnemy: Entity | undefined;
    let nearestDist = Infinity;
    for (const e of world.entities.values()) {
      if (e.dead) continue;
      if (!isEnemyType(e.type)) continue;
      const dx = e.position.x - entity.position.x;
      const dy = e.position.y - entity.position.y;
      const dist = dx * dx + dy * dy;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestEnemy = e;
      }
    }
    if (nearestEnemy) {
      const dx = nearestEnemy.position.x - entity.position.x;
      const dy = nearestEnemy.position.y - entity.position.y;
      const targetAngle = Math.atan2(dy, dx);
      const currentAngle = Math.atan2(entity.velocity.vy, entity.velocity.vx);
      let diff = targetAngle - currentAngle;
      if (diff > Math.PI) diff -= 2 * Math.PI;
      if (diff < -Math.PI) diff += 2 * Math.PI;
      const maxTurn = 0.15; // radians per tick
      const turn = Math.abs(diff) < maxTurn ? diff : (diff > 0 ? maxTurn : -maxTurn);
      const newAngle = currentAngle + turn;
      const speed = Math.sqrt(entity.velocity.vx ** 2 + entity.velocity.vy ** 2);
      entity.velocity.vx = Math.cos(newAngle) * speed;
      entity.velocity.vy = Math.sin(newAngle) * speed;
    }
  }

  applyMovement(entity);
  handleBounce(entity);
  if (entity.lifespan) {
    entity.lifespan.remaining--;
    if (entity.lifespan.remaining <= 0) entity.dead = true;
  }
}

function stepPowerup(entity: Entity): void {
  applyMovement(entity);
  handleBounce(entity);
  if (entity.lifespan) {
    entity.lifespan.remaining--;
    if (entity.lifespan.remaining <= 0) entity.dead = true;
  }
}

function stepPortal(world: WorldState, entity: Entity): void {
  if (!entity.portal) return;
  entity.portal.orbitDegrees += PORTAL_ARC_SPEED;
  if (entity.portal.orbitDegrees >= 360) entity.portal.orbitDegrees -= 360;
  const centerX = ARENA_WIDTH / 2;
  const centerY = ARENA_HEIGHT / 2;
  const rad = degToRad(entity.portal.orbitDegrees);
  entity.position.x = centerX + Math.cos(rad) * DEFAULT_ORBIT_DISTANCE;
  entity.position.y = centerY + Math.sin(rad) * DEFAULT_ORBIT_DISTANCE;

  // Random enemy spawning after 40s (Inflater 40%, UFO 40%, Gunship 20%)
  if (world.tick > SPAWN_START_TICK) {
    const rate = world.tick > SPAWN_RATE_FAST_TICK ? SPAWN_RATE_FAST : SPAWN_RATE_INITIAL;
    if (Math.random() < 1 / rate) {
      const roll = Math.random();
      const enemyType = roll < 0.4 ? EntityType.Inflater
        : roll < 0.8 ? EntityType.UFO
        : EntityType.Gunship;
      createEnemyEntity(world, enemyType, '', world.ownerId,
        entity.position.x, entity.position.y, Math.random() * 360);
    }
  }
}

function stepLifespan(entity: Entity): void {
  if (entity.lifespan) {
    entity.lifespan.remaining--;
    if (entity.lifespan.remaining <= 0) entity.dead = true;
  }
}

// ---- Powerup spawning ----

function spawnPowerups(world: WorldState): void {
  if (world.tick < SPAWN_START_TICK) return;

  const rate = world.tick > SPAWN_RATE_FAST_TICK ? SPAWN_RATE_FAST : SPAWN_RATE_INITIAL;
  if (Math.random() > 1 / rate) return;

  // Find a random portal to spawn at
  const portals: Entity[] = [];
  for (const e of world.entities.values()) {
    if (e.type === EntityType.Portal && !e.dead) portals.push(e);
  }
  if (portals.length === 0) return;

  const portal = portals[Math.floor(Math.random() * portals.length)];
  const pType = generateRandomPowerupType(world.tick);

  createPowerupEntity(world, portal.position.x, portal.position.y, pType);
}

// ---- Enemy types ----

const ENEMY_TYPES = new Set([
  EntityType.HeatSeeker, EntityType.Turret, EntityType.Mine, EntityType.UFO,
  EntityType.Inflater, EntityType.MineLayer, EntityType.Gunship, EntityType.Scarab,
  EntityType.Nuke, EntityType.WallCrawler, EntityType.SweepBeam, EntityType.EMP,
  EntityType.GhostPud, EntityType.Artillery,
]);

function isEnemyType(type: EntityType): boolean {
  return ENEMY_TYPES.has(type);
}

/** Map from PowerupType to EntityType and spawn count */
const POWERUP_TO_ENEMY: Partial<Record<PowerupType, { type: EntityType; count: number }>> = {
  [PowerupType.HeatSeeker]:  { type: EntityType.HeatSeeker, count: 12 },
  [PowerupType.Turret]:      { type: EntityType.Turret,     count: 1 },
  [PowerupType.Mines]:       { type: EntityType.Mine,       count: 12 },
  [PowerupType.UFO]:         { type: EntityType.UFO,        count: 3 },
  [PowerupType.Inflater]:    { type: EntityType.Inflater,   count: 4 },
  [PowerupType.MineLayer]:   { type: EntityType.MineLayer,  count: 2 },
  [PowerupType.Gunship]:     { type: EntityType.Gunship,    count: 1 },
  [PowerupType.Scarab]:      { type: EntityType.Scarab,     count: 2 },
  [PowerupType.Nuke]:        { type: EntityType.Nuke,       count: 1 },
  [PowerupType.WallCrawler]: { type: EntityType.WallCrawler,count: 1 },
  [PowerupType.SweepBeam]:   { type: EntityType.SweepBeam,  count: 1 },
  [PowerupType.EMP]:         { type: EntityType.EMP,        count: 1 },
  [PowerupType.GhostPud]:    { type: EntityType.GhostPud,   count: 1 },
  [PowerupType.Artillery]:   { type: EntityType.Artillery,  count: 2 },
};

/** Enemy stats by type */
interface EnemyDef {
  maxThrust: number;
  accel: number;
  rotateSpeed: number;
  hp: number;
  damage: number;
  lifespan: number;
  behavior: 'track' | 'orbit' | 'wander' | 'static' | 'straight';
  size: number; // collision radius
  color: number;
}

const ENEMY_DEFS: Partial<Record<EntityType, EnemyDef>> = {
  [EntityType.HeatSeeker]: { maxThrust: 7, accel: 0.5, rotateSpeed: 16, hp: 5,  damage: 10, lifespan: 300, behavior: 'track',    size: 5,  color: 0xff8800 },
  [EntityType.UFO]:        { maxThrust: 5, accel: 0.3, rotateSpeed: 8,  hp: 30, damage: 15, lifespan: 600, behavior: 'track',    size: 10, color: 0x00aaff },
  [EntityType.Mine]:       { maxThrust: 0, accel: 0,   rotateSpeed: 0,  hp: 10, damage: 25, lifespan: 800, behavior: 'static',   size: 6,  color: 0xaa4400 },
  [EntityType.Inflater]:   { maxThrust: 4, accel: 0.2, rotateSpeed: 6,  hp: 40, damage: 10, lifespan: 500, behavior: 'track',    size: 12, color: 0xffaa44 },
  [EntityType.MineLayer]:  { maxThrust: 3, accel: 0.15,rotateSpeed: 4,  hp: 30, damage: 10, lifespan: 600, behavior: 'wander',   size: 10, color: 0x884400 },
  [EntityType.Gunship]:    { maxThrust: 5, accel: 0.25,rotateSpeed: 6,  hp: 60, damage: 12, lifespan: 800, behavior: 'track',    size: 14, color: 0x666666 },
  [EntityType.Scarab]:     { maxThrust: 4, accel: 0.2, rotateSpeed: 5,  hp: 35, damage: 10, lifespan: 600, behavior: 'orbit',    size: 10, color: 0x44aa44 },
  [EntityType.Turret]:     { maxThrust: 0, accel: 0,   rotateSpeed: 3,  hp: 50, damage: 8,  lifespan: 900, behavior: 'orbit',    size: 10, color: 0x888888 },
  [EntityType.Nuke]:       { maxThrust: 3, accel: 0.1, rotateSpeed: 2,  hp: 20, damage: 80, lifespan: 200, behavior: 'straight', size: 12, color: 0xff0000 },
  [EntityType.WallCrawler]:{ maxThrust: 3, accel: 0.2, rotateSpeed: 4,  hp: 30, damage: 15, lifespan: 600, behavior: 'wander',   size: 10, color: 0x886688 },
  [EntityType.SweepBeam]:  { maxThrust: 0, accel: 0,   rotateSpeed: 2,  hp: 40, damage: 5,  lifespan: 400, behavior: 'orbit',    size: 30, color: 0x44ffaa },
  [EntityType.EMP]:        { maxThrust: 5, accel: 0.3, rotateSpeed: 8,  hp: 15, damage: 5,  lifespan: 300, behavior: 'track',    size: 10, color: 0x4488ff },
  [EntityType.GhostPud]:   { maxThrust: 3, accel: 0.15,rotateSpeed: 5,  hp: 25, damage: 10, lifespan: 500, behavior: 'track',    size: 8,  color: 0xaaaaaa },
  [EntityType.Artillery]:  { maxThrust: 3, accel: 0.1, rotateSpeed: 3,  hp: 40, damage: 20, lifespan: 600, behavior: 'wander',   size: 12, color: 0xaa8844 },
};

function createEnemyEntity(
  world: WorldState,
  enemyType: EntityType,
  ownerId: string, // the player who SENT the powerup (enemies attack the portal owner)
  targetOwnerId: string, // the player whose portal was hit
  x: number, y: number,
  angleOffset: number,
): Entity {
  const def = ENEMY_DEFS[enemyType];
  if (!def) return createExplosionEntity(world, ownerId, x, y); // fallback

  const id = world.nextEntityId++;
  const angle = angleOffset;
  const rad = degToRad(angle);

  // Initial velocity: move outward from spawn point
  const speed = def.behavior === 'static' ? 0 : 2;

  const entity: Entity = {
    id,
    type: enemyType,
    ownerId: targetOwnerId, // attacks this player
    position: { x, y },
    velocity: { vx: Math.cos(rad) * speed, vy: Math.sin(rad) * speed },
    rotation: { angle, rotateSpeed: def.rotateSpeed },
    physics: {
      maxThrust: def.maxThrust,
      thrustPower: def.accel,
      friction: DECEL,
      bounded: true,
      rebound: REBOUND_COEFF,
    },
    health: { current: def.hp, max: def.hp },
    collision: {
      shape: { type: 'rect', width: def.size * 2, height: def.size * 2 },
      layer: 'bad',
      damage: def.damage,
    },
    lifespan: { remaining: def.lifespan },
    ai: { type: def.behavior as 'track' | 'orbit' | 'wander', targetId: null },
  };
  world.entities.set(id, entity);
  return entity;
}

const PORTAL_SPAWN_DELAY = 30; // 30 ticks (~1.5s) delay before enemies spawn

/** Queue enemies to spawn in this world after a delay */
function queueEnemiesFromPortal(
  world: WorldState,
  powerupType: PowerupType,
  senderOwnerId: string,
): void {
  world.pendingSpawns.push({
    powerupType,
    spawnAtTick: world.tick + PORTAL_SPAWN_DELAY,
    senderOwnerId,
  });
}

/** Actually spawn enemies from a portal (called when queue entry is ready) */
function spawnEnemiesFromPortal(
  world: WorldState,
  portal: Entity,
  powerupType: PowerupType,
  senderOwnerId: string,
): void {
  const spawn = POWERUP_TO_ENEMY[powerupType];
  if (!spawn) return;

  const portalOwnerId = portal.portal?.playerId ?? portal.ownerId;
  // Ghost Pud count scales with game time (proxy for upgrade level)
  let count = spawn.count;
  if (spawn.type === EntityType.GhostPud) {
    count = Math.min(1 + Math.floor(world.tick / (60 * 20)), 5); // +1 per minute, max 5
  }

  for (let i = 0; i < count; i++) {
    const angleOffset = (i * 360) / count + Math.random() * 30;
    createEnemyEntity(
      world, spawn.type,
      senderOwnerId, portalOwnerId,
      portal.position.x, portal.position.y,
      angleOffset,
    );
  }
}

/** Step an enemy entity each tick */
function stepEnemy(world: WorldState, entity: Entity): void {
  // Lifespan
  if (entity.lifespan) {
    entity.lifespan.remaining--;
    if (entity.lifespan.remaining <= 0) {
      // Nuke: AOE explosion on death/expiry
      if (entity.type === EntityType.Nuke) {
        nukeExplode(world, entity);
      }
      entity.dead = true;
      return;
    }
  }

  // Decrement fire cooldown
  if ((entity.fireCooldown ?? 0) > 0) entity.fireCooldown = (entity.fireCooldown ?? 0) - 1;

  // Type-specific behaviors
  switch (entity.type) {
    case EntityType.HeatSeeker:
      trackTarget(world, entity);
      break;

    case EntityType.UFO:
      trackTarget(world, entity);
      enemyFireAtTarget(world, entity, 25, 8); // fire every 25 ticks, bullet speed 8
      break;

    case EntityType.Gunship:
      trackTarget(world, entity);
      enemyFireAtTarget(world, entity, 12, 10); // fast fire rate
      break;

    case EntityType.Turret:
      orbitPortal(world, entity);
      enemyFireAtTarget(world, entity, 18, 9);
      break;

    case EntityType.Scarab:
      stepScarab(world, entity);
      break;

    case EntityType.Artillery:
      wander(entity);
      enemyFireAtTarget(world, entity, 40, 6); // slow but high damage
      break;

    case EntityType.Mine:
      // Static — no movement, just sits there
      break;

    case EntityType.Nuke:
      // Fly straight toward target, don't turn much
      trackTarget(world, entity);
      break;

    case EntityType.Inflater:
      trackTarget(world, entity);
      // Size grows based on damage taken (starts at 12, max 40)
      if (entity.health && entity.collision) {
        const def = ENEMY_DEFS[EntityType.Inflater]!;
        const damageTaken = def.hp - entity.health.current;
        const growthFactor = 1 + (damageTaken / def.hp) * 3; // up to 4x size
        const baseSize = def.size;
        const newSize = Math.min(baseSize * growthFactor, 40);
        entity.collision.shape = { type: 'rect', width: newSize * 2, height: newSize * 2 };
        entity.collision.damage = def.damage + damageTaken; // more damage when bigger
      }
      break;

    case EntityType.MineLayer:
      wander(entity);
      // Drop a mine every 60 ticks
      if (world.tick % 60 === 0) {
        createEnemyEntity(
          world, EntityType.Mine,
          entity.ownerId, entity.ownerId,
          entity.position.x, entity.position.y, 0,
        );
      }
      break;

    case EntityType.WallCrawler:
      wallCrawl(entity);
      break;

    case EntityType.SweepBeam:
      orbitPortal(world, entity);
      // Damage ships in a line from portal to this entity
      sweepBeamDamage(world, entity);
      break;

    case EntityType.EMP:
      trackTarget(world, entity);
      // EMP effect applied on collision in resolveCollisions
      break;

    case EntityType.GhostPud:
      trackTarget(world, entity);
      // Phase through walls (no bounce)
      if (entity.physics) entity.physics.bounded = false;
      // Wrap position
      if (entity.position.x < 0) entity.position.x += ARENA_WIDTH;
      if (entity.position.x > ARENA_WIDTH) entity.position.x -= ARENA_WIDTH;
      if (entity.position.y < 0) entity.position.y += ARENA_HEIGHT;
      if (entity.position.y > ARENA_HEIGHT) entity.position.y -= ARENA_HEIGHT;
      break;

    default:
      // Fallback: use AI behavior field
      if (entity.ai) {
        switch (entity.ai.type) {
          case 'track': trackTarget(world, entity); break;
          case 'orbit': orbitPortal(world, entity); break;
          case 'wander': wander(entity); break;
        }
      }
      break;
  }

  // Apply physics
  if (entity.physics && entity.physics.maxThrust > 0) {
    stepEntityPhysics(entity, true);
  } else {
    applyMovement(entity);
    if (entity.type !== EntityType.GhostPud) handleBounce(entity);
  }
}

/** Enemy fires a bullet at its target player */
function enemyFireAtTarget(world: WorldState, entity: Entity, fireRate: number, bulletSpeed: number): void {
  if ((entity.fireCooldown ?? 0) > 0) return;

  // Find target ship
  let targetShip: Entity | undefined;
  for (const e of world.entities.values()) {
    if (e.type === EntityType.Ship && e.ownerId === entity.ownerId && !e.dead) {
      targetShip = e;
      break;
    }
  }
  if (!targetShip) return;

  const dx = targetShip.position.x - entity.position.x;
  const dy = targetShip.position.y - entity.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist > 350) return; // range limit

  const angle = Math.atan2(dy, dx);
  const bvx = Math.cos(angle) * bulletSpeed;
  const bvy = Math.sin(angle) * bulletSpeed;

  const damage = ENEMY_DEFS[entity.type]?.damage ?? 8;
  const bullet = createBulletEntity(world, entity.ownerId, entity.position.x, entity.position.y, bvx, bvy, Math.max(damage / 2, 4), 3);
  bullet.lifespan = { remaining: 60 }; // shorter lifespan for enemy bullets
  entity.fireCooldown = fireRate;
}

/** Nuke: massive AOE explosion */
function nukeExplode(world: WorldState, entity: Entity): void {
  const NUKE_RADIUS = 150;
  // Damage all ships in radius
  for (const e of world.entities.values()) {
    if (e.dead) continue;
    if (e.type === EntityType.Ship) {
      const dx = e.position.x - entity.position.x;
      const dy = e.position.y - entity.position.y;
      if (dx * dx + dy * dy < NUKE_RADIUS * NUKE_RADIUS) {
        if (e.shield && e.shield.ticksLeft > 0) continue;
        if (e.health) {
          e.health.current -= 80;
          if (e.health.current <= 0) {
            e.health.current = 0;
            e.dead = true;
            createExplosionEntity(world, e.ownerId, e.position.x, e.position.y);
          }
        }
      }
    }
    // Also destroy nearby enemies
    if (isEnemyType(e.type) && e.id !== entity.id) {
      const dx = e.position.x - entity.position.x;
      const dy = e.position.y - entity.position.y;
      if (dx * dx + dy * dy < NUKE_RADIUS * NUKE_RADIUS) {
        e.dead = true;
      }
    }
  }
  // Create multiple explosion visuals
  for (let i = 0; i < 5; i++) {
    const ox = (Math.random() - 0.5) * NUKE_RADIUS;
    const oy = (Math.random() - 0.5) * NUKE_RADIUS;
    createExplosionEntity(world, entity.ownerId, entity.position.x + ox, entity.position.y + oy);
  }
}

/** WallCrawler: follow arena walls */
function wallCrawl(entity: Entity): void {
  const margin = 30;
  const x = entity.position.x;
  const y = entity.position.y;

  // Determine which wall we're near and set angle to follow it
  if (x < margin) {
    entity.rotation.angle = 270; // go down along left wall
  } else if (x > ARENA_WIDTH - margin) {
    entity.rotation.angle = 90; // go up along right wall
  } else if (y < margin) {
    entity.rotation.angle = 0; // go right along top wall
  } else if (y > ARENA_HEIGHT - margin) {
    entity.rotation.angle = 180; // go left along bottom wall
  } else {
    // Not near a wall, move toward nearest wall
    const distLeft = x;
    const distRight = ARENA_WIDTH - x;
    const distTop = y;
    const distBottom = ARENA_HEIGHT - y;
    const minDist = Math.min(distLeft, distRight, distTop, distBottom);
    if (minDist === distLeft) entity.rotation.angle = 180;
    else if (minDist === distRight) entity.rotation.angle = 0;
    else if (minDist === distTop) entity.rotation.angle = 270;
    else entity.rotation.angle = 90;
  }
}

/** SweepBeam: damage ships along the line from portal to entity */
function sweepBeamDamage(world: WorldState, entity: Entity): void {
  // Only damage every 10 ticks
  if (world.tick % 10 !== 0) return;

  // Find portal
  let portal: Entity | undefined;
  for (const e of world.entities.values()) {
    if (e.type === EntityType.Portal && e.ownerId === entity.ownerId && !e.dead) {
      portal = e;
      break;
    }
  }
  if (!portal) return;

  // Check ships near the line from portal to sweep entity
  const px = portal.position.x;
  const py = portal.position.y;
  const ex = entity.position.x;
  const ey = entity.position.y;
  const lineDx = ex - px;
  const lineDy = ey - py;
  const lineLen = Math.sqrt(lineDx * lineDx + lineDy * lineDy);
  if (lineLen < 1) return;

  for (const e of world.entities.values()) {
    if (e.dead || e.type !== EntityType.Ship) continue;
    if (e.shield && e.shield.ticksLeft > 0) continue;

    // Point-to-line distance
    const sx = e.position.x - px;
    const sy = e.position.y - py;
    const t = Math.max(0, Math.min(1, (sx * lineDx + sy * lineDy) / (lineLen * lineLen)));
    const closestX = px + t * lineDx;
    const closestY = py + t * lineDy;
    const dist = Math.sqrt((e.position.x - closestX) ** 2 + (e.position.y - closestY) ** 2);

    if (dist < 20) { // beam width
      if (e.health) {
        e.health.current -= 3;
        if (e.health.current <= 0) {
          e.health.current = 0;
          e.dead = true;
          createExplosionEntity(world, e.ownerId, e.position.x, e.position.y);
        }
      }
    }
  }
}

/** Scarab: hunts powerups, picks them up, carries to portal, delivers as attack */
function stepScarab(world: WorldState, entity: Entity): void {
  if (entity.scarabCarrying !== undefined) {
    // Carrying a powerup — navigate back to portal
    let targetPortal: Entity | undefined;
    for (const e of world.entities.values()) {
      if (e.type === EntityType.Portal && e.ownerId === entity.ownerId && !e.dead) {
        targetPortal = e;
        break;
      }
    }
    if (targetPortal) {
      const dx = targetPortal.position.x - entity.position.x;
      const dy = targetPortal.position.y - entity.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const targetAngle = Math.atan2(dy, dx) * (180 / Math.PI);
      entity.rotation.angle = targetAngle;

      // If close enough to portal, deliver the powerup
      if (dist < 30) {
        queueEnemiesFromPortal(world, entity.scarabCarrying, entity.ownerId);
        entity.scarabCarrying = undefined;
      }
    } else {
      wander(entity);
    }
  } else {
    // Not carrying — hunt nearest powerup on the field
    let nearestPowerup: Entity | undefined;
    let nearestDist = Infinity;
    for (const e of world.entities.values()) {
      if (e.dead || e.type !== EntityType.Powerup) continue;
      if (e.powerupType === undefined) continue;
      const dx = e.position.x - entity.position.x;
      const dy = e.position.y - entity.position.y;
      const dist = dx * dx + dy * dy;
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestPowerup = e;
      }
    }

    if (nearestPowerup) {
      // Navigate toward it
      const dx = nearestPowerup.position.x - entity.position.x;
      const dy = nearestPowerup.position.y - entity.position.y;
      entity.rotation.angle = Math.atan2(dy, dx) * (180 / Math.PI);

      // Pick it up if close enough
      if (nearestDist < 15 * 15) {
        entity.scarabCarrying = nearestPowerup.powerupType;
        nearestPowerup.dead = true;
      }
    } else {
      wander(entity);
    }
  }
}

/** Track toward the target player's ship */
function trackTarget(world: WorldState, entity: Entity): void {
  // Find target ship
  let targetShip: Entity | undefined;
  for (const e of world.entities.values()) {
    if (e.type === EntityType.Ship && e.ownerId === entity.ownerId && !e.dead) {
      targetShip = e;
      break;
    }
  }
  if (!targetShip) return;

  // Rotate toward target
  const dx = targetShip.position.x - entity.position.x;
  const dy = targetShip.position.y - entity.position.y;
  const targetAngle = Math.atan2(dy, dx) * (180 / Math.PI);
  let diff = targetAngle - entity.rotation.angle;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;

  const maxTurn = entity.rotation.rotateSpeed;
  if (Math.abs(diff) < maxTurn) {
    entity.rotation.angle = targetAngle;
  } else {
    entity.rotation.angle += diff > 0 ? maxTurn : -maxTurn;
  }
  entity.rotation.angle = ((entity.rotation.angle % 360) + 360) % 360;
}

/** Orbit around the target's portal */
function orbitPortal(world: WorldState, entity: Entity): void {
  // Find the portal belonging to the target
  let targetPortal: Entity | undefined;
  for (const e of world.entities.values()) {
    if (e.type === EntityType.Portal && e.ownerId === entity.ownerId && !e.dead) {
      targetPortal = e;
      break;
    }
  }
  if (!targetPortal) {
    // No portal — wander instead
    wander(entity);
    return;
  }

  // Orbit: rotate around portal position
  const dx = entity.position.x - targetPortal.position.x;
  const dy = entity.position.y - targetPortal.position.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const orbitDist = 60;

  if (dist < orbitDist - 10) {
    // Too close, move outward
    entity.rotation.angle = Math.atan2(dy, dx) * (180 / Math.PI);
  } else if (dist > orbitDist + 10) {
    // Too far, move inward
    entity.rotation.angle = Math.atan2(-dy, -dx) * (180 / Math.PI);
  } else {
    // Orbit: perpendicular to radius
    entity.rotation.angle = Math.atan2(dx, -dy) * (180 / Math.PI);
  }
  entity.rotation.angle = ((entity.rotation.angle % 360) + 360) % 360;
}

/** Wander randomly */
function wander(entity: Entity): void {
  // Slight random rotation
  entity.rotation.angle += (Math.random() - 0.5) * entity.rotation.rotateSpeed * 0.5;
  entity.rotation.angle = ((entity.rotation.angle % 360) + 360) % 360;
}

// ---- Collision detection ----

function resolveCollisions(world: WorldState): void {
  const ships: Entity[] = [];
  const bullets: Entity[] = [];
  const powerups: Entity[] = [];
  const portals: Entity[] = [];
  const enemies: Entity[] = [];

  for (const entity of world.entities.values()) {
    if (entity.dead) continue;
    if (entity.type === EntityType.Ship) ships.push(entity);
    else if (entity.type === EntityType.Bullet) bullets.push(entity);
    else if (entity.type === EntityType.Powerup) powerups.push(entity);
    else if (entity.type === EntityType.Portal) portals.push(entity);
    else if (isEnemyType(entity.type)) enemies.push(entity);
  }

  // Bullet vs Ship
  for (const bullet of bullets) {
    if (bullet.dead) continue;
    for (const ship of ships) {
      if (ship.dead) continue;
      if (bullet.ownerId === ship.ownerId) continue;
      const dx = bullet.position.x - ship.position.x;
      const dy = bullet.position.y - ship.position.y;
      if (dx * dx + dy * dy < 15 * 15) {
        if (ship.shield && ship.shield.ticksLeft > 0) {
          bullet.dead = true;
          break;
        }
        const damage = bullet.collision?.damage ?? 10;
        if (ship.health) {
          ship.health.current -= damage;
          if (ship.health.current <= 0) {
            ship.health.current = 0;
            ship.dead = true;
            createExplosionEntity(world, ship.ownerId, ship.position.x, ship.position.y);
          }
        }
        bullet.dead = true;
        break;
      }
    }
  }

  // Bullet vs Portal
  for (const bullet of bullets) {
    if (bullet.dead) continue;
    for (const portal of portals) {
      if (portal.dead) continue;
      if (portal.ownerId === bullet.ownerId) continue; // Can't hit own portal
      const dx = bullet.position.x - portal.position.x;
      const dy = bullet.position.y - portal.position.y;
      if (dx * dx + dy * dy < 30 * 30) {
        if (bullet.powerupType !== undefined) {
          // Powerup bullet: emit cross-world event to spawn enemies in target's world
          world.crossWorldEvents.push({
            type: 'spawnEnemies',
            targetPlayerId: portal.portal!.playerId,
            senderPlayerId: bullet.ownerId,
            powerupType: bullet.powerupType!,
          });
        } else {
          // Regular bullet: accumulate damage on portal
          if (portal.portal) {
            const dmg = bullet.collision?.damage ?? 10;
            portal.portal.damageAccumulated += dmg;
            if (portal.portal.damageAccumulated >= PORTAL_DAMAGE_THRESHOLD) {
              portal.portal.damageAccumulated -= PORTAL_DAMAGE_THRESHOLD;
              // Drop a random powerup from this portal
              const pType = generateRandomPowerupType(world.tick);
              createPowerupEntity(world, portal.position.x, portal.position.y, pType);
            }
          }
        }
        bullet.dead = true;
        break;
      }
    }
  }

  // Bullet vs Enemy (player bullets destroy enemies)
  for (const bullet of bullets) {
    if (bullet.dead) continue;
    if (bullet.powerupType !== undefined) continue; // Skip powerup bullets
    for (const enemy of enemies) {
      if (enemy.dead) continue;
      const def = ENEMY_DEFS[enemy.type];
      const hitRadius = def?.size ?? 10;
      const dx = bullet.position.x - enemy.position.x;
      const dy = bullet.position.y - enemy.position.y;
      if (dx * dx + dy * dy < hitRadius * hitRadius) {
        const damage = bullet.collision?.damage ?? 10;
        if (enemy.health) {
          enemy.health.current -= damage;
          if (enemy.health.current <= 0) {
            enemy.dead = true;
            createExplosionEntity(world, enemy.ownerId, enemy.position.x, enemy.position.y);
            // Scarab drops carried powerup + bonus random powerup on death
            if (enemy.type === EntityType.Scarab && enemy.scarabCarrying !== undefined) {
              createPowerupEntity(world, enemy.position.x, enemy.position.y, enemy.scarabCarrying);
              createPowerupEntity(world, enemy.position.x + 10, enemy.position.y, generateRandomPowerupType(world.tick));
            }
          }
        }
        bullet.dead = true;
        break;
      }
    }
  }

  // Enemy vs Ship (enemies damage ships on contact)
  for (const enemy of enemies) {
    if (enemy.dead) continue;
    for (const ship of ships) {
      if (ship.dead) continue;
      if (enemy.ownerId !== ship.ownerId) continue; // Enemies only attack their target
      const def = ENEMY_DEFS[enemy.type];
      const hitRadius = (def?.size ?? 10) + 10;
      const dx = enemy.position.x - ship.position.x;
      const dy = enemy.position.y - ship.position.y;
      if (dx * dx + dy * dy < hitRadius * hitRadius) {
        if (ship.shield && ship.shield.ticksLeft > 0) {
          enemy.dead = true;
          createExplosionEntity(world, enemy.ownerId, enemy.position.x, enemy.position.y);
          continue;
        }

        // EMP: scramble controls instead of damage
        if (enemy.type === EntityType.EMP) {
          ship.emp = { ticksLeft: 150, scrambleType: Math.floor(Math.random() * 3) };
          enemy.dead = true;
          createExplosionEntity(world, enemy.ownerId, enemy.position.x, enemy.position.y);
          continue;
        }

        // Nuke: AOE explosion on contact
        if (enemy.type === EntityType.Nuke) {
          nukeExplode(world, enemy);
          enemy.dead = true;
          continue;
        }

        const damage = def?.damage ?? 10;
        if (ship.health) {
          ship.health.current -= damage;
          if (ship.health.current <= 0) {
            ship.health.current = 0;
            ship.dead = true;
            createExplosionEntity(world, ship.ownerId, ship.position.x, ship.position.y);
          }
        }
        enemy.dead = true;
        createExplosionEntity(world, enemy.ownerId, enemy.position.x, enemy.position.y);
      }
    }
  }

  // Ship vs Powerup (collection)
  for (const ship of ships) {
    if (ship.dead) continue;
    for (const powerup of powerups) {
      if (powerup.dead) continue;
      if (powerup.powerupType === undefined) continue;
      if (powerup.lifespan && powerup.lifespan.remaining > POWERUP_LIFESPAN - POWERUP_INVULNERABLE_TICKS) continue;
      const dx = powerup.position.x - ship.position.x;
      const dy = powerup.position.y - ship.position.y;
      if (dx * dx + dy * dy < (POWERUP_COLLISION_SIZE / 2 + 15) ** 2) {
        collectPowerup(world, ship, powerup.powerupType);
        powerup.dead = true;
      }
    }
  }
}

function collectPowerup(world: WorldState, ship: Entity, pType: PowerupType): void {
  const def = POWERUP_DEFINITIONS[pType];

  if (def.selfUse) {
    // Apply immediately
    applySelfUsePowerup(ship, pType, world);
  } else {
    // Hunter: picking up HeatSeeker powerup refills missile charges to 3
    if (pType === PowerupType.HeatSeeker && ship.shipStats?.specialType === SpecialType.HeatSeekerLauncher) {
      world.cooldowns.hunterCharges = 3;
      return; // consumed, not added to inventory
    }

    // Add to inventory (max 5)
    if (!ship.powerupInventory) ship.powerupInventory = { items: [] };
    if (ship.powerupInventory.items.length < MAX_POWERUPS_INVENTORY) {
      ship.powerupInventory.items.push(pType);
    }
  }
}

function applySelfUsePowerup(ship: Entity, pType: PowerupType, world?: WorldState): void {
  switch (pType) {
    case PowerupType.GunUpgrade:
      if (ship.shipStats && ship.shipStats.gunLevel < GUN_LEVELS.length - 1) {
        ship.shipStats.gunLevel++;
      }
      break;
    case PowerupType.ThrustUpgrade:
      if (ship.physics) {
        ship.physics.thrustPower += 0.1;
        ship.physics.maxThrust += 0.5;
      }
      if (ship.shipStats) ship.shipStats.thrustLevel++;
      break;
    case PowerupType.Retros:
      if (ship.shipStats) ship.shipStats.hasRetros = true;
      break;
    case PowerupType.Invulnerability:
      ship.shield = { ticksLeft: 450 }; // ~22 seconds at 20Hz
      break;
    case PowerupType.ClearScreen:
      // Destroy all enemies targeting this ship in visible range
      if (world) {
        for (const e of Array.from(world.entities.values())) {
          if (e.dead) continue;
          if (!isEnemyType(e.type)) continue;
          if (e.ownerId !== ship.ownerId) continue;
          const dx = e.position.x - ship.position.x;
          const dy = e.position.y - ship.position.y;
          if (dx * dx + dy * dy < 400 * 400) {
            e.dead = true;
            createExplosionEntity(world, e.ownerId, e.position.x, e.position.y);
          }
        }
      }
      break;
    case PowerupType.ExtraHealth:
      if (ship.health) {
        ship.health.current = Math.min(ship.health.current + 30, ship.health.max);
      }
      break;
  }
}

// ---- Snapshot serialization ----

export function worldToSnapshot(world: WorldState): SnapshotEntity[] {
  const entities: SnapshotEntity[] = [];
  for (const entity of world.entities.values()) {
    if (entity.dead) continue;
    entities.push(entityToSnapshot(entity));
  }
  return entities;
}

function entityToSnapshot(e: Entity): SnapshotEntity {
  const snap: SnapshotEntity = {
    id: e.id,
    type: e.type,
    ownerId: e.ownerId,
    x: e.position.x,
    y: e.position.y,
    vx: e.velocity.vx,
    vy: e.velocity.vy,
    angle: e.rotation.angle,
  };
  if (e.health) {
    snap.health = e.health.current;
    snap.maxHealth = e.health.max;
  }
  if (e.shipStats) {
    snap.shipType = e.shipStats.shipType;
  }
  if (e.powerupInventory) {
    snap.powerups = [...e.powerupInventory.items];
  }
  if (e.shield && e.shield.ticksLeft > 0) {
    snap.shieldActive = true;
  }
  if (e.emp && e.emp.ticksLeft > 0) {
    snap.empActive = true;
  }
  if (e.powerupType !== undefined) {
    snap.powerupType = e.powerupType;
  }
  if (e.lifespan) {
    snap.lifespan = e.lifespan.remaining;
  }
  if (e.portal) {
    snap.portalDamage = e.portal.damageAccumulated;
  }
  if (e.attractorActive) {
    snap.attractorActive = true;
  }
  if (e.scarabCarrying !== undefined) {
    snap.scarabCarrying = e.scarabCarrying;
  }
  return snap;
}
