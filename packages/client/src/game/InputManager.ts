import type { InputState } from '@riftwarp/shared';
import { EMPTY_INPUT, CLIENT_INPUT_MS } from '@riftwarp/shared';
import type { WebSocketClient } from '../network/WebSocketClient.js';

/**
 * Tracks keyboard state and sends input to the server at a fixed rate.
 */
export class InputManager {
  private keys = new Set<string>();
  private seq = 0;
  private sendIntervalId: ReturnType<typeof setInterval> | null = null;

  /** History of unacknowledged inputs for prediction reconciliation */
  private unackedInputs: Array<{ seq: number; input: InputState }> = [];

  constructor(private network: WebSocketClient) {
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
  }

  start(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);

    // Send input to server at fixed rate
    this.sendIntervalId = setInterval(() => this.sendInput(), CLIENT_INPUT_MS);

    // Listen for input acks to trim history
    this.network.onMessage((msg) => {
      if (msg.type === 'inputAck') {
        this.acknowledgeInput(msg.seq);
      }
    });
  }

  stop(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    if (this.sendIntervalId !== null) {
      clearInterval(this.sendIntervalId);
      this.sendIntervalId = null;
    }
  }

  /** Get current input state from keyboard */
  getCurrentInput(): InputState {
    return {
      left: this.keys.has('ArrowLeft') || this.keys.has('a'),
      right: this.keys.has('ArrowRight') || this.keys.has('d'),
      thrust: this.keys.has('ArrowUp') || this.keys.has('w'),
      fire: this.keys.has(' '),
      secondaryFire: this.keys.has('Shift'),
      special: this.keys.has('e'),
    };
  }

  /** Get unacknowledged inputs for prediction replay */
  getUnackedInputs(): Array<{ seq: number; input: InputState }> {
    return this.unackedInputs;
  }

  private sendInput(): void {
    const input = this.getCurrentInput();
    this.seq++;
    this.unackedInputs.push({ seq: this.seq, input });
    this.network.send({ type: 'input', seq: this.seq, input });
  }

  private acknowledgeInput(seq: number): void {
    // Remove all inputs up to and including the acked sequence
    this.unackedInputs = this.unackedInputs.filter((i) => i.seq > seq);
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Prevent default for game keys
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
      e.preventDefault();
    }
    this.keys.add(e.key);
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keys.delete(e.key);
  }
}
