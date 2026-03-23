import { WebSocketServer } from 'ws';
import { DEFAULT_PORT } from '@riftwarp/shared';
import type { ClientMessage } from '@riftwarp/shared';
import { ConnectionManager } from './ConnectionManager.js';
import { GameRoom } from './GameRoom.js';

const port = Number(process.env.PORT) || DEFAULT_PORT;

const wss = new WebSocketServer({ port });
const connections = new ConnectionManager();
const room = new GameRoom(connections);

room.start();

wss.on('connection', (ws) => {
  const client = connections.addConnection(ws);
  console.log(`[server] client ${client.id} connected (${connections.getClientCount()} total)`);

  // Auto-login and join room for now (lobby comes in Phase 10)
  client.username = `Player${client.id}`;
  connections.send(client, { type: 'loginOk', playerId: client.id, username: client.username });
  room.addPlayer(client);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as ClientMessage;

      switch (msg.type) {
        case 'input':
          room.updateInput(client.id, msg.input, msg.seq);
          break;
        case 'selectShip':
          room.changeShip(client.id, msg.shipType);
          break;
        case 'login':
          client.username = msg.username;
          break;
        default:
          connections.handleMessage(client, msg);
      }
    } catch {
      console.warn(`[server] client ${client.id}: invalid message`);
    }
  });

  ws.on('close', () => {
    room.removePlayer(client.id);
    connections.removeConnection(client.id);
    console.log(`[server] client ${client.id} disconnected (${connections.getClientCount()} total)`);
  });
});

console.log(`[server] RiftWarp server listening on port ${port}`);
