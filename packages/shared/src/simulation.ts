import type { Entity, EntityId, PowerupInventory } from './types.js';
import { EntityType, ShipType, PowerupType } from './types.js';
import type { InputState, SnapshotEntity } from './protocol.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  DECEL,
  REBOUND_COEFF,
  DEFAULT_ORBIT_DISTANCE,
  PORTAL_ARC_SPEED,
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

export interface WorldState {
  tick: number;
  entities: Map<EntityId, Entity>;
  nextEntityId: EntityId;
}

export function createWorldState(): WorldState {
  return {
    tick: 0,
    entities: new Map(),
    nextEntityId: 1,
  };
}

// ---- Per-player state ----
const playerFireCooldowns = new Map<string, number>();
const playerBulletCounts = new Map<string, number>();

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
  playerFireCooldowns.set(ownerId, 0);
  playerBulletCounts.set(ownerId, 0);
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

  // Decrement fire cooldowns
  for (const [id, cd] of playerFireCooldowns) {
    if (cd > 0) playerFireCooldowns.set(id, cd - 1);
  }

  // Step entities
  for (const entity of world.entities.values()) {
    if (entity.dead) continue;
    switch (entity.type) {
      case EntityType.Ship:
        stepShip(world, entity, inputs.get(entity.ownerId));
        break;
      case EntityType.Portal:
        stepPortal(entity);
        break;
      case EntityType.Bullet:
        stepBullet(entity);
        break;
      case EntityType.Powerup:
        stepPowerup(entity);
        break;
      case EntityType.Explosion:
        stepLifespan(entity);
        break;
    }
  }

  // Collisions
  resolveCollisions(world);

  // Powerup spawning
  spawnPowerups(world);

  // Clean up dead entities
  for (const [id, entity] of world.entities) {
    if (entity.dead) {
      world.entities.delete(id);
      if (entity.type === EntityType.Bullet) {
        const count = playerBulletCounts.get(entity.ownerId) ?? 0;
        playerBulletCounts.set(entity.ownerId, Math.max(0, count - 1));
      }
    }
  }
}

function stepShip(world: WorldState, entity: Entity, input: InputState | undefined): void {
  if (!input) return;

  const rotDir = (input.left ? -1 : 0) + (input.right ? 1 : 0);
  applyRotation(entity, rotDir as -1 | 0 | 1);
  stepEntityPhysics(entity, input.thrust);

  // Primary fire
  if (input.fire && entity.shipStats) {
    tryFireBullets(world, entity);
  }

  // Secondary fire (fire powerup from inventory)
  if (input.secondaryFire && entity.powerupInventory && entity.powerupInventory.items.length > 0) {
    tryFirePowerup(world, entity);
  }

  // Shield countdown
  if (entity.shield) {
    entity.shield.ticksLeft--;
    if (entity.shield.ticksLeft <= 0) {
      entity.shield = undefined;
    }
  }
}

function tryFireBullets(world: WorldState, ship: Entity): void {
  const stats = ship.shipStats!;
  const gunLevel = GUN_LEVELS[Math.min(stats.gunLevel, GUN_LEVELS.length - 1)];
  const cooldown = playerFireCooldowns.get(ship.ownerId) ?? 0;
  if (cooldown > 0) return;
  const activeBullets = playerBulletCounts.get(ship.ownerId) ?? 0;
  if (activeBullets >= gunLevel.maxBullets) return;

  playerFireCooldowns.set(ship.ownerId, gunLevel.fireDelay);

  const rad = degToRad(ship.rotation.angle);
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);
  const spawnX = ship.position.x + cosA * BULLET_NOSE_OFFSET;
  const spawnY = ship.position.y + sinA * BULLET_NOSE_OFFSET;
  const bvx = ship.velocity.vx + cosA * BULLET_SPEED;
  const bvy = ship.velocity.vy + sinA * BULLET_SPEED;

  if (gunLevel.numShots === 1) {
    createBulletEntity(world, ship.ownerId, spawnX, spawnY, bvx, bvy, gunLevel.damage, gunLevel.size);
    playerBulletCounts.set(ship.ownerId, activeBullets + 1);
  } else {
    const perpX = -sinA * 4;
    const perpY = cosA * 4;
    createBulletEntity(world, ship.ownerId, spawnX + perpX, spawnY + perpY, bvx, bvy, gunLevel.damage, gunLevel.size);
    createBulletEntity(world, ship.ownerId, spawnX - perpX, spawnY - perpY, bvx, bvy, gunLevel.damage, gunLevel.size);
    playerBulletCounts.set(ship.ownerId, activeBullets + 2);
  }
}

