import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  EntityType,
  type InputState,
  EMPTY_INPUT,
} from '@riftwarp/shared';
import type { WorldState, Entity } from '@riftwarp/shared';

/**
 * AI bot that generates InputState each tick based on world state.
 * Behaviors: wander, chase player, collect powerup, dodge bullets, fire.
 */
export class BotController {
  private wanderAngle = Math.random() * 360;
  private wanderTimer = 0;
  private fireTimer = 0;

  constructor(
    public readonly playerId: string,
    public readonly difficulty: 'easy' | 'medium' | 'hard' = 'medium',
  ) {}

  generateInput(world: WorldState): InputState {
    const ship = this.findOwnShip(world);
    if (!ship) return { ...EMPTY_INPUT };

    const input: InputState = {
      left: false,
      right: false,
      thrust: false,
      fire: false,
      secondaryFire: false,
      special: false,
    };

    // Find targets
    const nearestEnemy = this.findNearestEnemy(world, ship);
    const nearestPowerup = this.findNearestPowerup(world, ship);
    const nearestPlayerShip = this.findNearestPlayerShip(world, ship);

    // Decision: what to pursue
    let targetX: number;
    let targetY: number;
    let shouldFire = false;

    if (nearestEnemy && this.dist(ship, nearestEnemy) < 200) {
      // Dodge/fight enemies attacking us
      targetX = nearestEnemy.position.x;
      targetY = nearestEnemy.position.y;
      shouldFire = true;
    } else if (nearestPowerup && this.dist(ship, nearestPowerup) < 300) {
      // Collect nearby powerup
      targetX = nearestPowerup.position.x;
      targetY = nearestPowerup.position.y;
    } else if (nearestPlayerShip) {
      // Chase other players
      targetX = nearestPlayerShip.position.x;
      targetY = nearestPlayerShip.position.y;
      shouldFire = this.dist(ship, nearestPlayerShip) < 250;
    } else {
      // Wander
      this.wanderTimer--;
      if (this.wanderTimer <= 0) {
        this.wanderAngle = Math.random() * 360;
        this.wanderTimer = 40 + Math.random() * 60;
      }
      const rad = (this.wanderAngle * Math.PI) / 180;
      targetX = ship.position.x + Math.cos(rad) * 100;
      targetY = ship.position.y + Math.sin(rad) * 100;

      // Avoid walls
      if (targetX < 50 || targetX > ARENA_WIDTH - 50 || targetY < 50 || targetY > ARENA_HEIGHT - 50) {
        targetX = ARENA_WIDTH / 2;
        targetY = ARENA_HEIGHT / 2;
      }
    }

    // Steer toward target
    const dx = targetX - ship.position.x;
    const dy = targetY - ship.position.y;
    const targetAngle = Math.atan2(dy, dx) * (180 / Math.PI);
    let diff = targetAngle - ship.rotation.angle;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;

    const turnThreshold = this.difficulty === 'easy' ? 20 : this.difficulty === 'hard' ? 5 : 10;

    if (diff > turnThreshold) input.right = true;
    else if (diff < -turnThreshold) input.left = true;

    // Thrust when roughly aimed
    if (Math.abs(diff) < 45) {
      input.thrust = true;
    }

    // Fire
    this.fireTimer--;
    if (shouldFire && Math.abs(diff) < 25 && this.fireTimer <= 0) {
      input.fire = true;
      const fireRate = this.difficulty === 'easy' ? 8 : this.difficulty === 'hard' ? 2 : 4;
      this.fireTimer = fireRate;
    }

    // Use secondary fire (powerup) when we have inventory and near an enemy portal
    if (ship.powerupInventory && ship.powerupInventory.items.length > 0) {
      const nearestPortal = this.findNearestEnemyPortal(world, ship);
      if (nearestPortal && this.dist(ship, nearestPortal) < 60 && Math.abs(diff) < 30) {
        input.secondaryFire = true;
      }
    }

    // Use special ability occasionally
    if (Math.random() < 0.005) {
      input.special = true;
    }

    return input;
  }

  private findOwnShip(world: WorldState): Entity | undefined {
    for (const e of world.entities.values()) {
      if (e.type === EntityType.Ship && e.ownerId === this.playerId && !e.dead) return e;
    }
    return undefined;
  }

  private findNearestEnemy(world: WorldState, ship: Entity): Entity | undefined {
    let nearest: Entity | undefined;
    let nearestDist = Infinity;
    for (const e of world.entities.values()) {
      if (e.dead) continue;
      if (e.ownerId !== this.playerId) continue; // enemies targeting us
      if (e.type === EntityType.Ship || e.type === EntityType.Portal ||
          e.type === EntityType.Bullet || e.type === EntityType.Powerup ||
          e.type === EntityType.Explosion) continue;
      const d = this.dist(ship, e);
      if (d < nearestDist) { nearestDist = d; nearest = e; }
    }
    return nearest;
  }

  private findNearestPowerup(world: WorldState, ship: Entity): Entity | undefined {
    let nearest: Entity | undefined;
    let nearestDist = Infinity;
    for (const e of world.entities.values()) {
      if (e.dead || e.type !== EntityType.Powerup) continue;
      const d = this.dist(ship, e);
      if (d < nearestDist) { nearestDist = d; nearest = e; }
    }
    return nearest;
  }

  private findNearestPlayerShip(world: WorldState, ship: Entity): Entity | undefined {
    let nearest: Entity | undefined;
    let nearestDist = Infinity;
    for (const e of world.entities.values()) {
      if (e.dead || e.type !== EntityType.Ship) continue;
      if (e.ownerId === this.playerId) continue;
      const d = this.dist(ship, e);
      if (d < nearestDist) { nearestDist = d; nearest = e; }
    }
    return nearest;
  }

  private findNearestEnemyPortal(world: WorldState, ship: Entity): Entity | undefined {
    let nearest: Entity | undefined;
    let nearestDist = Infinity;
    for (const e of world.entities.values()) {
      if (e.dead || e.type !== EntityType.Portal) continue;
      if (e.ownerId === this.playerId) continue;
      const d = this.dist(ship, e);
      if (d < nearestDist) { nearestDist = d; nearest = e; }
    }
    return nearest;
  }

  private dist(a: Entity, b: Entity): number {
    const dx = a.position.x - b.position.x;
    const dy = a.position.y - b.position.y;
    return Math.sqrt(dx * dx + dy * dy);
  }
}
