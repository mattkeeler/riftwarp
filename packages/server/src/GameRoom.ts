import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  SERVER_TICK_MS,
  COUNTDOWN_SECONDS,
  MIN_PLAYERS_TO_START,
  ShipType,
  RoomState,
  EntityType,
  type ServerMessage,
  type InputState,
  type SnapshotPlayerInfo,
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

interface PlayerState {
  shipType: ShipType;
  shipEntityId: number | null;
  portalEntityId: number | null;
  alive: boolean;
  wins: number;
  slot: number;
}

export class GameRoom {
  private world: WorldState = createWorldState();
  private ticker: Ticker;
  private playerInputs: PlayerInputs = new Map();
  private players = new Map<string, PlayerState>();
  private state: RoomState = RoomState.Idle;
  private countdownTicks = 0;
  private gameOverTicks = 0;
  private nextSlot = 0;

  constructor(private connections: ConnectionManager) {
    this.ticker = new Ticker((_tick) => this.onTick(), SERVER_TICK_MS);
  }

  start(): void {
    this.ticker.start();
    console.log(`[room] simulation started at ${1000 / SERVER_TICK_MS}Hz`);
  }

  stop(): void {
    this.ticker.stop();
  }

  addPlayer(client: ConnectedClient, shipType: ShipType = ShipType.Tank): void {
    const slot = this.nextSlot++;
    const ps: PlayerState = {
      shipType,
      shipEntityId: null,
      portalEntityId: null,
      alive: false,
      wins: 0,
      slot,
    };
    this.players.set(client.id, ps);

    // Spawn ship and portal immediately (sandbox mode until game starts)
    this.spawnPlayer(client.id);

    // Send game start info
    this.broadcastGameStart();

    // If we're idle and have enough players, start countdown
    if (this.state === RoomState.Idle && this.players.size >= MIN_PLAYERS_TO_START) {
      this.startCountdown();
    }

    console.log(`[room] ${client.username} joined as ${ShipType[shipType]} (slot ${slot})`);
  }

  changeShip(clientId: string, shipType: ShipType): void {
    const ps = this.players.get(clientId);
    if (!ps) return;
    ps.shipType = shipType;

    // Respawn with new ship
    if (ps.shipEntityId !== null) {
      const oldEntity = this.world.entities.get(ps.shipEntityId);
      const pos = oldEntity ? { x: oldEntity.position.x, y: oldEntity.position.y, angle: oldEntity.rotation.angle } : null;
      this.despawnShip(clientId);
      this.spawnShip(clientId);
      if (pos && ps.shipEntityId !== null) {
        const newEntity = this.world.entities.get(ps.shipEntityId);
        if (newEntity) {
          newEntity.position.x = pos.x;
          newEntity.position.y = pos.y;
          newEntity.rotation.angle = pos.angle;
        }
      }
    }
  }

  removePlayer(clientId: string): void {
    this.despawnPlayer(clientId);
    this.players.delete(clientId);
    this.playerInputs.delete(clientId);
    this.rebalancePortals();

    // Check if game should end
    if (this.state === RoomState.Playing) {
      this.checkGameOver();
    }
  }

  requestStart(): void {
    if (this.state === RoomState.Idle && this.players.size >= 1) {
      this.startCountdown();
    }
  }

  updateInput(clientId: string, input: InputState, seq: number): void {
    const ps = this.players.get(clientId);
    if (!ps || !ps.alive) return; // Don't accept input from dead players

    this.playerInputs.set(clientId, input);
    const client = this.connections.getClient(clientId);
    if (client) {
      this.connections.send(client, { type: 'inputAck', seq });
    }
  }

  // ---- Lifecycle ----

  private startCountdown(): void {
    this.state = RoomState.Countdown;
    this.countdownTicks = COUNTDOWN_SECONDS * (1000 / SERVER_TICK_MS);
    this.connections.broadcast({ type: 'roomStateChanged', state: RoomState.Countdown, countdown: COUNTDOWN_SECONDS });
    console.log(`[room] countdown started (${COUNTDOWN_SECONDS}s)`);
  }

  private startGame(): void {
    this.state = RoomState.Playing;

    // Reset world and respawn all players
    this.world = createWorldState();
    for (const [clientId, ps] of this.players) {
      ps.shipEntityId = null;
      ps.portalEntityId = null;
      ps.alive = false;
      this.spawnPlayer(clientId);
      ps.alive = true;
    }
    this.rebalancePortals();

    this.connections.broadcast({ type: 'roomStateChanged', state: RoomState.Playing });
    this.broadcastGameStart();
    console.log(`[room] game started with ${this.players.size} players`);
  }

  private checkGameOver(): void {
    const alivePlayers = Array.from(this.players.entries()).filter(([, ps]) => ps.alive);
    if (alivePlayers.length <= 1 && this.players.size >= MIN_PLAYERS_TO_START) {
      const winner = alivePlayers[0];
      if (winner) {
        const [winnerId, winnerPs] = winner;
        winnerPs.wins++;
        this.connections.broadcast({ type: 'gameOver', winnerId });
        this.connections.broadcast({ type: 'gameEvent', text: `${this.getUsername(winnerId)} wins!` });
        console.log(`[room] ${this.getUsername(winnerId)} wins (${winnerPs.wins} total)`);
      } else {
        this.connections.broadcast({ type: 'gameOver' });
        this.connections.broadcast({ type: 'gameEvent', text: 'Draw!' });
      }

      this.state = RoomState.GameOver;
      this.gameOverTicks = 3 * (1000 / SERVER_TICK_MS); // 3 seconds
    }
  }

