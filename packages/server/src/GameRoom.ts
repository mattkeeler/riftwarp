import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  SERVER_TICK_MS,
  ShipType,
  type ServerMessage,
} from '@riftwarp/shared';
import {
  createWorldState,
  createShipEntity,
  createPortalEntity,
  simulationTick,
  worldToSnapshot,
  type WorldState,
  type PlayerInputs,
} from '@riftwarp/shared';
import type { ConnectedClient, ConnectionManager } from './ConnectionManager.js';
import { Ticker } from './Ticker.js';

export class GameRoom {
  private world: WorldState = createWorldState();
  private ticker: Ticker;
  private playerInputs: PlayerInputs = new Map();
  private playerEntityIds = new Map<string, number>();
  private playerPortalIds = new Map<string, number>();
  private playerShipTypes = new Map<string, ShipType>();

  constructor(private connections: ConnectionManager) {
    this.ticker = new Ticker((tick) => this.onTick(tick), SERVER_TICK_MS);
  }

  start(): void {
    this.ticker.start();
    console.log(`[room] simulation started at ${1000 / SERVER_TICK_MS}Hz`);
  }

  stop(): void {
    this.ticker.stop();
  }

  addPlayer(client: ConnectedClient, shipType: ShipType = ShipType.Tank): void {
    const spawnX = 100 + Math.random() * (ARENA_WIDTH - 200);
    const spawnY = 100 + Math.random() * (ARENA_HEIGHT - 200);
    this.playerShipTypes.set(client.id, shipType);

    // Create ship
    const entity = createShipEntity(this.world, client.id, shipType, spawnX, spawnY);
    this.playerEntityIds.set(client.id, entity.id);

    // Create wormhole portal — evenly space portals around the orbit
    const playerCount = this.playerPortalIds.size;
    const startDegrees = playerCount * (360 / Math.max(playerCount + 1, 2));
    const portal = createPortalEntity(this.world, client.id, startDegrees);
    this.playerPortalIds.set(client.id, portal.id);

    // Rebalance portal positions for all players
    this.rebalancePortals();

    // Send game start
    const players = this.connections.getAllClients().map((c, i) => ({
      playerId: c.id,
      username: c.username,
      slot: i,
      team: 0 as const,
      shipType: this.playerShipTypes.get(c.id) ?? ShipType.Tank,
    }));
    this.connections.send(client, { type: 'gameStart', players });

    console.log(`[room] player ${client.username} (${client.id}) spawned ${ShipType[shipType]} + portal`);
  }

  changeShip(clientId: string, shipType: ShipType): void {
    this.playerShipTypes.set(clientId, shipType);
    const oldEntityId = this.playerEntityIds.get(clientId);
    if (oldEntityId !== undefined) {
      const oldEntity = this.world.entities.get(oldEntityId);
      if (oldEntity) {
        const spawnX = oldEntity.position.x;
        const spawnY = oldEntity.position.y;
        oldEntity.dead = true;
        const newEntity = createShipEntity(this.world, clientId, shipType, spawnX, spawnY);
        newEntity.rotation.angle = oldEntity.rotation.angle;
        this.playerEntityIds.set(clientId, newEntity.id);
      }
    }
  }

  removePlayer(clientId: string): void {
    // Remove ship
    const entityId = this.playerEntityIds.get(clientId);
    if (entityId !== undefined) {
      const entity = this.world.entities.get(entityId);
      if (entity) entity.dead = true;
      this.playerEntityIds.delete(clientId);
    }
    // Remove portal
    const portalId = this.playerPortalIds.get(clientId);
    if (portalId !== undefined) {
      const portal = this.world.entities.get(portalId);
      if (portal) portal.dead = true;
      this.playerPortalIds.delete(clientId);
    }
    this.playerInputs.delete(clientId);
    this.playerShipTypes.delete(clientId);
    this.rebalancePortals();
  }

  updateInput(clientId: string, input: import('@riftwarp/shared').InputState, seq: number): void {
    this.playerInputs.set(clientId, input);
    const client = this.connections.getClient(clientId);
    if (client) {
      this.connections.send(client, { type: 'inputAck', seq });
    }
  }

  /** Evenly distribute portal orbit positions */
  private rebalancePortals(): void {
    const portalIds = Array.from(this.playerPortalIds.values());
    const count = portalIds.length;
    if (count === 0) return;
    for (let i = 0; i < count; i++) {
      const portal = this.world.entities.get(portalIds[i]);
      if (portal?.portal) {
        portal.portal.orbitDegrees = (i * 360) / count;
      }
    }
  }

  private onTick(_tick: number): void {
    simulationTick(this.world, this.playerInputs);
    const snapshot: ServerMessage = {
      type: 'snapshot',
      tick: this.world.tick,
      entities: worldToSnapshot(this.world),
    };
    this.connections.broadcast(snapshot);
  }
}
