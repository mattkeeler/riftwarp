import { useEffect, useRef, useState } from 'react';
import { Application, Graphics } from 'pixi.js';
import {
  DEFAULT_PORT,
  ARENA_WIDTH,
  ARENA_HEIGHT,
  NUM_STARS,
  EntityType,
  ShipType,
  PowerupType,
  RoomState,
  CLIENT_INPUT_MS,
  getShipPolygon,
  SHIP_COLORS,
  SHIP_DEFINITIONS,
  POWERUP_DEFINITIONS,
} from '@riftwarp/shared';
import type { ClientMessage, ServerMessage, SnapshotEntity, SnapshotPlayerInfo } from '@riftwarp/shared';

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

const DEFAULT_SHIP_VERTS = [15, 0, -10, -8, -6, 0, -10, 8];
const SHIP_TYPE_COUNT = 8;

// Pre-generate star positions
interface Star { x: number; y: number; size: number; layer: number }
function generateStars(): Star[] {
  const stars: Star[] = [];
  for (let i = 0; i < NUM_STARS; i++) {
    stars.push({
      x: Math.random() * ARENA_WIDTH,
      y: Math.random() * ARENA_HEIGHT,
      size: 1 + Math.random() * 2,
      layer: Math.random() < 0.4 ? 0 : 1, // 0 = far (slow), 1 = near (fast)
    });
  }
  return stars;
}

// Player color palette for portals
const PORTAL_COLORS = [0x00ffaa, 0xff4444, 0x44aaff, 0xffaa00, 0xff44ff, 0x00ff44, 0xffff44, 0xaaaaff];

