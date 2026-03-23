import type { EntityId, PowerupType, RoomState, ShipType, TeamId } from './types.js';

// ---- Input State ----

export interface InputState {
  left: boolean;
  right: boolean;
  thrust: boolean;
  fire: boolean;
  secondaryFire: boolean;
  special: boolean;
}

export const EMPTY_INPUT: Readonly<InputState> = {
  left: false,
  right: false,
  thrust: false,
  fire: false,
  secondaryFire: false,
  special: false,
};

// ---- Client → Server Messages ----

export type ClientMessage =
  | { type: 'login'; username: string }
  | { type: 'input'; seq: number; input: InputState }
  | { type: 'say'; text: string }
  | { type: 'whisper'; target: string; text: string }
  | { type: 'tableSay'; text: string }
  | { type: 'createTable'; options: CreateTableOptions }
  | { type: 'joinTable'; tableId: string; password?: string }
  | { type: 'leaveTable' }
  | { type: 'startGame' }
  | { type: 'changeTeam'; team: TeamId }
  | { type: 'selectShip'; shipType: ShipType }
  | { type: 'noop' };

export interface CreateTableOptions {
  name: string;
  bigTable: boolean; // 4 or 8 slots
  teamMode: boolean;
  ranked: boolean;
  password?: string;
  boardSize: number; // multiplier
  allShipsAllowed: boolean;
  allPowerupsAllowed: boolean;
  balanced: boolean;
}

// ---- Server → Client Messages ----

export type ServerMessage =
  | { type: 'loginOk'; playerId: string; username: string }
  | { type: 'loginFail'; reason: string }
  | { type: 'playerJoined'; username: string; playerId: string }
  | { type: 'playerLeft'; playerId: string }
  | { type: 'playerList'; players: PlayerInfo[] }
  | { type: 'tableCreated'; table: TableInfo }
  | { type: 'tableRemoved'; tableId: string }
  | { type: 'tableList'; tables: TableInfo[] }
  | { type: 'joinedTable'; tableId: string; slot: number }
  | { type: 'leftTable'; playerId: string }
  | { type: 'tableUpdate'; table: TableInfo }
  | { type: 'roomStateChanged'; state: RoomState; countdown?: number }
  | { type: 'gameStart'; players: GamePlayerInfo[] }
  | { type: 'snapshot'; tick: number; entities: SnapshotEntity[]; players?: SnapshotPlayerInfo[] }
  | { type: 'inputAck'; seq: number }
  | { type: 'playerDied'; playerId: string; killerId: string }
  | { type: 'gameOver'; winnerId?: string; winnerTeam?: TeamId }
  | { type: 'gameEvent'; text: string }
  | { type: 'chat'; from: string; text: string; channel: 'lobby' | 'table' }
  | { type: 'whisperFrom'; from: string; text: string }
  | { type: 'error'; message: string };

// ---- Snapshot types ----

export interface SnapshotEntity {
  id: EntityId;
  type: string; // EntityType value
  ownerId: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  health?: number;
  maxHealth?: number;
  shipType?: ShipType;
  powerups?: PowerupType[];
  shieldActive?: boolean;
  empActive?: boolean;
  powerupType?: PowerupType;
  lifespan?: number;
  dead?: boolean;
  portalDamage?: number;
}

// ---- Info types ----

export interface PlayerInfo {
  playerId: string;
  username: string;
  inTable?: string;
}

export interface TableInfo {
  tableId: string;
  name: string;
  state: RoomState;
  slots: TableSlot[];
  options: CreateTableOptions;
}

export interface TableSlot {
  playerId: string | null;
  username: string | null;
  team: TeamId;
  shipType: ShipType;
  ready: boolean;
  wins: number;
}

export interface GamePlayerInfo {
  playerId: string;
  username: string;
  slot: number;
  team: TeamId;
  shipType: ShipType;
}

export interface SnapshotPlayerInfo {
  playerId: string;
  username: string;
  slot: number;
  shipType: ShipType;
  alive: boolean;
  wins: number;
  health?: number;
  maxHealth?: number;
}
