// Arena
export const ARENA_WIDTH = 655;
export const ARENA_HEIGHT = 655;

// Physics
export const DECEL = 0.995;
export const REBOUND_COEFF = -0.5;
export const VELOCITY_ZERO_THRESHOLD = 0.05;

// Timing (server tick rate)
export const SERVER_TICK_RATE = 20; // Hz
export const SERVER_TICK_MS = 1000 / SERVER_TICK_RATE; // 50ms

// Client input send rate (match server tick)
export const CLIENT_INPUT_RATE = SERVER_TICK_RATE;
export const CLIENT_INPUT_MS = SERVER_TICK_MS;

// Wormhole portals
export const DEFAULT_ORBIT_DISTANCE = 270;
export const PORTAL_ARC_SPEED = 0.5; // degrees per tick
export const PORTAL_DAMAGE_THRESHOLD = 150; // damage before portal drops a powerup

// Stars
export const NUM_STARS = 70;

// Powerups
export const MAX_POWERUPS_INVENTORY = 5;
export const POWERUP_COLLISION_SIZE = 34;
export const POWERUP_LIFESPAN = 1200; // ticks
export const POWERUP_INVULNERABLE_TICKS = 20;

// Bullets
export const BULLET_SPEED = 10.0;
export const BULLET_NOSE_OFFSET = 12.0;
export const BULLET_LIFESPAN = 100; // ticks

// Powerup bullet (fired at wormhole)
export const POWERUP_BULLET_DAMAGE = 100;
export const POWERUP_BULLET_SIZE = 20;

// Wormhole damage
export const WORMHOLE_DAMAGE_THRESHOLD = 150;
export const POWERUP_QUEUE_DELAY = 30; // ticks

// Network
export const DEFAULT_PORT = 6049;

// Game flow
export const COUNTDOWN_SECONDS = 5;
export const MIN_PLAYERS_TO_START = 2;
