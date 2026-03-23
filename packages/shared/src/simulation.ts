import type { Entity, EntityId } from './types.js';
import { EntityType, ShipType } from './types.js';
import type { InputState, SnapshotEntity } from './protocol.js';
import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  DECEL,
  REBOUND_COEFF,
  DEFAULT_ORBIT_DISTANCE,
  PORTAL_ARC_SPEED,
} from './constants.js';
import { applyRotation, stepEntityPhysics, degToRad } from './physics.js';
import { SHIP_DEFINITIONS } from './shipData.js';

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

// ---- Entity creation ----

/** Create a ship entity for a player at a spawn position */
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
  };
  world.entities.set(id, entity);
  return entity;
}

/** Create a wormhole portal entity for a player */
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

// ---- Simulation tick ----

/** Map of playerId -> InputState for the current tick */
export type PlayerInputs = Map<string, InputState>;

/**
 * Advance the world by one tick.
 * Mutates the world in-place for performance.
 */
export function simulationTick(world: WorldState, inputs: PlayerInputs): void {
  world.tick++;

  for (const entity of world.entities.values()) {
    if (entity.dead) continue;

    switch (entity.type) {
      case EntityType.Ship:
        stepShip(entity, inputs.get(entity.ownerId));
        break;
      case EntityType.Portal:
        stepPortal(entity);
        break;
    }
  }
}

function stepShip(entity: Entity, input: InputState | undefined): void {
  if (!input) return;

  // Rotation
  const rotDir = (input.left ? -1 : 0) + (input.right ? 1 : 0);
  applyRotation(entity, rotDir as -1 | 0 | 1);

  // Physics (thrust + friction + movement + bounce)
  stepEntityPhysics(entity, input.thrust);
}

function stepPortal(entity: Entity): void {
  if (!entity.portal) return;

  // Orbit around arena center
  entity.portal.orbitDegrees += PORTAL_ARC_SPEED;
  if (entity.portal.orbitDegrees >= 360) entity.portal.orbitDegrees -= 360;

  const centerX = ARENA_WIDTH / 2;
  const centerY = ARENA_HEIGHT / 2;
  const rad = degToRad(entity.portal.orbitDegrees);
  entity.position.x = centerX + Math.cos(rad) * DEFAULT_ORBIT_DISTANCE;
  entity.position.y = centerY + Math.sin(rad) * DEFAULT_ORBIT_DISTANCE;
}

// ---- Snapshot serialization ----

/** Convert world state to a snapshot for network transmission */
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
  if (e.shield && e.shield.ticksLeft > 0) {
    snap.shieldActive = true;
  }
  if (e.emp && e.emp.ticksLeft > 0) {
    snap.empActive = true;
  }
  if (e.powerupType !== undefined) {
    snap.powerupType = e.powerupType;
  }
  return snap;
}