  private endGameOver(): void {
    this.state = RoomState.Idle;
    this.connections.broadcast({ type: 'roomStateChanged', state: RoomState.Idle });

    // Respawn all players for next round
    this.world = createWorldState();
    for (const [clientId, ps] of this.players) {
      ps.shipEntityId = null;
      ps.portalEntityId = null;
      ps.alive = false;
      this.spawnPlayer(clientId);
    }
    this.rebalancePortals();
    this.broadcastGameStart();

    // Auto-start countdown if enough players
    if (this.players.size >= MIN_PLAYERS_TO_START) {
      this.startCountdown();
    }

    console.log('[room] round reset, waiting for next game');
  }

  // ---- Spawning ----

  private spawnPlayer(clientId: string): void {
    this.spawnShip(clientId);
    this.spawnPortal(clientId);
  }

  private spawnShip(clientId: string): void {
    const ps = this.players.get(clientId);
    if (!ps) return;
    const spawnX = 100 + Math.random() * (ARENA_WIDTH - 200);
    const spawnY = 100 + Math.random() * (ARENA_HEIGHT - 200);
    const entity = createShipEntity(this.world, clientId, ps.shipType, spawnX, spawnY);
    ps.shipEntityId = entity.id;
    ps.alive = true;
  }

  private spawnPortal(clientId: string): void {
    const ps = this.players.get(clientId);
    if (!ps || ps.portalEntityId !== null) return;
    const portal = createPortalEntity(this.world, clientId, ps.slot * 90);
    ps.portalEntityId = portal.id;
  }

  private despawnPlayer(clientId: string): void {
    this.despawnShip(clientId);
    this.despawnPortal(clientId);
  }

  private despawnShip(clientId: string): void {
    const ps = this.players.get(clientId);
    if (!ps || ps.shipEntityId === null) return;
    const entity = this.world.entities.get(ps.shipEntityId);
    if (entity) entity.dead = true;
    ps.shipEntityId = null;
    ps.alive = false;
  }

  private despawnPortal(clientId: string): void {
    const ps = this.players.get(clientId);
    if (!ps || ps.portalEntityId === null) return;
    const portal = this.world.entities.get(ps.portalEntityId);
    if (portal) portal.dead = true;
    ps.portalEntityId = null;
  }

  private rebalancePortals(): void {
    const entries = Array.from(this.players.entries()).filter(([, ps]) => ps.portalEntityId !== null);
    const count = entries.length;
    if (count === 0) return;
    for (let i = 0; i < count; i++) {
      const portal = this.world.entities.get(entries[i][1].portalEntityId!);
      if (portal?.portal) {
        portal.portal.orbitDegrees = (i * 360) / count;
      }
    }
  }

  // ---- Tick ----

  private onTick(): void {
    // Handle state transitions
    if (this.state === RoomState.Countdown) {
      this.countdownTicks--;
      if (this.countdownTicks <= 0) {
        this.startGame();
      }
    } else if (this.state === RoomState.GameOver) {
      this.gameOverTicks--;
      if (this.gameOverTicks <= 0) {
        this.endGameOver();
      }
    }

    // Step simulation
    simulationTick(this.world, this.playerInputs);

    // Check for player deaths (during gameplay)
    if (this.state === RoomState.Playing) {
      for (const [clientId, ps] of this.players) {
        if (!ps.alive) continue;
        if (ps.shipEntityId === null) continue;
        const ship = this.world.entities.get(ps.shipEntityId);
        if (!ship || ship.dead) {
          ps.alive = false;
          ps.shipEntityId = null;
          this.connections.broadcast({
            type: 'playerDied',
            playerId: clientId,
            killerId: '', // TODO: track killer from collision
          });
          this.connections.broadcast({
            type: 'gameEvent',
            text: `${this.getUsername(clientId)} was destroyed!`,
          });
          this.checkGameOver();
        }
      }
    }

    // Build player info for sidebar
    const playerInfos: SnapshotPlayerInfo[] = Array.from(this.players.entries()).map(([id, ps]) => {
      const ship = ps.shipEntityId !== null ? this.world.entities.get(ps.shipEntityId) : undefined;
      return {
        playerId: id,
        username: this.getUsername(id),
        slot: ps.slot,
        shipType: ps.shipType,
        alive: ps.alive,
        wins: ps.wins,
        health: ship?.health?.current,
        maxHealth: ship?.health?.max,
      };
    });

    // Broadcast snapshot
    const snapshot: ServerMessage = {
      type: 'snapshot',
      tick: this.world.tick,
      entities: worldToSnapshot(this.world),
      players: playerInfos,
    };
    this.connections.broadcast(snapshot);
  }

  // ---- Helpers ----

  private broadcastGameStart(): void {
    const players = Array.from(this.players.entries()).map(([id, ps]) => ({
      playerId: id,
      username: this.getUsername(id),
      slot: ps.slot,
      team: 0 as const,
      shipType: ps.shipType,
    }));
    this.connections.broadcast({ type: 'gameStart', players });
  }

  private getUsername(clientId: string): string {
    return this.connections.getClient(clientId)?.username ?? `Player${clientId}`;
  }
}
