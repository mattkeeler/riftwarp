import { ShipType } from './types.js';

/**
 * Ship polygon vertices ported from g_shipPoints in PlayerSprite.java.
 *
 * Original data is half-polygons (x values are negative/zero) that get mirrored
 * to create the full shape. The original coordinate system has Y pointing "up"
 * (negative Y = forward/nose), so we rotate 90° to our convention where
 * the ship points right (positive X = forward).
 *
 * Conversion: original (x, y) -> our (-y, x) for rightward-facing, then mirror on X axis.
 */

interface RawVertex {
  x: number;
  y: number;
  flag: number; // rendering flag from original (0 = move-to, 1 = draw-to)
}

// Raw half-polygon data from g_shipPoints (original coordinates)
const RAW_SHIP_POINTS: Record<ShipType, RawVertex[]> = {
  [ShipType.Tank]: [
    { x: -3, y: -14, flag: 0 }, { x: -3, y: -18, flag: 1 }, { x: -5, y: -15, flag: 0 },
    { x: -7, y: -3, flag: 0 }, { x: -19, y: -6, flag: 1 }, { x: -16, y: 1, flag: 1 },
    { x: -9, y: 5, flag: 0 }, { x: -6, y: 8, flag: 1 },
  ],
  [ShipType.Wing]: [
    { x: 0, y: -18, flag: 1 }, { x: -4, y: -4, flag: 0 }, { x: -12, y: 5, flag: 1 },
    { x: -5, y: 5, flag: 0 }, { x: -3, y: 9, flag: 1 },
  ],
  [ShipType.Squid]: [
    { x: -3, y: -16, flag: 1 }, { x: -6, y: 14, flag: 0 }, { x: -10, y: -7, flag: 1 },
    { x: -12, y: -2, flag: 1 }, { x: -12, y: 2, flag: 1 }, { x: -5, y: 19, flag: 1 },
    { x: -8, y: 2, flag: 0 }, { x: -3, y: 2, flag: 0 }, { x: 0, y: 22, flag: 1 },
  ],
  [ShipType.Rabbit]: [
    { x: -3, y: -12, flag: 1 }, { x: -6, y: -3, flag: 1 }, { x: -6, y: 3, flag: 1 },
    { x: -10, y: 5, flag: 0 }, { x: -10, y: 20, flag: 0 }, { x: -3, y: 20, flag: 0 },
    { x: -3, y: 5, flag: 0 }, { x: -10, y: 5, flag: 0 }, { x: -6, y: 10, flag: 1 },
  ],
  [ShipType.Turtle]: [
    { x: 0, y: -18, flag: 1 }, { x: -4, y: -15, flag: 1 }, { x: -4, y: -12, flag: 0 },
    { x: -7, y: -9, flag: 0 }, { x: -13, y: -10, flag: 1 }, { x: -10, y: -6, flag: 1 },
    { x: -10, y: 7, flag: 1 }, { x: -13, y: 13, flag: 1 }, { x: -7, y: 10, flag: 1 },
    { x: 0, y: 15, flag: 1 },
  ],
  [ShipType.Flash]: [
    { x: 0, y: -15, flag: 0 }, { x: -15, y: 11, flag: 0 }, { x: -5, y: 5, flag: 0 },
    { x: -10, y: 11, flag: 0 }, { x: 0, y: 7, flag: 0 },
  ],
  [ShipType.Hunter]: [
    { x: 0, y: -18, flag: 1 }, { x: -7, y: 9, flag: 0 }, { x: -13, y: 10, flag: 1 },
    { x: -10, y: 6, flag: 0 }, { x: -4, y: 15, flag: 0 }, { x: -4, y: 12, flag: 0 },
    { x: 0, y: 18, flag: 1 },
  ],
  [ShipType.Flagship]: [
    { x: 0, y: -37, flag: 0 }, { x: -15, y: -37, flag: 1 }, { x: -15, y: -24, flag: 0 },
    { x: -8, y: -24, flag: 0 }, { x: -8, y: -15, flag: 0 }, { x: -22, y: -15, flag: 0 },
    { x: -22, y: -19, flag: 0 }, { x: -29, y: -19, flag: 1 }, { x: -29, y: 19, flag: 1 },
    { x: -22, y: 19, flag: 0 }, { x: -22, y: 12, flag: 0 }, { x: 0, y: 12, flag: 0 },
  ],
};

/**
 * Build a full polygon from half-polygon data.
 * The original ships are symmetric: we take the left half and mirror it.
 * Original coords: Y-up (negative Y = nose). We convert to X-right (positive X = nose).
 *
 * Conversion: (origX, origY) → (renderX, renderY) = (-origY, origX)
 * Then mirror: for each point with x != 0, add its mirror at (-origX) → (-origY, -origX)
 */
function buildPolygon(raw: RawVertex[]): number[] {
  // Convert half-polygon to our coordinate system
  const leftSide: Array<{ x: number; y: number }> = raw.map((v) => ({
    x: -v.y, // nose points right
    y: v.x,  // mirror axis
  }));

  // Build full outline: left side forward, then right side (mirrored Y) backward
  const rightSide = leftSide
    .filter((v) => v.y !== 0)
    .map((v) => ({ x: v.x, y: -v.y }))
    .reverse();

  const fullPoly = [...leftSide, ...rightSide];

  // Flatten to [x1, y1, x2, y2, ...]
  const result: number[] = [];
  for (const v of fullPoly) {
    result.push(v.x, v.y);
  }
  return result;
}

// Pre-compute all ship polygons
const polygonCache = new Map<ShipType, number[]>();

/**
 * Get the full polygon vertices for a ship type as a flat array [x1, y1, x2, y2, ...].
 * Ships point to the right (positive X) at angle 0.
 */
export function getShipPolygon(type: ShipType): number[] {
  let poly = polygonCache.get(type);
  if (!poly) {
    poly = buildPolygon(RAW_SHIP_POINTS[type]);
    polygonCache.set(type, poly);
  }
  return poly;
}

/**
 * Ship colors for each type.
 */
export const SHIP_COLORS: Record<ShipType, number> = {
  [ShipType.Tank]: 0x00ffaa,    // green
  [ShipType.Wing]: 0x44aaff,    // blue
  [ShipType.Squid]: 0xff44ff,   // magenta
  [ShipType.Rabbit]: 0xffaa00,  // orange
  [ShipType.Turtle]: 0x00ff44,  // bright green
  [ShipType.Flash]: 0xffff44,   // yellow
  [ShipType.Hunter]: 0xff4444,  // red
  [ShipType.Flagship]: 0xaaaaff, // light blue
};
