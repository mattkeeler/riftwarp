/**
 * Fixed-timestep game loop with drift compensation.
 * Runs a callback at a steady rate (default 20Hz / 50ms).
 */
export class Ticker {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private tick = 0;
  private lastTime = 0;

  constructor(
    private readonly callback: (tick: number, dt: number) => void,
    private readonly tickRateMs: number,
  ) {}

  start(): void {
    if (this.intervalId !== null) return;
    this.lastTime = performance.now();
    this.intervalId = setInterval(() => {
      const now = performance.now();
      const dt = now - this.lastTime;
      this.lastTime = now;
      this.tick++;
      this.callback(this.tick, dt);
    }, this.tickRateMs);
  }

  stop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  getCurrentTick(): number {
    return this.tick;
  }
}
