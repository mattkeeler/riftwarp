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
  simulationTick,
  worldToSnapshot,
  type WorldState,
  type PlayerInputs,
} from '@riftwarp/shared';
import type { ConnectedClient, ConnectionManager } from './ConnectionManager.js';
import { Ticker } from './Ticker.js';

/**
 * A single game room that runs the authoritative simulation.
 * For Phase 2, all connected clients are in one room.
 */
export class GameRoom {
  private world: WorldState = createWorldState();
  private ticker: Ticker;
  private playerInputs: PlayerInputs = new Map();
  private playerEntityIds = new Map<string, number>(); // playerId -> entityId

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

  addPlayer(client: ConnectedClient): void {
    // Spawn at a random position within the arena
    const spawnX = 100 + Math.random() * (ARENA_WIDTH - 200);
    const spawnY = 100 + Math.random() * (ARENA_HEIGHT - 200);
    const entity = createShipEntity(this.world, client.id, ShipType.Tank, spawnX, spawnY);
    this.playerEntityIds.set(client.id, entity.id);

    // Send game start to this player
    const players = this.connections.getAllClients().map((c, i) => ({
      playerId: c.id,
      username: c.username,
      slot: i,
      team: 0 as const,
      shipType: ShipType.Tank,
    }));
    this.connections.send(client, { type: 'gameStart', players });

    console.log(`[room] player ${client.username} (${client.id}) spawned entity ${entity.id} at (${Math.round(spawnX)}, ${Math.round(spawnY)})`);
  }

  removePlayer(clientId: string): void {
    const entityId = this.playerEntityIds.get(clientId);
    if (entityId !== undefined) {
      const entity = this.world.entities.get(entityId);
      if (entity) entity.dead = true;
      this.playerEntityIds.delete(clientId);
    }
    this.playerInputs.delete(clientId);
  }

  /** Called by ConnectionManager when input arrives */
  updateInput(clientId: string, input: import('@riftwarp/shared').InputState, seq: number): void {
    this.playerInputs.set(clientId, input);
    // Acknowledge the input so the client can reconcile
    const client = this.connections.getClient(clientId);
    if (client) {
      this.connections.send(client, { type: 'inputAck', seq });
    }
  }

  private onTick(tick: number): void {
    // Step the simulation with current inputs
    simulationTick(this.world, this.playerInputs);

    // Broadcast snapshot to all clients
    const snapshot: ServerMessage = {
      type: 'snapshot',
      tick: this.world.tick,
      entities: worldToSnapshot(this.world),
    };
    this.connections.broadcast(snapshot);
  }
}
