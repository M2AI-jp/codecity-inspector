// Tunable constants for the browser runtime. Units: px (world pixels), seconds.

export const TILE = 16;

// Simulation
export const SIM_DT = 1 / 120;          // fixed update step
export const MAX_FRAME_DT = 0.1;        // a frame never simulates more than this

// Player movement. Running is the default; holding Shift walks.
export const RUN_SPEED = 128;
export const WALK_SPEED = 72;
export const ACCEL = 1000;              // px/s^2 toward the target velocity
export const DECEL = 1300;              // px/s^2 when releasing input
export const FEET_W = 12;               // feet collision box
export const FEET_H = 8;
export const FEET_UP = 6;               // box spans [y-FEET_UP, y-FEET_UP+FEET_H)
export const CORNER_SLIDE = 7;          // px of corner correction around wall edges / door jambs

// Walk-cycle stride: one animation frame per this many px travelled
export const STRIDE_WALK = 8;
export const STRIDE_RUN = 11;

// Camera
export const CAMERA_OMEGA = 6.5;        // critically damped spring stiffness (1/s)
export const CAMERA_LOOK_UP = 10;       // aim slightly above the feet
export const CAMERA_LEAD = 0.36;        // s of velocity look-ahead (cancels the spring's lag)
export const NATIVE_TARGET_W = 480;     // native view width target (scale = ceil(deviceW / this))

// Buildings
export const CUTAWAY_FADE = 0.18;       // s, exterior <-> cutaway cross-fade

// Night lighting. AMBIENT is the single strength knob: 0 = pitch black, 1 = daylight.
export const AMBIENT = 0.72;
export const AMBIENT_TINT = [0.80, 0.86, 1.0];   // cool blue moonlit evening
export const LIGHT_WARM = [255, 196, 120];
export const PLAYER_LIGHT_RADIUS = 46;

// Residents
export const RESIDENT_SPEED = 40;
export const NEAR_RESIDENT = 30;        // px, speech bubble distance
export const NEAR_KEEPER = 44;          // px, dialogue distance inside a building
export const NEAR_NOTICE = 40;          // px, noticeboard distance
