import {
  ARENA_WIDTH,
  ARENA_HEIGHT,
  SERVER_TICK_MS,
  COUNTDOWN_SECONDS,
  MIN_PLAYERS_TO_START,
  ShipType,
  RoomState,
  EntityType,
  type Entity,
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
import { BotController } from './BotController.js';

interface PlayerState {
  shipType: ShipType;
  shipEntityId: number | null;
  alive: boolean;
  wins: number;
  slot: number;
  isBot: boolean;
}

const BOT_NAMES = ['Ziggy', 'Nova', 'Blitz', 'Havoc', 'Shade', 'Volt', 'Drift', 'Spark'];
const BOT_SHIPS = [ShipType.Squid, ShipType.Tank, ShipType.Hunter, ShipType.Rabbit, ShipType.Flash, ShipType.Turtle];

const PORTAL_SPAWN_DELAY = 30;

export class GameRoom {
  private worlds = new Map<string, WorldState>();
  private ticker: Ticker;
  private playerInputs: PlayerInputs = new Map();
  private players = new Map<string, PlayerState>();
  private bots = new Map<string, BotController>();
  private state: RoomState = RoomState.Idle;
  private countdownTicks = 0;
  private gameOverTicks = 0;
  private nextSlot = 0;
  private nextBotId = 0;

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

  addBot(difficulty: 'easy' | 'medium' | 'hard' = 'medium'): string {
    const botId = `bot_${++this.nextBotId}`;
    const botName = BOT_NAMES[this.nextBotId % BOT_NAMES.length];
    const shipType = BOT_SHIPS[Math.floor(Math.random() * BOT_SHIPS.length)];
    const slot = this.nextSlot++;

    const ps: PlayerState = {
      shipType,
      shipEntityId: null,
      alive: false,
      wins: 0,
      slot,
      isBot: true,
    };
    this.players.set(botId, ps);

    const bot = new BotController(botId, difficulty);
    this.bots.set(botId, bot);

    this.spawnPlayer(botId);
    this.rebalancePortals();
    this.broadcastGameStart();

    console.log(`[room] bot ${botName} (${botId}) added as ${ShipType[shipType]}`);
    return botId;
  }

  removeBot(botId: string): void {
    this.removePlayer(botId);
    this.bots.delete(botId);
  }

  fillWithBots(targetCount: number = 3): void {
    const humanCount = Array.from(this.players.values()).filter((p) => !p.isBot).length;
    const needed = Math.max(0, targetCount - this.players.size);
    for (let i = 0; i < needed; i++) {
      this.addBot(i < 1 ? 'easy' : 'medium');
    }
    if (needed > 0) console.log(`[room] filled with ${needed} bots (${humanCount} humans)`);
  }

  addPlayer(client: ConnectedClient, shipType: ShipType = ShipType.Tank): void {
    const slot = this.nextSlot++;
    const ps: PlayerState = {
      shipType,
      shipEntityId: null,
      alive: false,
      wins: 0,
      slot,
      isBot: false,
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

    const world = this.worlds.get(clientId);
    if (!world) return;

    // Respawn with new ship
    if (ps.shipEntityId !== null) {
      const oldEntity = world.entities.get(ps.shipEntityId);
      const pos = oldEntity ? { x: oldEntity.position.x, y: oldEntity.position.y, angle: oldEntity.rotation.angle } : null;
      this.despawnShip(clientId);
      this.spawnShip(clientId);
      if (pos && ps.shipEntityId !== null) {
        const newEntity = world.entities.get(ps.shipEntityId);
        if (newEntity) {
          newEntity.position.x = pos.x;
          newEntity.position.y = pos.y;
          newEntity.rotation.angle = pos.angle;
        }
      }
    }
  }

  removePlayer(clientId: string): void {
    // Remove this player's portal from all other worlds
    for (const [otherId, otherWorld] of this.worlds) {
      if (otherId === clientId) continue;
      for (const entity of otherWorld.entities.values()) {
        if (entity.type === EntityType.Portal && entity.portal?.playerId === clientId) {
          entity.dead = true;
        }
      }
    }

    // Delete this player's world
    this.worlds.delete(clientId);
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

    // Reset worlds and respawn all players
    this.worlds.clear();
    for (const [clientId, ps] of this.players) {
      ps.shipEntityId = null;
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
    this.worlds.clear();
    for (const [clientId, ps] of this.players) {
      ps.shipEntityId = null;
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
    const ps = this.players.get(clientId);
    if (!ps) return;

    // Create a new world for this player
    const world = createWorldState(clientId);
    this.worlds.set(clientId, world);

    // Spawn their ship in their world
    const spawnX = 100 + Math.random() * (ARENA_WIDTH - 200);
    const spawnY = 100 + Math.random() * (ARENA_HEIGHT - 200);
    const entity = createShipEntity(world, clientId, ps.shipType, spawnX, spawnY);
    ps.shipEntityId = entity.id;
    ps.alive = true;

    // Add one portal per existing opponent into this player's world
    for (const [otherId, otherPs] of this.players) {
      if (otherId === clientId) continue;
      createPortalEntity(world, otherId, otherPs.slot * 90);
    }

    // Add THIS player's portal into every OTHER player's world
    for (const [otherId, otherWorld] of this.worlds) {
      if (otherId === clientId) continue;
      createPortalEntity(otherWorld, clientId, ps.slot * 90);
    }
  }

  private spawnShip(clientId: string): void {
    const ps = this.players.get(clientId);
    if (!ps) return;
    const world = this.worlds.get(clientId);
    if (!world) return;
    const spawnX = 100 + Math.random() * (ARENA_WIDTH - 200);
    const spawnY = 100 + Math.random() * (ARENA_HEIGHT - 200);
    const entity = createShipEntity(world, clientId, ps.shipType, spawnX, spawnY);
    ps.shipEntityId = entity.id;
    ps.alive = true;
  }

  private despawnShip(clientId: string): void {
    const ps = this.players.get(clientId);
    if (!ps || ps.shipEntityId === null) return;
    const world = this.worlds.get(clientId);
    if (!world) return;
    const entity = world.entities.get(ps.shipEntityId);
    if (entity) entity.dead = true;
    ps.shipEntityId = null;
    ps.alive = false;
  }

  private rebalancePortals(): void {
    // For each world, rebalance the portals within it
    for (const [_ownerId, world] of this.worlds) {
      const portalEntries: Entity[] = [];
      for (const entity of world.entities.values()) {
        if (entity.type === EntityType.Portal && !entity.dead) {
          portalEntries.push(entity);
        }
      }
      const count = portalEntries.length;
      if (count === 0) continue;
      for (let i = 0; i < count; i++) {
        const portal = portalEntries[i];
        if (portal.portal) {
          portal.portal.orbitDegrees = (i * 360) / count;
        }
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

    // 1. Bot inputs
    for (const [botId, bot] of this.bots) {
      const ps = this.players.get(botId);
      if (ps && ps.alive) {
        const botWorld = this.worlds.get(botId);
        if (botWorld) {
          this.playerInputs.set(botId, bot.generateInput(botWorld));
        }
      }
    }

    // 2. Tick each world
    for (const [playerId, world] of this.worlds) {
      const singleInput: PlayerInputs = new Map();
      const input = this.playerInputs.get(playerId);
      if (input) singleInput.set(playerId, input);
      simulationTick(world, singleInput);
    }

    // 3. Route cross-world events
    for (const [_playerId, world] of this.worlds) {
      for (const event of world.crossWorldEvents) {
        if (event.type === 'spawnEnemies') {
          const targetWorld = this.worlds.get(event.targetPlayerId);
          if (targetWorld) {
            targetWorld.pendingSpawns.push({
              powerupType: event.powerupType,
              spawnAtTick: targetWorld.tick + PORTAL_SPAWN_DELAY,
              senderOwnerId: event.senderPlayerId,
            });
          }
        }
      }
      world.crossWorldEvents = [];
    }

    // 4. Check for player deaths (during gameplay)
    if (this.state === RoomState.Playing) {
      for (const [clientId, ps] of this.players) {
        if (!ps.alive) continue;
        if (ps.shipEntityId === null) continue;
        const world = this.worlds.get(clientId);
        if (!world) continue;
        const ship = world.entities.get(ps.shipEntityId);
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

    // 5. Per-player snapshots
    const playerInfos = this.buildPlayerInfos();
    for (const [clientId, ps] of this.players) {
      if (ps.isBot) continue;
      const client = this.connections.getClient(clientId);
      if (!client) continue;
      const world = this.worlds.get(clientId);
      if (!world) continue;
      const entities = worldToSnapshot(world);
      this.connections.send(client, {
        type: 'snapshot',
        tick: world.tick,
        entities,
        players: playerInfos,
      });
    }
  }

  // ---- Helpers ----

  private buildPlayerInfos(): SnapshotPlayerInfo[] {
    return Array.from(this.players.entries()).map(([id, ps]) => {
      const world = this.worlds.get(id);
      const ship = (ps.shipEntityId !== null && world) ? world.entities.get(ps.shipEntityId) : undefined;
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
  }

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
    if (clientId.startsWith('bot_')) {
      const num = parseInt(clientId.split('_')[1]);
      return BOT_NAMES[num % BOT_NAMES.length] ?? clientId;
    }
    return this.connections.getClient(clientId)?.username ?? `Player${clientId}`;
  }
}
