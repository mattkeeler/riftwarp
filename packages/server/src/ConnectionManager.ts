import type { WebSocket } from 'ws';
import type { ClientMessage, InputState, ServerMessage } from '@riftwarp/shared';
import { EMPTY_INPUT } from '@riftwarp/shared';

export interface ConnectedClient {
  id: string;
  username: string;
  ws: WebSocket;
  /** Most recent input received from this client */
  currentInput: InputState;
  /** Sequence number of the most recent input */
  lastInputSeq: number;
}

export class ConnectionManager {
  private clients = new Map<string, ConnectedClient>();
  private nextId = 0;

  addConnection(ws: WebSocket): ConnectedClient {
    const id = String(++this.nextId);
    const client: ConnectedClient = {
      id,
      username: `Player${id}`,
      ws,
      currentInput: { ...EMPTY_INPUT },
      lastInputSeq: 0,
    };
    this.clients.set(id, client);
    return client;
  }

  removeConnection(id: string): void {
    this.clients.delete(id);
  }

  getClient(id: string): ConnectedClient | undefined {
    return this.clients.get(id);
  }

  getAllClients(): ConnectedClient[] {
    return Array.from(this.clients.values());
  }

  getClientCount(): number {
    return this.clients.size;
  }

  /** Process a parsed client message, update state accordingly */
  handleMessage(client: ConnectedClient, msg: ClientMessage): void {
    switch (msg.type) {
      case 'login':
        client.username = msg.username;
        this.send(client, { type: 'loginOk', playerId: client.id, username: client.username });
        break;

      case 'input':
        client.currentInput = msg.input;
        client.lastInputSeq = msg.seq;
        break;

      case 'noop':
        break;
    }
  }

  send(client: ConnectedClient, msg: ServerMessage): void {
    if (client.ws.readyState === 1 /* OPEN */) {
      client.ws.send(JSON.stringify(msg));
    }
  }

  broadcast(msg: ServerMessage): void {
    const data = JSON.stringify(msg);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === 1) {
        client.ws.send(data);
      }
    }
  }
}
