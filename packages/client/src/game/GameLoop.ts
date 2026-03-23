import { Application, Graphics } from 'pixi.js';
import { EntityType, ARENA_WIDTH, ARENA_HEIGHT } from '@riftwarp/shared';
import type { WebSocketClient } from '../network/WebSocketClient.js';
import type { InputManager } from './InputManager.js';
import {
  interpolateSnapshots,
  snapshotToEntities,
  type InterpolatedEntity,
} from './Interpolation.js';
import { degToRad } from '@riftwarp/shared';

// Simple ship polygon (triangle pointing right)
const SHIP_VERTICES = [
  { x: 15, y: 0 },   // nose
  { x: -10, y: -8 },  // left wing
  { x: -6, y: 0 },    // rear center
  { x: -10, y: 8 },   // right wing
];

/**
 * Main client game loop.
 * Runs at 60fps via requestAnimationFrame.
 * Renders interpolated server state with local prediction for the player's ship.
 */
export class GameLoop {
  private app: Application | null = null;
  private shipGraphics = new Map<number, Graphics>();
  private arenaGraphics: Graphics | null = null;
  private running = false;

  constructor(
    private network: WebSocketClient,
    private input: InputManager,
  ) {}

  async init(container: HTMLElement): Promise<void> {
    this.app = new Application();
    await this.app.init({
      background: '#0a0a0a',
      resizeTo: container,
      antialias: true,
    });
    container.appendChild(this.app.canvas);

    // Draw arena boundary
    this.arenaGraphics = new Graphics();
    this.app.stage.addChild(this.arenaGraphics);
  }

  start(): void {
    if (!this.app) return;
    this.running = true;
    this.app.ticker.add(() => this.onFrame());
  }

  stop(): void {
    this.running = false;
  }

  destroy(): void {
    this.stop();
    this.app?.destroy(true);
    this.app = null;
  }

  private onFrame(): void {
    if (!this.running || !this.app) return;

    const entities = this.getInterpolatedEntities();
    this.render(entities);
  }

  private getInterpolatedEntities(): InterpolatedEntity[] {
    const [older, newer] = this.network.getSnapshots();

    if (!newer) return [];
    if (!older) return snapshotToEntities(newer);

    return interpolateSnapshots(older, newer, performance.now());
  }

  private render(entities: InterpolatedEntity[]): void {
    if (!this.app) return;

    const playerId = this.network.playerId;

    // Find local player for viewport centering
    const localPlayer = entities.find(
      (e) => e.type === EntityType.Ship && e.ownerId === playerId,
    );

    // Calculate viewport offset (center camera on local player)
    const screenW = this.app.screen.width;
    const screenH = this.app.screen.height;
    let offsetX = 0;
    let offsetY = 0;

    if (localPlayer) {
      offsetX = screenW / 2 - localPlayer.x;
      offsetY = screenH / 2 - localPlayer.y;
    } else {
      // No local player yet, center on arena
      offsetX = screenW / 2 - ARENA_WIDTH / 2;
      offsetY = screenH / 2 - ARENA_HEIGHT / 2;
    }

    // Draw arena boundary
    this.arenaGraphics!.clear();
    this.arenaGraphics!.rect(offsetX, offsetY, ARENA_WIDTH, ARENA_HEIGHT);
    this.arenaGraphics!.stroke({ color: 0x333333, width: 2 });

    // Track which entity graphics we've used this frame
    const usedIds = new Set<number>();

    for (const entity of entities) {
      if (entity.type !== EntityType.Ship) continue;

      usedIds.add(entity.id);

      let gfx = this.shipGraphics.get(entity.id);
      if (!gfx) {
        gfx = new Graphics();
        this.app!.stage.addChild(gfx);
        this.shipGraphics.set(entity.id, gfx);
      }

      // Determine color
      const isLocal = entity.ownerId === playerId;
      const shipColor = isLocal ? 0x00ffaa : 0xff4444;

      // Draw ship
      gfx.clear();

      // Ship polygon
      gfx.poly(
        SHIP_VERTICES.flatMap((v) => [v.x, v.y]),
        true,
      );
      gfx.fill({ color: shipColor, alpha: 0.3 });
      gfx.stroke({ color: shipColor, width: 2 });

      // Position and rotate
      gfx.x = entity.x + offsetX;
      gfx.y = entity.y + offsetY;
      gfx.rotation = degToRad(entity.angle);

      // Health bar (above ship)
      if (entity.health !== undefined && entity.maxHealth !== undefined) {
        const barWidth = 30;
        const barHeight = 3;
        const healthPct = entity.health / entity.maxHealth;

        // Background
        gfx.rect(-barWidth / 2, -20, barWidth, barHeight);
        gfx.fill({ color: 0x333333 });

        // Health fill
        gfx.rect(-barWidth / 2, -20, barWidth * healthPct, barHeight);
        gfx.fill({ color: healthPct > 0.5 ? 0x00ff00 : healthPct > 0.25 ? 0xffff00 : 0xff0000 });
      }
    }

    // Remove graphics for entities that no longer exist
    for (const [id, gfx] of this.shipGraphics) {
      if (!usedIds.has(id)) {
        gfx.destroy();
        this.shipGraphics.delete(id);
      }
    }
  }
}
