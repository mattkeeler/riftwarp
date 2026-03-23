import { useEffect, useRef, useState } from 'react';
import { Application, Graphics } from 'pixi.js';
import {
  DEFAULT_PORT,
  ARENA_WIDTH,
  ARENA_HEIGHT,
  NUM_STARS,
  EntityType,
  ShipType,
  CLIENT_INPUT_MS,
  getShipPolygon,
  SHIP_COLORS,
  SHIP_DEFINITIONS,
} from '@riftwarp/shared';
import type { ClientMessage, ServerMessage, SnapshotEntity } from '@riftwarp/shared';

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

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('initializing...');
  const [shipName, setShipName] = useState('Tank');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

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
      // portals and entities added dynamically
      app.stage.addChild(pointerGfx); // on top

      const stars = generateStars();

      // ---- State ----
      let playerId: string | null = null;
      let entities: SnapshotEntity[] = [];
      let currentShipType: ShipType = ShipType.Tank;
      let playerSlotMap = new Map<string, number>(); // ownerId -> slot index for color

      // ---- WebSocket ----
      const wsUrl = `ws://${window.location.hostname}:${DEFAULT_PORT}`;
      const ws = new WebSocket(wsUrl);

      function wsSend(msg: ClientMessage) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
      }

      ws.onopen = () => setStatus('connected');
      ws.onclose = () => { if (!destroyed) setStatus('disconnected'); };
      ws.onmessage = (event) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data);
          if (msg.type === 'loginOk') playerId = msg.playerId;
          if (msg.type === 'gameStart') {
            setStatus('Arrows: steer | Up: thrust | 1-8: ship');
            playerSlotMap = new Map(msg.players.map((p) => [p.playerId, p.slot]));
          }
          if (msg.type === 'snapshot') entities = msg.entities;
        } catch { /* ignore */ }
      };

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
        ws.onclose = null;
        ws.close();
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
  }, []);

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          color: '#00ffaa',
          fontFamily: "'Courier New', monospace",
          fontSize: '14px',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        <div style={{ fontSize: '20px', fontWeight: 'bold', letterSpacing: '0.2em' }}>
          RIFTWARP
        </div>
        <div style={{ color: '#666', marginTop: 4 }}>{status}</div>
        <div style={{ color: '#888', marginTop: 4 }}>
          Ship: <span style={{ color: '#00ffaa' }}>{shipName}</span>
        </div>
      </div>
    </div>
  );
}
