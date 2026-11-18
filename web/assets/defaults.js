// Keep the approved player and shared ground defaults together so every loader uses the same definitions.
export const DEFAULT_PLAYER_SRC = '/art/approved/player--default.png';
export const DEFAULT_GROUND = {
  street: '/art/game/ground/street.png', grass: '/art/game/ground/grass.png',
  dirt: '/art/game/ground/dirt.png', plaza: '/art/game/ground/plaza.png',
};

// Frame table for the approved player sheet (192x256, 32x32 frames, 6 cols x 8 rows).
// Rows 0-1 face up, 2-3 down, 4-5 right, 6-7 left. In each direction the first row holds
// the standing frame (col 0) and a 4-frame walk cycle (cols 2-5); the second row's cols 2-5
// are arm gestures (unused while walking).
export const DEFAULT_PLAYER_ANIMS = {
  idle: { up: [0], down: [12], right: [24], left: [36] },
  walk: {
    up: [2, 3, 4, 5],
    down: [14, 15, 16, 17],
    right: [26, 27, 28, 29],
    left: [38, 39, 40, 41],
  },
};
