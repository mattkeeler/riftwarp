import {
  ShipType,
  RoomState,
  type TableInfo,
  type TableSlot,
  type CreateTableOptions,
  type ServerMessage,
} from '@riftwarp/shared';
import type { ConnectedClient, ConnectionManager } from './ConnectionManager.js';
import { GameRoom } from './GameRoom.js';

interface Table {
  id: string;
  name: string;
  options: CreateTableOptions;
  slots: TableSlot[];
  room: GameRoom;
  playerSlotMap: Map<string, number>; // playerId → slot index
}

export class TableManager {
  private tables = new Map<string, Table>();
  private playerTable = new Map<string, string>(); // playerId → tableId
  private nextTableId = 0;

  constructor(private connections: ConnectionManager) {}

  createTable(client: ConnectedClient, options: CreateTableOptions): string {
    const tableId = `t${++this.nextTableId}`;
    const slotCount = options.bigTable ? 8 : 4;
    const slots: TableSlot[] = Array.from({ length: slotCount }, () => ({
      playerId: null,
      username: null,
      team: 0,
      shipType: ShipType.Tank,
      ready: false,
      wins: 0,
    }));

    const room = new GameRoom(this.connections);
    room.start();

    const table: Table = {
      id: tableId,
      name: options.name || `${client.username}'s game`,
      options,
      slots,
      room,
      playerSlotMap: new Map(),
    };
    this.tables.set(tableId, table);

    // Broadcast table creation to all lobby clients
    this.broadcastToLobby({ type: 'tableCreated', table: this.tableToInfo(table) });

    // Auto-join the creator
    this.joinTable(client, tableId);

    // Auto-fill with bots
    room.fillWithBots(3);

    return tableId;
  }

  joinTable(client: ConnectedClient, tableId: string, _password?: string): boolean {
    const table = this.tables.get(tableId);
    if (!table) {
      this.connections.send(client, { type: 'error', message: 'Table not found' });
      return false;
    }

    // Leave current table first
    if (this.playerTable.has(client.id)) {
      this.leaveTable(client);
    }

    // Find empty slot
    const slotIdx = table.slots.findIndex((s) => s.playerId === null);
    if (slotIdx === -1) {
      this.connections.send(client, { type: 'error', message: 'Table is full' });
      return false;
    }

    // Fill the slot
    table.slots[slotIdx].playerId = client.id;
    table.slots[slotIdx].username = client.username;
    table.slots[slotIdx].shipType = ShipType.Tank;
    table.playerSlotMap.set(client.id, slotIdx);
    this.playerTable.set(client.id, tableId);

    // Add to game room
    table.room.addPlayer(client, table.slots[slotIdx].shipType);

    // Notify the joining player
    this.connections.send(client, { type: 'joinedTable', tableId, slot: slotIdx });

    // Broadcast updated table info to everyone
    this.broadcastToLobby({ type: 'tableUpdate', table: this.tableToInfo(table) });

    return true;
  }

  leaveTable(client: ConnectedClient): void {
    const tableId = this.playerTable.get(client.id);
    if (!tableId) return;
    const table = this.tables.get(tableId);
    if (!table) return;

    // Clear the slot
    const slotIdx = table.playerSlotMap.get(client.id);
    if (slotIdx !== undefined) {
      table.slots[slotIdx].playerId = null;
      table.slots[slotIdx].username = null;
      table.slots[slotIdx].ready = false;
    }
    table.playerSlotMap.delete(client.id);
    this.playerTable.delete(client.id);

    // Remove from game room
    table.room.removePlayer(client.id);

    // Notify
    this.connections.send(client, { type: 'leftTable', playerId: client.id });

    // Remove empty tables
    const hasPlayers = table.slots.some((s) => s.playerId !== null);
    if (!hasPlayers) {
      table.room.stop();
      this.tables.delete(tableId);
      this.broadcastToLobby({ type: 'tableRemoved', tableId });
    } else {
      this.broadcastToLobby({ type: 'tableUpdate', table: this.tableToInfo(table) });
    }
  }

  selectShip(client: ConnectedClient, shipType: ShipType): void {
    const tableId = this.playerTable.get(client.id);
    if (!tableId) return;
    const table = this.tables.get(tableId);
    if (!table) return;

    const slotIdx = table.playerSlotMap.get(client.id);
    if (slotIdx !== undefined) {
      table.slots[slotIdx].shipType = shipType;
    }

    table.room.changeShip(client.id, shipType);
    this.broadcastToLobby({ type: 'tableUpdate', table: this.tableToInfo(table) });
  }

  startGame(client: ConnectedClient): void {
    const tableId = this.playerTable.get(client.id);
    if (!tableId) return;
    const table = this.tables.get(tableId);
    if (!table) return;
    // GameRoom handles the countdown/start logic internally
    // For now, any player at the table can trigger start
    table.room.requestStart();
  }

  handleChat(client: ConnectedClient, text: string, channel: 'lobby' | 'table'): void {
    if (channel === 'table') {
      const tableId = this.playerTable.get(client.id);
      if (!tableId) return;
      const table = this.tables.get(tableId);
      if (!table) return;
      // Send to all players at the table
      for (const [pid] of table.playerSlotMap) {
        const c = this.connections.getClient(pid);
        if (c) this.connections.send(c, { type: 'chat', from: client.username, text, channel: 'table' });
      }
    } else {
      // Lobby chat: broadcast to everyone
      this.connections.broadcast({ type: 'chat', from: client.username, text, channel: 'lobby' });
    }
  }

  handleWhisper(client: ConnectedClient, target: string, text: string): void {
    // Find target by username
    for (const c of this.connections.getAllClients()) {
      if (c.username === target) {
        this.connections.send(c, { type: 'whisperFrom', from: client.username, text });
        return;
      }
    }
    this.connections.send(client, { type: 'error', message: `Player "${target}" not found` });
  }

  getPlayerTable(playerId: string): string | undefined {
    return this.playerTable.get(playerId);
  }

  getRoom(playerId: string): GameRoom | undefined {
    const tableId = this.playerTable.get(playerId);
    if (!tableId) return undefined;
    return this.tables.get(tableId)?.room;
  }

  getTableList(): TableInfo[] {
    return Array.from(this.tables.values()).map((t) => this.tableToInfo(t));
  }

  disconnectPlayer(clientId: string): void {
    const client = this.connections.getClient(clientId);
    if (client) this.leaveTable(client);
    this.playerTable.delete(clientId);
  }

  private tableToInfo(table: Table): TableInfo {
    return {
      tableId: table.id,
      name: table.name,
      state: RoomState.Idle, // TODO: expose room state
      slots: [...table.slots],
      options: table.options,
    };
  }

  private broadcastToLobby(msg: ServerMessage): void {
    // Send to all connected clients (they filter based on their screen)
    this.connections.broadcast(msg);
  }
}
