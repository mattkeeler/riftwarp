import { useEffect, useRef, useState } from 'react';
import { Application, Graphics } from 'pixi.js';
import {
  DEFAULT_PORT,
  ARENA_WIDTH,
  ARENA_HEIGHT,
  EntityType,
  CLIENT_INPUT_MS,
} from '@riftwarp/shared';
import type { ClientMessage, ServerMessage, SnapshotEntity } from '@riftwarp/shared';

function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Ship polygon vertices (pointing right)
const SHIP_VERTS = [15, 0, -10, -8, -6, 0, -10, 8];

export function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState('initializing...');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let destroyed = false;
    let cleanupFn: (() => void) | undefined;

    async function start() {
      // ---- Pixi setup ----
      const app = new Application();
      await app.init({
        background: '#0a0a0a',
        resizeTo: container,
        antialias: true,
      });
      if (destroyed) { app.destroy(true); return; }
      container.appendChild(app.canvas);

      // Arena border graphic
      const arenaBorder = new Graphics();
      app.stage.addChild(arenaBorder);

      // Ship graphics pool
      const shipGfx = new Map<number, Graphics>();

      // ---- State ----
      let playerId: string | null = null;
      let entities: SnapshotEntity[] = [];

      // ---- WebSocket ----
      const wsUrl = `ws://${window.location.hostname}:${DEFAULT_PORT}`;
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => setStatus('connected');
      ws.onclose = () => { if (!destroyed) setStatus('disconnected'); };
      ws.onmessage = (event) => {
        try {
          const msg: ServerMessage = JSON.parse(event.data);
          if (msg.type === 'loginOk') {
            playerId = msg.playerId;
            setStatus('logged in as ' + msg.username);
          }
          if (msg.type === 'gameStart') {
            setStatus('Arrow keys: steer | Up: thrust');
          }
          if (msg.type === 'snapshot') {
            entities = msg.entities;
          }
        } catch { /* ignore */ }
      };

      // ---- Input ----
      const keys = new Set<string>();
      const onDown = (e: KeyboardEvent) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
          e.preventDefault();
        }
        keys.add(e.key);
      };
      const onUp = (e: KeyboardEvent) => keys.delete(e.key);
      window.addEventListener('keydown', onDown);
      window.addEventListener('keyup', onUp);

      let seq = 0;
      const inputInterval = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;
        seq++;
        const msg: ClientMessage = {
          type: 'input',
          seq,
          input: {
            left: keys.has('ArrowLeft') || keys.has('a'),
            right: keys.has('ArrowRight') || keys.has('d'),
            thrust: keys.has('ArrowUp') || keys.has('w'),
            fire: keys.has(' '),
            secondaryFire: keys.has('Shift'),
            special: keys.has('e'),
          },
        };
        ws.send(JSON.stringify(msg));
      }, CLIENT_INPUT_MS);

      // ---- Render loop ----
      app.ticker.add(() => {
        const screenW = app.screen.width;
        const screenH = app.screen.height;

        // Find local player for camera
        const localShip = entities.find(
          (e) => e.type === EntityType.Ship && e.ownerId === playerId,
        );

        // Camera offset: center on local player
        let camX = screenW / 2 - ARENA_WIDTH / 2;
        let camY = screenH / 2 - ARENA_HEIGHT / 2;
        if (localShip) {
          camX = screenW / 2 - localShip.x;
          camY = screenH / 2 - localShip.y;
        }

        // Draw arena border
        arenaBorder.clear();
        arenaBorder.rect(camX, camY, ARENA_WIDTH, ARENA_HEIGHT);
        arenaBorder.stroke({ color: 0x333333, width: 2 });
        // Grid lines
        const gridSize = 65.5;
        for (let i = 1; i < 10; i++) {
          arenaBorder.moveTo(camX + i * gridSize, camY);
          arenaBorder.lineTo(camX + i * gridSize, camY + ARENA_HEIGHT);
          arenaBorder.moveTo(camX, camY + i * gridSize);
          arenaBorder.lineTo(camX + ARENA_WIDTH, camY + i * gridSize);
        }
        arenaBorder.stroke({ color: 0x1a1a1a, width: 1 });

        // Render ships
        const usedIds = new Set<number>();
        for (const e of entities) {
          if (e.type !== EntityType.Ship) continue;
          usedIds.add(e.id);

          let gfx = shipGfx.get(e.id);
          if (!gfx) {
            gfx = new Graphics();
            app.stage.addChild(gfx);
            shipGfx.set(e.id, gfx);
          }

          const isLocal = e.ownerId === playerId;
          const color = isLocal ? 0x00ffaa : 0xff4444;

          gfx.clear();

          // Ship polygon
          gfx.poly(SHIP_VERTS, true);
          gfx.fill({ color, alpha: 0.3 });
          gfx.stroke({ color, width: 2 });

          // Health bar
          if (e.health != null && e.maxHealth != null && e.maxHealth > 0) {
            const barW = 30;
            const pct = e.health / e.maxHealth;
            const barColor = pct > 0.5 ? 0x00ff00 : pct > 0.25 ? 0xffff00 : 0xff0000;
            gfx.rect(-barW / 2, -20, barW, 3);
            gfx.fill({ color: 0x333333 });
            gfx.rect(-barW / 2, -20, barW * pct, 3);
            gfx.fill({ color: barColor });
          }

          gfx.x = e.x + camX;
          gfx.y = e.y + camY;
          gfx.rotation = degToRad(e.angle);
        }

        // Remove dead ships
        for (const [id, gfx] of shipGfx) {
          if (!usedIds.has(id)) {
            gfx.destroy();
            shipGfx.delete(id);
          }
        }
      });

      // ---- Cleanup ----
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
      </div>
    </div>
  );
}
