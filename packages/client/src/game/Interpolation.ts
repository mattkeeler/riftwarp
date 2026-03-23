import type { Snapshot } from '../network/WebSocketClient.js';
import type { SnapshotEntity } from '@riftwarp/shared';
import { SERVER_TICK_MS } from '@riftwarp/shared';

export interface InterpolatedEntity {
  id: number;
  type: string;
  ownerId: string;
  x: number;
  y: number;
  angle: number;
  health?: number;
  maxHealth?: number;
  shipType?: number;
  shieldActive?: boolean;
}

/** Lerp a single value */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Lerp an angle in degrees, taking the shortest path */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  if (diff > 180) diff -= 360;
  if (diff < -180) diff += 360;
  return a + diff * t;
}

/**
 * Interpolate between two snapshots based on current time.
 * Returns interpolated entity states for rendering.
 */
export function interpolateSnapshots(
  older: Snapshot,
  newer: Snapshot,
  now: number,
): InterpolatedEntity[] {
  // Calculate interpolation alpha
  const elapsed = now - newer.receivedAt;
  const interval = newer.receivedAt - older.receivedAt;
  // We render slightly in the past (one tick behind) for smooth interpolation
  // Alpha of 0 = render older, alpha of 1 = render newer
  const alpha = Math.max(0, Math.min(1, elapsed / Math.max(interval, SERVER_TICK_MS)));

  // Index older entities by id for fast lookup
  const olderMap = new Map<number, SnapshotEntity>();
  for (const e of older.entities) {
    olderMap.set(e.id, e);
  }

  const result: InterpolatedEntity[] = [];

  for (const newerEntity of newer.entities) {
    const olderEntity = olderMap.get(newerEntity.id);

    if (olderEntity) {
      // Interpolate between the two
      result.push({
        id: newerEntity.id,
        type: newerEntity.type,
        ownerId: newerEntity.ownerId,
        x: lerp(olderEntity.x, newerEntity.x, alpha),
        y: lerp(olderEntity.y, newerEntity.y, alpha),
        angle: lerpAngle(olderEntity.angle, newerEntity.angle, alpha),
        health: newerEntity.health,
        maxHealth: newerEntity.maxHealth,
        shipType: newerEntity.shipType,
        shieldActive: newerEntity.shieldActive,
      });
    } else {
      // New entity, no interpolation
      result.push({
        id: newerEntity.id,
        type: newerEntity.type,
        ownerId: newerEntity.ownerId,
        x: newerEntity.x,
        y: newerEntity.y,
        angle: newerEntity.angle,
        health: newerEntity.health,
        maxHealth: newerEntity.maxHealth,
        shipType: newerEntity.shipType,
        shieldActive: newerEntity.shieldActive,
      });
    }
  }

  return result;
}

/**
 * Use the latest snapshot directly (no interpolation).
 * Fallback when we only have one snapshot.
 */
export function snapshotToEntities(snap: Snapshot): InterpolatedEntity[] {
  return snap.entities.map((e) => ({
    id: e.id,
    type: e.type,
    ownerId: e.ownerId,
    x: e.x,
    y: e.y,
    angle: e.angle,
    health: e.health,
    maxHealth: e.maxHealth,
    shipType: e.shipType,
    shieldActive: e.shieldActive,
  }));
}
