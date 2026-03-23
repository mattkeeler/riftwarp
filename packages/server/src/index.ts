import { WebSocketServer } from 'ws';
import { DEFAULT_PORT } from '@riftwarp/shared';
import type { ClientMessage } from '@riftwarp/shared';
import { ConnectionManager } from './ConnectionManager.js';
import { TableManager } from './TableManager.js';

const port = Number(process.env.PORT) || DEFAULT_PORT;

const wss = new WebSocketServer({ port });
const connections = new ConnectionManager();
const tables = new TableManager(connections);

wss.on('connection', (ws) => {
  const client = connections.addConnection(ws);
  console.log(`[server] client ${client.id} connected (${connections.getClientCount()} total)`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString()) as ClientMessage;

      switch (msg.type) {
        case 'login':
          client.username = msg.username;
          connections.send(client, { type: 'loginOk', playerId: client.id, username: client.username });
          // Send current state
          connections.send(client, {
            type: 'playerList',
            players: connections.getAllClients().map((c) => ({
              playerId: c.id,
              username: c.username,
              inTable: tables.getPlayerTable(c.id),
            })),
          });
          connections.send(client, { type: 'tableList', tables: tables.getTableList() });
          // Notify others
          connections.broadcast({ type: 'playerJoined', username: client.username, playerId: client.id });
          console.log(`[server] ${client.username} logged in`);
          break;

        case 'createTable':
          tables.createTable(client, msg.options);
          break;

        case 'joinTable':
          tables.joinTable(client, msg.tableId, msg.password);
          break;

        case 'leaveTable':
          tables.leaveTable(client);
          break;

        case 'startGame':
          tables.startGame(client);
          break;

        case 'selectShip':
          tables.selectShip(client, msg.shipType);
          break;

        case 'input': {
          const room = tables.getRoom(client.id);
          if (room) room.updateInput(client.id, msg.input, msg.seq);
          break;
        }

        case 'say':
          tables.handleChat(client, msg.text, 'lobby');
          break;

        case 'tableSay':
          tables.handleChat(client, msg.text, 'table');
          break;

        case 'whisper':
          tables.handleWhisper(client, msg.target, msg.text);
          break;

        default:
          break;
      }
    } catch {
      console.warn(`[server] client ${client.id}: invalid message`);
    }
  });

  ws.on('close', () => {
    tables.disconnectPlayer(client.id);
    connections.broadcast({ type: 'playerLeft', playerId: client.id });
    connections.removeConnection(client.id);
    console.log(`[server] client ${client.id} disconnected (${connections.getClientCount()} total)`);
  });
});

console.log(`[server] RiftWarp server listening on port ${port}`);