type Screen = 'login' | 'lobby' | 'game';

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('initializing...');
  const [shipName, setShipName] = useState('Tank');
  const [sidebarPlayers, setSidebarPlayers] = useState<SnapshotPlayerInfo[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [inventory, setInventory] = useState<PowerupType[]>([]);
  const [screen, setScreen] = useState<Screen>('login');
  const [username, setUsername] = useState('');
  const [chatMessages, setChatMessages] = useState<Array<{ from: string; text: string; channel: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [tables, setTables] = useState<import('@riftwarp/shared').TableInfo[]>([]);
  const [players, setPlayers] = useState<import('@riftwarp/shared').PlayerInfo[]>([]);
  const [currentTableId, setCurrentTableId] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const playerIdRef = useRef<string | null>(null);

  const wsSend = (msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send(JSON.stringify(msg));
  };

  // ---- Connect to server ----
  const connectToServer = (name: string) => {
    const wsUrl = `ws://${window.location.hostname}:${DEFAULT_PORT}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'login', username: name }));
    };
    ws.onclose = () => setStatus('disconnected');
    ws.onmessage = (event) => {
      try {
        const msg: ServerMessage = JSON.parse(event.data);
        if (msg.type === 'loginOk') { playerIdRef.current = msg.playerId; setStatus('logged in'); }
        if (msg.type === 'playerList') setPlayers(msg.players);
        if (msg.type === 'playerJoined') {
          setPlayers((prev) => [...prev.filter((p) => p.playerId !== msg.playerId), { playerId: msg.playerId, username: msg.username }]);
        }
        if (msg.type === 'playerLeft') {
          setPlayers((prev) => prev.filter((p) => p.playerId !== msg.playerId));
        }
        if (msg.type === 'tableList') setTables(msg.tables);
        if (msg.type === 'tableCreated') setTables((prev) => [...prev, msg.table]);
        if (msg.type === 'tableRemoved') setTables((prev) => prev.filter((t) => t.tableId !== msg.tableId));
        if (msg.type === 'tableUpdate') setTables((prev) => prev.map((t) => t.tableId === msg.table.tableId ? msg.table : t));
        if (msg.type === 'joinedTable') {
          setCurrentTableId(msg.tableId);
          setScreen('game');
        }
        if (msg.type === 'leftTable') {
          setCurrentTableId(null);
          setScreen('lobby');
        }
        if (msg.type === 'chat') {
          setChatMessages((prev) => [...prev.slice(-50), { from: msg.from, text: msg.text, channel: msg.channel }]);
        }
        if (msg.type === 'whisperFrom') {
          setChatMessages((prev) => [...prev.slice(-50), { from: `[whisper] ${msg.from}`, text: msg.text, channel: 'whisper' }]);
        }
        if (msg.type === 'error') {
          setStatus(`Error: ${msg.message}`);
        }
      } catch { /* ignore */ }
    };
  };

  // ---- Game canvas (only when in game) ----
  const gameKey = currentTableId; // remount canvas when table changes
  useEffect(() => {
    if (screen !== 'game') return;
    const container = containerRef.current;
    if (!container) return;
    const ws = wsRef.current;
    if (!ws) return;

    let destroyed = false;
    let cleanupFn: (() => void) | undefined;

    async function start() {
      const app = new Application();
      await app.init({
        background: '#0a0a0a',
        resizeTo: container!,
        antialias: true,
      });
      if (destroyed) { app.destroy(true); return; }
      container!.appendChild(app.canvas);

      // Graphics layers (order matters for z-ordering)
      const starGfx = new Graphics();
      const arenaBorder = new Graphics();
      const portalGfx = new Map<number, Graphics>();
      const entityGfx = new Map<number, Graphics>();
      const pointerGfx = new Graphics();

      app.stage.addChild(starGfx);
      app.stage.addChild(arenaBorder);
      app.stage.addChild(pointerGfx); // on top

      const stars = generateStars();

      // ---- State ----
      let playerId: string | null = playerIdRef.current;
      let entities: SnapshotEntity[] = [];
      let playerInfos: SnapshotPlayerInfo[] = [];
      let currentShipType: ShipType = ShipType.Tank;
      let playerSlotMap = new Map<string, number>();
      let gameEvents: Array<{ text: string; tick: number }> = [];
      let roomState: RoomState = RoomState.Idle;

      // Game-specific message handler
      const gameHandler = (event: MessageEvent) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data);
          if (msg.type === 'loginOk') { playerId = msg.playerId; }
          if (msg.type === 'gameStart') {
            setStatus('Arrows: steer | Up: thrust | Space: fire | 1-8: ship');
            playerSlotMap = new Map(msg.players.map((p) => [p.playerId, p.slot]));
          }
          if (msg.type === 'snapshot') {
            entities = msg.entities;
            if (msg.players) {
              playerInfos = msg.players;
              if (msg.tick % 5 === 0) setSidebarPlayers([...msg.players]);
            }
            if (playerId && msg.tick % 5 === 0) {
              const localShip = msg.entities.find(
                (e) => e.type === EntityType.Ship && e.ownerId === playerId,
              );
              if (localShip?.powerups) {
                setInventory([...localShip.powerups]);
              } else {
                setInventory([]);
              }
            }
          }
          if (msg.type === 'roomStateChanged') {
            roomState = msg.state;
            if (msg.state === RoomState.Countdown) {
              setStatus(`Game starting in ${msg.countdown}s...`);
            } else if (msg.state === RoomState.Playing) {
              setStatus('FIGHT!');
            } else if (msg.state === RoomState.Idle) {
              setStatus('Waiting for players...');
            }
          }
          if (msg.type === 'gameEvent') {
            gameEvents.push({ text: msg.text, tick: Date.now() });
            gameEvents = gameEvents.filter((e) => Date.now() - e.tick < 5000).slice(-5);
            setEvents(gameEvents.map((e) => e.text));
          }
          if (msg.type === 'gameOver') {
            setStatus(msg.winnerId ? 'Game Over!' : 'Draw!');
          }
        } catch { /* ignore */ }
      };
      ws!.addEventListener('message', gameHandler);

      // ---- Input ----
      const keys = new Set<string>();
      const onDown = (e: KeyboardEvent) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
        keys.add(e.key);
        const num = parseInt(e.key);
        if (num >= 1 && num <= SHIP_TYPE_COUNT) {
          const newType = (num - 1) as ShipType;
          if (newType !== currentShipType) {
            currentShipType = newType;
            setShipName(SHIP_DEFINITIONS[newType].name);
            wsSend({ type: 'selectShip', shipType: newType });
          }
        }
      };
      const onUp = (e: KeyboardEvent) => keys.delete(e.key);
      window.addEventListener('keydown', onDown);
      window.addEventListener('keyup', onUp);

      let seq = 0;
      const inputInterval = setInterval(() => {
        seq++;
        wsSend({
          type: 'input', seq,
          input: {
            left: keys.has('ArrowLeft') || keys.has('a'),
            right: keys.has('ArrowRight') || keys.has('d'),
            thrust: keys.has('ArrowUp') || keys.has('w'),
            fire: keys.has(' '),
            secondaryFire: keys.has('Shift'),
            special: keys.has('e'),
          },
        });
      }, CLIENT_INPUT_MS);

      // ---- Render loop ----
      let frameTick = 0;
      app.ticker.add(() => {
        frameTick++;
        const screenW = app.screen.width;
        const screenH = app.screen.height;

        // Find local player for camera
        const localShip = entities.find(
          (e) => e.type === EntityType.Ship && e.ownerId === playerId,
        );
        let camX = screenW / 2 - ARENA_WIDTH / 2;
        let camY = screenH / 2 - ARENA_HEIGHT / 2;
        if (localShip) {
          camX = screenW / 2 - localShip.x;
          camY = screenH / 2 - localShip.y;
        }

        // ---- Draw stars (parallax) ----
        starGfx.clear();
        for (const star of stars) {
          const parallax = star.layer === 0 ? 0.3 : 0.6;
          const sx = star.x + camX * parallax;
          const sy = star.y + camY * parallax;
          // Wrap stars to screen
          const wx = ((sx % screenW) + screenW) % screenW;
          const wy = ((sy % screenH) + screenH) % screenH;
          const brightness = star.layer === 0 ? 0x444444 : 0x888888;
          starGfx.circle(wx, wy, star.size);
          starGfx.fill({ color: brightness });
        }

        // ---- Draw arena border + grid ----
        arenaBorder.clear();
        arenaBorder.rect(camX, camY, ARENA_WIDTH, ARENA_HEIGHT);
        arenaBorder.stroke({ color: 0x333333, width: 2 });
        const gridSize = 65.5;
        for (let i = 1; i < 10; i++) {
          arenaBorder.moveTo(camX + i * gridSize, camY);
          arenaBorder.lineTo(camX + i * gridSize, camY + ARENA_HEIGHT);
          arenaBorder.moveTo(camX, camY + i * gridSize);
          arenaBorder.lineTo(camX + ARENA_WIDTH, camY + i * gridSize);
        }
        arenaBorder.stroke({ color: 0x1a1a1a, width: 1 });

        // ---- Render entities ----
        const usedIds = new Set<number>();
        const offscreenPortals: Array<{ x: number; y: number; color: number; ownerId: string }> = [];

        for (const e of entities) {
          usedIds.add(e.id);

          if (e.type === EntityType.Portal) {
            // ---- Portal rendering ----
            let gfx = portalGfx.get(e.id);
            if (!gfx) {
              gfx = new Graphics();
              app.stage.addChildAt(gfx, app.stage.children.indexOf(pointerGfx));
              portalGfx.set(e.id, gfx);
            }

            const isLocal = e.ownerId === playerId;
            const slot = playerSlotMap.get(e.ownerId) ?? 0;
            const baseColor = PORTAL_COLORS[slot % PORTAL_COLORS.length];

            gfx.clear();

            // Animated concentric rings
            const pulse = Math.sin(frameTick * 0.05) * 0.3 + 0.7;
            for (let ring = 3; ring >= 0; ring--) {
              const radius = 15 + ring * 8;
              const alpha = (0.15 + ring * 0.05) * pulse;
              gfx.circle(0, 0, radius);
              gfx.stroke({ color: baseColor, width: 2, alpha });
            }
            // Center dot
            gfx.circle(0, 0, 4);
            gfx.fill({ color: baseColor, alpha: 0.8 });

            gfx.x = e.x + camX;
            gfx.y = e.y + camY;

            // Track off-screen portals for pointers (enemy only)
            if (!isLocal) {
              const screenX = e.x + camX;
              const screenY = e.y + camY;
              if (screenX < -20 || screenX > screenW + 20 || screenY < -20 || screenY > screenH + 20) {
                offscreenPortals.push({ x: e.x, y: e.y, color: baseColor, ownerId: e.ownerId });
              }
            }
          } else if (e.type === EntityType.Ship) {
            // ---- Ship rendering ----
            let gfx = entityGfx.get(e.id);
            if (!gfx) {
              gfx = new Graphics();
              app.stage.addChildAt(gfx, app.stage.children.indexOf(pointerGfx));
              entityGfx.set(e.id, gfx);
            }

            const isLocal = e.ownerId === playerId;
            const shipType = e.shipType ?? ShipType.Tank;
            const color = isLocal ? (SHIP_COLORS[shipType as ShipType] ?? 0x00ffaa) : 0xff4444;
            const poly = getShipPolygon(shipType as ShipType);
            const verts = poly.length > 0 ? poly : DEFAULT_SHIP_VERTS;

            gfx.clear();
            gfx.poly(verts, true);
            gfx.fill({ color, alpha: 0.3 });
            gfx.stroke({ color, width: 2 });

            // Thrust flame
            if (isLocal && (keys.has('ArrowUp') || keys.has('w'))) {
              const flameLen = 6 + Math.random() * 8;
              gfx.moveTo(-8, -2);
              gfx.lineTo(-8 - flameLen, 0);
              gfx.lineTo(-8, 2);
              gfx.stroke({ color: 0xff8800, width: 2 });
            }

            // Health bar
            if (e.health != null && e.maxHealth != null && e.maxHealth > 0) {
              const barW = 30;
              const pct = e.health / e.maxHealth;
              const barColor = pct > 0.5 ? 0x00ff00 : pct > 0.25 ? 0xffff00 : 0xff0000;
              gfx.rect(-barW / 2, -25, barW, 3);
              gfx.fill({ color: 0x333333 });
              gfx.rect(-barW / 2, -25, barW * pct, 3);
              gfx.fill({ color: barColor });
            }

            gfx.x = e.x + camX;
            gfx.y = e.y + camY;
            gfx.rotation = degToRad(e.angle);

          } else if (e.type === EntityType.Bullet) {
            // ---- Bullet rendering ----
            let gfx = entityGfx.get(e.id);
            if (!gfx) {
              gfx = new Graphics();
              app.stage.addChildAt(gfx, app.stage.children.indexOf(pointerGfx));
              entityGfx.set(e.id, gfx);
            }

            const isLocal = e.ownerId === playerId;
            const bulletColor = isLocal ? 0x88ffcc : 0xff8888;

            gfx.clear();
            // Bullet crosshair
            gfx.circle(0, 0, 3);
            gfx.fill({ color: bulletColor, alpha: 0.9 });
            // Trail line
            gfx.moveTo(0, 0);
            gfx.lineTo(-e.vx * 0.5, -e.vy * 0.5);
            gfx.stroke({ color: bulletColor, width: 1, alpha: 0.5 });

            gfx.x = e.x + camX;
            gfx.y = e.y + camY;

          } else if (e.type === EntityType.Powerup) {
            // ---- Powerup rendering ----
            let gfx = entityGfx.get(e.id);
            if (!gfx) {
              gfx = new Graphics();
              app.stage.addChildAt(gfx, app.stage.children.indexOf(pointerGfx));
              entityGfx.set(e.id, gfx);
            }

            const pDef = e.powerupType !== undefined ? POWERUP_DEFINITIONS[e.powerupType as PowerupType] : null;
            const pColor = pDef?.color ?? 0xffffff;

            gfx.clear();
            // Pulsing diamond shape
            const pulse = 0.8 + Math.sin(frameTick * 0.1 + e.id) * 0.2;
            const sz = 8 * pulse;
            gfx.moveTo(0, -sz);
            gfx.lineTo(sz, 0);
            gfx.lineTo(0, sz);
            gfx.lineTo(-sz, 0);
            gfx.lineTo(0, -sz);
            gfx.fill({ color: pColor, alpha: 0.4 });
            gfx.stroke({ color: pColor, width: 2 });
            // Inner dot
            gfx.circle(0, 0, 2);
            gfx.fill({ color: pColor, alpha: 0.9 });

            gfx.x = e.x + camX;
            gfx.y = e.y + camY;

          } else if (e.type !== EntityType.Portal && e.type !== EntityType.Explosion
            && e.type !== EntityType.Ship && e.type !== EntityType.Bullet && e.type !== EntityType.Powerup) {
            // ---- Generic enemy rendering ----
            let gfx = entityGfx.get(e.id);
            if (!gfx) {
              gfx = new Graphics();
              app.stage.addChildAt(gfx, app.stage.children.indexOf(pointerGfx));
              entityGfx.set(e.id, gfx);
            }

            gfx.clear();
            // Draw as a colored circle/triangle based on type
            const enemyColor = 0xff4444;
            const sz = 6;
            // Triangle pointing in movement direction
            gfx.poly([sz, 0, -sz, -sz * 0.7, -sz, sz * 0.7], true);
            gfx.fill({ color: enemyColor, alpha: 0.4 });
            gfx.stroke({ color: enemyColor, width: 1.5 });

            // Health indicator (small dot that fades)
            if (e.health != null && e.maxHealth != null && e.maxHealth > 0) {
              const pct = e.health / e.maxHealth;
              gfx.circle(0, -sz - 4, 2);
              gfx.fill({ color: pct > 0.5 ? 0x00ff00 : 0xff0000 });
            }

            gfx.x = e.x + camX;
            gfx.y = e.y + camY;
            gfx.rotation = degToRad(e.angle);

          } else if (e.type === EntityType.Explosion) {
            // ---- Explosion rendering ----
            let gfx = entityGfx.get(e.id);
            if (!gfx) {
              gfx = new Graphics();
              app.stage.addChildAt(gfx, app.stage.children.indexOf(pointerGfx));
              entityGfx.set(e.id, gfx);
            }

            gfx.clear();
            const maxLife = 20;
            const life = e.lifespan ?? maxLife;
            const progress = 1 - life / maxLife; // 0 → 1
            const radius = 5 + progress * 30;
            const alpha = 1 - progress;

            // Expanding rings
            gfx.circle(0, 0, radius);
            gfx.stroke({ color: 0xff4400, width: 3, alpha });
            gfx.circle(0, 0, radius * 0.6);
            gfx.stroke({ color: 0xffaa00, width: 2, alpha: alpha * 0.7 });
            gfx.circle(0, 0, radius * 0.3);
            gfx.fill({ color: 0xffffff, alpha: alpha * 0.5 });

            gfx.x = e.x + camX;
            gfx.y = e.y + camY;
          }
        }

        // ---- Off-screen portal pointers ----
        pointerGfx.clear();
        if (localShip) {
          for (const portal of offscreenPortals) {
            const dx = portal.x - localShip.x;
            const dy = portal.y - localShip.y;
            const angle = Math.atan2(dy, dx);
            const margin = 40;
            // Place arrow at screen edge
            const px = Math.max(margin, Math.min(screenW - margin, screenW / 2 + Math.cos(angle) * (screenW / 2 - margin)));
            const py = Math.max(margin, Math.min(screenH - margin, screenH / 2 + Math.sin(angle) * (screenH / 2 - margin)));

            // Draw arrow
            const arrowSize = 8;
            pointerGfx.moveTo(
              px + Math.cos(angle) * arrowSize,
              py + Math.sin(angle) * arrowSize,
            );
            pointerGfx.lineTo(
              px + Math.cos(angle + 2.5) * arrowSize,
              py + Math.sin(angle + 2.5) * arrowSize,
            );
            pointerGfx.lineTo(
              px + Math.cos(angle - 2.5) * arrowSize,
              py + Math.sin(angle - 2.5) * arrowSize,
            );
            pointerGfx.lineTo(
              px + Math.cos(angle) * arrowSize,
              py + Math.sin(angle) * arrowSize,
            );
            pointerGfx.fill({ color: portal.color, alpha: 0.7 });
          }
        }

        // ---- Cleanup dead graphics ----
        for (const [id, gfx] of entityGfx) {
          if (!usedIds.has(id)) { gfx.destroy(); entityGfx.delete(id); }
        }
        for (const [id, gfx] of portalGfx) {
          if (!usedIds.has(id)) { gfx.destroy(); portalGfx.delete(id); }
        }
      });

      cleanupFn = () => {
        clearInterval(inputInterval);
        window.removeEventListener('keydown', onDown);
        window.removeEventListener('keyup', onUp);
        ws!.removeEventListener('message', gameHandler);
        app.destroy(true);
      };
    }

    start().catch((err) => {
      console.error('[app] init error:', err);
      setStatus('error: ' + String(err));
    });

    return () => {
      destroyed = true;
      cleanupFn?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen, gameKey]);

  // ---- Login Screen ----
  if (screen === 'login') {
    return (
      <div style={{
        width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: '#0a0a0a', fontFamily: "'Courier New', monospace",
      }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '48px', fontWeight: 'bold', color: '#00ffaa', letterSpacing: '0.3em', marginBottom: 40 }}>
            RIFTWARP
          </div>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (username.trim()) {
              connectToServer(username.trim());
              setScreen('lobby');
            }
          }}>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your name..."
              maxLength={16}
              autoFocus
              style={{
                background: 'transparent', border: '1px solid #00ffaa', color: '#00ffaa',
                padding: '12px 20px', fontSize: '18px', fontFamily: 'inherit',
                outline: 'none', textAlign: 'center', width: 280,
              }}
            />
            <br />
            <button
              type="submit"
              style={{
                background: 'transparent', border: '1px solid #00ffaa', color: '#00ffaa',
                padding: '10px 40px', fontSize: '16px', fontFamily: 'inherit',
                cursor: 'pointer', marginTop: 16, letterSpacing: '0.1em',
              }}
            >
              CONNECT
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---- Lobby Screen ----
  if (screen === 'lobby') {
    return (
      <div style={{
        width: '100%', height: '100%', background: '#0a0a0a',
        fontFamily: "'Courier New', monospace", color: '#ccc', padding: 20,
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#00ffaa', letterSpacing: '0.2em' }}>
            RIFTWARP
          </div>
          <div style={{ color: '#666' }}>
            Logged in as <span style={{ color: '#00ffaa' }}>{username}</span>
          </div>
        </div>

        <div style={{ display: 'flex', flex: 1, gap: 20 }}>
          {/* Tables */}
          <div style={{ flex: 2 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ color: '#888', fontSize: 14 }}>TABLES</div>
              <button
                onClick={() => {
                  wsSend({
                    type: 'createTable',
                    options: {
                      name: `${username}'s game`,
                      bigTable: false,
                      teamMode: false,
                      ranked: false,
                      boardSize: 1,
                      allShipsAllowed: true,
                      allPowerupsAllowed: true,
                      balanced: false,
                    },
                  });
                }}
                style={{
                  background: 'transparent', border: '1px solid #00ffaa', color: '#00ffaa',
                  padding: '6px 16px', fontSize: '12px', fontFamily: 'inherit', cursor: 'pointer',
                }}
              >
                + NEW TABLE
              </button>
            </div>
            {tables.length === 0 && (
              <div style={{ color: '#555', padding: 20, textAlign: 'center' }}>
                No tables. Create one to start playing.
              </div>
            )}
            {tables.map((t) => {
              const playerCount = t.slots.filter((s) => s.playerId !== null).length;
              return (
                <div
                  key={t.tableId}
                  onClick={() => wsSend({ type: 'joinTable', tableId: t.tableId })}
                  style={{
                    padding: '10px 14px', marginBottom: 6, cursor: 'pointer',
                    border: '1px solid #333', background: '#111',
                  }}
                >
                  <div style={{ color: '#00ffaa' }}>{t.name}</div>
                  <div style={{ color: '#666', fontSize: 12 }}>
                    {playerCount}/{t.slots.length} players
                  </div>
                </div>
              );
            })}
          </div>

          {/* Players & Chat */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ color: '#888', fontSize: 14, marginBottom: 6 }}>ONLINE ({players.length})</div>
              {players.map((p) => (
                <div key={p.playerId} style={{ color: p.inTable ? '#555' : '#aaa', fontSize: 12, marginBottom: 2 }}>
                  {p.username} {p.inTable && <span style={{ color: '#444' }}>(in game)</span>}
                </div>
              ))}
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div style={{ color: '#888', fontSize: 14, marginBottom: 6 }}>CHAT</div>
              <div style={{ flex: 1, overflow: 'auto', fontSize: 11, color: '#888', background: '#0d0d0d', padding: 6 }}>
                {chatMessages.filter((m) => m.channel === 'lobby' || m.channel === 'whisper').map((m, i) => (
                  <div key={i}>
                    <span style={{ color: m.channel === 'whisper' ? '#ff88ff' : '#00ffaa' }}>{m.from}:</span> {m.text}
                  </div>
                ))}
              </div>
              <form onSubmit={(e) => {
                e.preventDefault();
                if (chatInput.trim()) {
                  wsSend({ type: 'say', text: chatInput.trim() });
                  setChatInput('');
                }
              }}>
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Type to chat..."
                  style={{
                    width: '100%', background: '#111', border: '1px solid #333', color: '#ccc',
                    padding: '6px 8px', fontSize: 12, fontFamily: 'inherit', outline: 'none',
                  }}
                />
              </form>
            </div>
          </div>
        </div>
        {status !== 'logged in' && <div style={{ color: '#666', marginTop: 10 }}>{status}</div>}
      </div>
    );
  }

  // ---- Game Screen ----
  const localPlayer = sidebarPlayers.find((p) => p.playerId === playerIdRef.current);
  const localHpPct = localPlayer ? (localPlayer.health ?? 0) / (localPlayer.maxHealth ?? 1) : 1;

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Top-left HUD */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          color: '#00ffaa',
          fontFamily: "'Courier New', monospace",
          fontSize: '13px',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <div style={{ fontSize: '18px', fontWeight: 'bold', letterSpacing: '0.2em', display: 'flex', alignItems: 'center', gap: 10 }}>
          RIFTWARP
          <button
            onClick={() => { wsSend({ type: 'leaveTable' }); }}
            style={{
              background: 'transparent', border: '1px solid #555', color: '#555',
              padding: '2px 8px', fontSize: '9px', fontFamily: 'inherit',
              cursor: 'pointer', pointerEvents: 'auto',
            }}
          >
            LEAVE
          </button>
        </div>

        {/* Ship + Health */}
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ color: '#888' }}>Ship:</span>
          <span style={{ color: '#00ffaa', fontWeight: 'bold' }}>{shipName}</span>
          {localPlayer && (
            <span style={{ color: '#666', fontSize: 11 }}>
              W:{localPlayer.wins}
            </span>
          )}
        </div>

        {/* Local player health bar */}
        {localPlayer && localPlayer.alive && (
          <div style={{ marginTop: 4, width: 140 }}>
            <div style={{ height: 6, background: '#222', position: 'relative', border: '1px solid #333' }}>
              <div style={{
                height: '100%',
                width: `${localHpPct * 100}%`,
                background: localHpPct > 0.5 ? '#00ff00' : localHpPct > 0.25 ? '#ffff00' : '#ff0000',
                transition: 'width 0.1s',
              }} />
            </div>
            <div style={{ fontSize: 10, color: '#666', marginTop: 1 }}>
              {localPlayer.health ?? 0}/{localPlayer.maxHealth ?? 0} HP
            </div>
          </div>
        )}

        {/* Powerup inventory */}
        {inventory.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div style={{ color: '#555', fontSize: 10, marginBottom: 3 }}>INVENTORY (Shift to fire)</div>
            <div style={{ display: 'flex', gap: 3 }}>
              {inventory.map((pType, i) => {
                const pDef = POWERUP_DEFINITIONS[pType];
                const colorHex = '#' + pDef.color.toString(16).padStart(6, '0');
                return (
                  <div
                    key={i}
                    title={pDef.name}
                    style={{
                      width: 26, height: 26,
                      border: `1px solid ${colorHex}`,
                      background: `${colorHex}22`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 8, color: colorHex, fontWeight: 'bold',
                    }}
                  >
                    {pDef.name.slice(0, 3).toUpperCase()}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Status message */}
        {status && status !== 'logged in' && (
          <div style={{ color: '#ffaa00', marginTop: 8, fontSize: 12, textShadow: '0 0 6px rgba(255,170,0,0.3)' }}>
            {status}
          </div>
        )}
      </div>

      {/* Player sidebar (top-right) */}
      {sidebarPlayers.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 10,
            right: 10,
            fontFamily: "'Courier New', monospace",
            fontSize: '11px',
            pointerEvents: 'none',
            userSelect: 'none',
            minWidth: 150,
          }}
        >
          {sidebarPlayers.map((p) => {
            const color = PORTAL_COLORS[p.slot % PORTAL_COLORS.length];
            const colorHex = '#' + color.toString(16).padStart(6, '0');
            const hpPct = (p.health ?? 0) / (p.maxHealth ?? 1);
            const isLocal = p.playerId === playerIdRef.current;
            return (
              <div
                key={p.playerId}
                style={{
                  marginBottom: 4,
                  padding: '3px 8px',
                  background: isLocal ? 'rgba(0,255,170,0.08)' : 'rgba(0,0,0,0.6)',
                  borderLeft: `3px solid ${colorHex}`,
                  opacity: p.alive ? 1 : 0.35,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ color: colorHex, fontWeight: isLocal ? 'bold' : 'normal' }}>
                    {isLocal ? `> ${p.username}` : p.username}
                  </span>
                  <span style={{ color: '#555', fontSize: 10 }}>
                    {SHIP_DEFINITIONS[p.shipType]?.name ?? '?'}
                    {p.wins > 0 && <span style={{ color: '#ffaa00', marginLeft: 4 }}>W:{p.wins}</span>}
                  </span>
                </div>
                {p.alive && p.maxHealth != null && (
                  <div style={{ marginTop: 2, height: 2, background: '#222' }}>
                    <div style={{
                      height: '100%',
                      width: `${hpPct * 100}%`,
                      background: hpPct > 0.5 ? '#0a0' : hpPct > 0.25 ? '#aa0' : '#a00',
                    }} />
                  </div>
                )}
                {!p.alive && <div style={{ color: '#a33', fontSize: 9, marginTop: 1 }}>DESTROYED</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* Game events (bottom-center) */}
      {events.length > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 50,
            left: '50%',
            transform: 'translateX(-50%)',
            fontFamily: "'Courier New', monospace",
            fontSize: '13px',
            textAlign: 'center',
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          {events.map((text, i) => (
            <div key={i} style={{ color: '#ffaa00', marginBottom: 3, textShadow: '0 0 8px rgba(255,170,0,0.4)' }}>
              {text}
            </div>
          ))}
        </div>
      )}

      {/* Controls bar (bottom) */}
      <div
        style={{
          position: 'absolute',
          bottom: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          fontFamily: "'Courier New', monospace",
          fontSize: '10px',
          color: '#444',
          pointerEvents: 'none',
          userSelect: 'none',
          display: 'flex',
          gap: 12,
        }}
      >
        <span>Arrows: steer</span>
        <span>Up: thrust</span>
        <span>Space: fire</span>
        <span>Shift: powerup</span>
        <span>E: special</span>
        <span>1-8: ship</span>
      </div>
    </div>
  );
}
