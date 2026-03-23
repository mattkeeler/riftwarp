import type { ClientMessage, ServerMessage, SnapshotEntity } from '@riftwarp/shared';

export type MessageHandler = (msg: ServerMessage) => void;

export interface Snapshot {
  tick: number;
  entities: SnapshotEntity[];
  receivedAt: number; // performance.now() timestamp
}

/**
 * Manages the WebSocket connection to the game server.
 * Maintains a buffer of the two most recent snapshots for interpolation.
 */
export class WebSocketClient {
  private ws: WebSocket | null = null;
  private handlers: MessageHandler[] = [];
  private _playerId: string | null = null;
  private _connected = false;
  private _destroyed = false;

  /** Two most recent snapshots: [older, newer] */
  private snapshotBuffer: [Snapshot | null, Snapshot | null] = [null, null];

  get playerId(): string | null {
    return this._playerId;
  }

  get connected(): boolean {
    return this._connected;
  }

  /** Get snapshot pair for interpolation */
  getSnapshots(): [Snapshot | null, Snapshot | null] {
    return this.snapshotBuffer;
  }

  connect(url: string): void {
    if (this._destroyed) return;
    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this._connected = true;
      console.log('[ws] connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        this.handleServerMessage(msg);
      } catch {
        console.warn('[ws] invalid message');
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      if (this._destroyed) return;
      console.log('[ws] disconnected, reconnecting...');
      setTimeout(() => this.connect(url), 2000);
    };
  }

  disconnect(): void {
    this._destroyed = true;
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'loginOk':
        this._playerId = msg.playerId;
        break;

      case 'snapshot':
        // Shift buffer: old newer becomes older, new snapshot becomes newer
        this.snapshotBuffer[0] = this.snapshotBuffer[1];
        this.snapshotBuffer[1] = {
          tick: msg.tick,
          entities: msg.entities,
          receivedAt: performance.now(),
        };
        break;
    }

    // Notify all handlers
    for (const handler of this.handlers) {
      handler(msg);
    }
  }
}