function tryFirePowerup(world: WorldState, ship: Entity): void {
  const inv = ship.powerupInventory!;
  if (inv.items.length === 0) return;

  // Cooldown check (reuse fire cooldown)
  const cooldown = playerFireCooldowns.get(ship.ownerId) ?? 0;
  if (cooldown > 0) return;
  playerFireCooldowns.set(ship.ownerId, 10); // cooldown between powerup shots

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

function stepBullet(entity: Entity): void {
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

function stepPortal(entity: Entity): void {
  if (!entity.portal) return;
  entity.portal.orbitDegrees += PORTAL_ARC_SPEED;
  if (entity.portal.orbitDegrees >= 360) entity.portal.orbitDegrees -= 360;
  const centerX = ARENA_WIDTH / 2;
  const centerY = ARENA_HEIGHT / 2;
  const rad = degToRad(entity.portal.orbitDegrees);
  entity.position.x = centerX + Math.cos(rad) * DEFAULT_ORBIT_DISTANCE;
  entity.position.y = centerY + Math.sin(rad) * DEFAULT_ORBIT_DISTANCE;
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

// ---- Collision detection ----

function resolveCollisions(world: WorldState): void {
  const ships: Entity[] = [];
  const bullets: Entity[] = [];
  const powerups: Entity[] = [];

  for (const entity of world.entities.values()) {
    if (entity.dead) continue;
    if (entity.type === EntityType.Ship) ships.push(entity);
    else if (entity.type === EntityType.Bullet) bullets.push(entity);
    else if (entity.type === EntityType.Powerup) powerups.push(entity);
  }

  // Bullet vs Ship
  for (const bullet of bullets) {
    if (bullet.dead) continue;
    for (const ship of ships) {
      if (ship.dead) continue;
      if (bullet.ownerId === ship.ownerId) continue;
      const dx = bullet.position.x - ship.position.x;
      const dy = bullet.position.y - ship.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 15) {
        // Check shield
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

  // Ship vs Powerup (collection)
  for (const ship of ships) {
    if (ship.dead) continue;
    for (const powerup of powerups) {
      if (powerup.dead) continue;
      if (powerup.powerupType === undefined) continue;
      // Invulnerable for first N ticks
      if (powerup.lifespan && powerup.lifespan.remaining > POWERUP_LIFESPAN - POWERUP_INVULNERABLE_TICKS) continue;

      const dx = powerup.position.x - ship.position.x;
      const dy = powerup.position.y - ship.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < POWERUP_COLLISION_SIZE / 2 + 15) {
        collectPowerup(ship, powerup.powerupType);
        powerup.dead = true;
      }
    }
  }
}

function collectPowerup(ship: Entity, pType: PowerupType): void {
  const def = POWERUP_DEFINITIONS[pType];

  if (def.selfUse) {
    // Apply immediately
    applySelfUsePowerup(ship, pType);
  } else {
    // Add to inventory (max 5)
    if (!ship.powerupInventory) ship.powerupInventory = { items: [] };
    if (ship.powerupInventory.items.length < MAX_POWERUPS_INVENTORY) {
      ship.powerupInventory.items.push(pType);
    }
  }
}

function applySelfUsePowerup(ship: Entity, pType: PowerupType): void {
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
      // TODO: destroy nearby enemies (Phase 8)
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
  return snap;
}
