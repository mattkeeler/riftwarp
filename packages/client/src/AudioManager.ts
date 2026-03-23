/**
 * Procedural audio using Web Audio API.
 * All sounds are synthesized — no external files.
 */

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let enabled = false;
let thrustOsc: OscillatorNode | null = null;
let thrustGain: GainNode | null = null;
let thrustActive = false;

function ensureContext(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') {
    ctx.resume();
  }
  return ctx;
}

export function enableAudio(): void {
  ensureContext();
  enabled = true;
}

export function disableAudio(): void {
  enabled = false;
  stopThrust();
}

export function toggleAudio(): boolean {
  if (enabled) {
    disableAudio();
  } else {
    enableAudio();
  }
  return enabled;
}

export function isAudioEnabled(): boolean {
  return enabled;
}

/** Short laser/pew sound for bullet fire */
export function playFire(): void {
  if (!enabled) return;
  const c = ensureContext();
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(880, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(220, c.currentTime + 0.08);

  gain.gain.setValueAtTime(0.15, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.08);

  osc.connect(gain);
  gain.connect(masterGain!);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.08);
}

/** Explosion sound — noise burst with low-pass filter */
export function playExplosion(): void {
  if (!enabled) return;
  const c = ensureContext();
  const duration = 0.3;

  // White noise via buffer
  const bufferSize = c.sampleRate * duration;
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }

  const noise = c.createBufferSource();
  noise.buffer = buffer;

  const filter = c.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1000, c.currentTime);
  filter.frequency.exponentialRampToValueAtTime(100, c.currentTime + duration);

  const gain = c.createGain();
  gain.gain.setValueAtTime(0.25, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);

  noise.connect(filter);
  filter.connect(gain);
  gain.connect(masterGain!);
  noise.start(c.currentTime);
  noise.stop(c.currentTime + duration);
}

/** Powerup collect — rising chime */
export function playCollect(): void {
  if (!enabled) return;
  const c = ensureContext();

  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(440, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(1320, c.currentTime + 0.15);

  gain.gain.setValueAtTime(0.12, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.2);

  osc.connect(gain);
  gain.connect(masterGain!);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.2);
}

/** Shield activate — low hum */
export function playShield(): void {
  if (!enabled) return;
  const c = ensureContext();

  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(110, c.currentTime);
  osc.frequency.linearRampToValueAtTime(165, c.currentTime + 0.3);

  gain.gain.setValueAtTime(0.1, c.currentTime);
  gain.gain.linearRampToValueAtTime(0.05, c.currentTime + 0.2);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.4);

  osc.connect(gain);
  gain.connect(masterGain!);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.4);
}

/** Start continuous thrust sound (looping low rumble) */
export function startThrust(): void {
  if (!enabled || thrustActive) return;
  const c = ensureContext();

  thrustOsc = c.createOscillator();
  thrustGain = c.createGain();

  thrustOsc.type = 'sawtooth';
  thrustOsc.frequency.value = 55;

  thrustGain.gain.value = 0.04;

  thrustOsc.connect(thrustGain);
  thrustGain.connect(masterGain!);
  thrustOsc.start();
  thrustActive = true;
}

/** Stop thrust sound */
export function stopThrust(): void {
  if (!thrustActive) return;
  try {
    thrustOsc?.stop();
    thrustOsc?.disconnect();
    thrustGain?.disconnect();
  } catch { /* already stopped */ }
  thrustOsc = null;
  thrustGain = null;
  thrustActive = false;
}

/** Hit sound — short impact */
export function playHit(): void {
  if (!enabled) return;
  const c = ensureContext();

  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = 'square';
  osc.frequency.setValueAtTime(150, c.currentTime);
  osc.frequency.exponentialRampToValueAtTime(50, c.currentTime + 0.05);

  gain.gain.setValueAtTime(0.15, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.06);

  osc.connect(gain);
  gain.connect(masterGain!);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + 0.06);
}
