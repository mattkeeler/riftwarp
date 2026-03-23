import type { Entity, EntityId } from './types.js';
import { EntityType, ShipType } from './types.js';
import type { InputState, SnapshotEntity } from './protocol.js';
import { ARENA_WIDTH, ARENA_HEIGHT, DECEL, REBOUND_COEFF } from './constants.js';
import { applyRotation, stepEntityPhysics } from './physics.js';

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
  // Basic ship stats — will be expanded with full shipData in Phase 3
  const stats = getBasicShipStats(shipType);
  const id = world.nextEntityId++;
  const entity: Entity = {
    id,
    type: EntityType.Ship,
    ownerId,
    position: { x: spawnX, y: spawnY },
    velocity: { vx: 0, vy: 0 },
    rotation: { angle: 0, rotateSpeed: stats.rotateSpeed },
    physics: {
      maxThrust: stats.maxThrust,
      thrustPower: stats.accel,
      friction: DECEL,
      bounded: true,
      rebound: REBOUND_COEFF,
    },
    health: { current: stats.hp, max: stats.hp },
  };
  world.entities.set(id, entity);
  return entity;
}

interface BasicShipStats {
  rotateSpeed: number;
  maxThrust: number;
  accel: number;
  hp: number;
}

function getBasicShipStats(shipType: ShipType): BasicShipStats {
  // Simplified stats from g_fighterData — full version in Phase 3
  switch (shipType) {
    case ShipType.Tank:
      return { rotateSpeed: 5.0, maxThrust: 6.0, accel: 0.10, hp: 280 };
    case ShipType.Wing:
      return { rotateSpeed: 7.0, maxThrust: 7.0, accel: 0.18, hp: 240 };
    case ShipType.Squid:
      return { rotateSpeed: 10.0, maxThrust: 10.0, accel: 0.48, hp: 200 };
    case ShipType.Rabbit:
      return { rotateSpeed: 8.0, maxThrust: 8.5, accel: 0.30, hp: 180 };
    case ShipType.Turtle:
      return { rotateSpeed: 6.0, maxThrust: 6.5, accel: 0.15, hp: 250 };
    case ShipType.Flash:
      return { rotateSpeed: 9.0, maxThrust: 9.0, accel: 0.35, hp: 190 };
    case ShipType.Hunter:
      return { rotateSpeed: 7.5, maxThrust: 7.5, accel: 0.22, hp: 220 };
    case ShipType.Flagship:
      return { rotateSpeed: 5.5, maxThrust: 5.5, accel: 0.12, hp: 300 };
  }
}

// ---- Simulation tick ----

/** Map of playerId -> InputState for the current tick */
export type PlayerInputs = Map<string, InputState>;

/**
 * Advance the world by one tick.
 * Pure-ish: mutates the world in-place for performance.
 */
export function simulationTick(world: WorldState, inputs: PlayerInputs): void {
  world.tick++;

  for (const entity of world.entities.values()) {
    if (entity.dead) continue;

    switch (entity.type) {
      case EntityType.Ship:
        stepShip(entity, inputs.get(entity.ownerId));
        break;
      // Other entity types will be added in later phases
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
