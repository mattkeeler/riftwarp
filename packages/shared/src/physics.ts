import type { Entity } from './types.js';
import { ARENA_WIDTH, ARENA_HEIGHT, DECEL, REBOUND_COEFF, VELOCITY_ZERO_THRESHOLD } from './constants.js';

/** Convert degrees to radians */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Normalize angle to [0, 360) */
export function normalizeAngle(angle: number): number {
  let a = angle % 360;
  if (a < 0) a += 360;
  return a;
}

/** Apply rotation to an entity based on input */
export function applyRotation(entity: Entity, direction: -1 | 0 | 1): void {
  if (direction === 0) return;
  entity.rotation.angle = normalizeAngle(
    entity.rotation.angle + direction * entity.rotation.rotateSpeed,
  );
}

/** Apply thrust in the direction the entity is facing */
export function applyThrust(entity: Entity): void {
  if (!entity.physics) return;
  const rad = degToRad(entity.rotation.angle);
  entity.velocity.vx += Math.cos(rad) * entity.physics.thrustPower;
  entity.velocity.vy += Math.sin(rad) * entity.physics.thrustPower;

  // Clamp to max thrust
  const speed = Math.sqrt(entity.velocity.vx ** 2 + entity.velocity.vy ** 2);
  if (speed > entity.physics.maxThrust) {
    const scale = entity.physics.maxThrust / speed;
    entity.velocity.vx *= scale;
    entity.velocity.vy *= scale;
  }
}

/** Apply friction/deceleration */
export function applyFriction(entity: Entity): void {
  const friction = entity.physics?.friction ?? DECEL;
  entity.velocity.vx *= friction;
  entity.velocity.vy *= friction;

  // Zero out tiny velocities
  if (Math.abs(entity.velocity.vx) < VELOCITY_ZERO_THRESHOLD) entity.velocity.vx = 0;
  if (Math.abs(entity.velocity.vy) < VELOCITY_ZERO_THRESHOLD) entity.velocity.vy = 0;
}

/** Move entity by its velocity */
export function applyMovement(entity: Entity): void {
  entity.position.x += entity.velocity.vx;
  entity.position.y += entity.velocity.vy;
}

/** Bounce off arena walls */
export function handleBounce(
  entity: Entity,
  width: number = ARENA_WIDTH,
  height: number = ARENA_HEIGHT,
): void {
  const rebound = entity.physics?.rebound ?? REBOUND_COEFF;

  if (entity.position.x < 0) {
    entity.position.x = 0;
    entity.velocity.vx *= rebound;
  } else if (entity.position.x > width) {
    entity.position.x = width;
    entity.velocity.vx *= rebound;
  }

  if (entity.position.y < 0) {
    entity.position.y = 0;
    entity.velocity.vy *= rebound;
  } else if (entity.position.y > height) {
    entity.position.y = height;
    entity.velocity.vy *= rebound;
  }
}

/** Full physics step for one entity */
export function stepEntityPhysics(entity: Entity, isThrusting: boolean): void {
  if (isThrusting) {
    applyThrust(entity);
  }
  applyFriction(entity);
  applyMovement(entity);
  if (entity.physics?.bounded) {
    handleBounce(entity);
  }
}
