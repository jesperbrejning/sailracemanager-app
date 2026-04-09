/**
 * 1D Kalman Filter for Speed Over Ground (SOG) Fusion
 *
 * Fuses GPS speed (accurate but slow, 1 Hz) with IMU forward acceleration
 * (fast but drifts, 10-100 Hz) to produce a smooth, responsive speed estimate.
 *
 * This is the same principle used in Vakaros Atlas to give "instant" speed
 * response to wind gusts and manoeuvres, even though the GPS only updates
 * once per second.
 *
 * HOW IT WORKS:
 *   1. PREDICT: Use IMU forward acceleration to predict new speed
 *      speed_predicted = speed_prev + accel_forward * dt
 *      uncertainty grows with each prediction step
 *
 *   2. UPDATE: When a GPS speed arrives, fuse it with the prediction
 *      Kalman gain = uncertainty / (uncertainty + GPS_noise)
 *      speed_fused = speed_predicted + gain * (gps_speed - speed_predicted)
 *      uncertainty shrinks after GPS update
 *
 * RESULT:
 *   - Between GPS updates: speed follows IMU acceleration (instant response)
 *   - At GPS updates: speed is corrected towards GPS measurement
 *   - Smooth output without the 1-second "staircase" effect of raw GPS speed
 *
 * MOUNTING NOTE:
 *   Phone is mounted on mast, display facing aft. The "forward" acceleration
 *   axis depends on the phone orientation. For mast-mounted portrait (Y up):
 *   - Forward/aft acceleration is along the Z axis (fore/aft)
 *   - We use accelerometer Z component, corrected for pitch angle
 *
 * UNIT: All speeds in m/s, accelerations in m/s²
 */

// ─── Kalman Filter State ───────────────────────────────────────────────────────

/** Current speed estimate (m/s) */
let speedEstimate = 0.0;

/** Estimate uncertainty (variance, m²/s²) */
let P = 1.0;

/** Timestamp of last prediction step (ms) */
let lastPredictTime = 0;

/** Last GPS speed used for update (m/s) */
let lastGpsSpeed = 0.0;

/** Whether the filter has received at least one GPS update */
let hasGpsUpdate = false;

// ─── Noise Parameters ─────────────────────────────────────────────────────────

/**
 * Process noise variance (Q): how much we trust the IMU acceleration.
 * Higher Q = trust IMU more, faster response but noisier.
 * Lower Q = trust IMU less, smoother but slower.
 *
 * Tuned for sailing: boats accelerate/decelerate slowly (0.1-0.5 m/s²),
 * but we want to catch wind gusts quickly.
 * Q = 0.01 m²/s² per second = ~0.1 m/s uncertainty after 1 second
 */
const Q_PROCESS_NOISE = 0.01;

/**
 * Measurement noise variance (R): how much we trust the GPS speed.
 * Higher R = trust GPS less, smoother but slower to correct.
 * Lower R = trust GPS more, faster correction but noisier.
 *
 * Typical phone GPS speed accuracy: ±0.1-0.3 m/s (±0.2-0.6 knots)
 * R = 0.04 m²/s² corresponds to ±0.2 m/s (±0.4 knots) GPS noise
 */
const R_GPS_NOISE = 0.04;

/**
 * Accelerometer noise variance: uncertainty in IMU forward acceleration.
 * Accounts for sensor noise, vibration, and mounting imperfections.
 * R_accel = 0.1 m²/s⁴ corresponds to ±0.32 m/s² accelerometer noise
 */
const R_ACCEL_NOISE = 0.1;

// ─── Coordinate System ────────────────────────────────────────────────────────

const DEG_TO_RAD = Math.PI / 180;

// ─── Kalman Filter Steps ──────────────────────────────────────────────────────

/**
 * PREDICT step: advance the speed estimate using IMU acceleration.
 *
 * Called at high frequency (10-100 Hz) with each IMU reading.
 * Extracts the forward (along-boat) acceleration component, corrected
 * for the phone's pitch angle (mast tilt fore/aft).
 *
 * @param accelZ     - Raw accelerometer Z axis (m/s²) — fore/aft for mast mount
 * @param pitchDeg   - Current pitch angle in degrees (bow up = positive)
 * @param nowMs      - Current timestamp in milliseconds
 */
export function kalmanPredict(
  accelZ: number,
  pitchDeg: number,
  nowMs: number
): void {
  if (lastPredictTime === 0) {
    lastPredictTime = nowMs;
    return;
  }

  const dt = (nowMs - lastPredictTime) / 1000.0;
  lastPredictTime = nowMs;

  // Reject unreasonable dt (e.g. after app resume)
  if (dt <= 0 || dt > 1.0) {
    lastPredictTime = nowMs;
    return;
  }

  // Extract forward acceleration:
  // For mast-mounted phone (Y up, Z fore/aft):
  //   Forward accel = accelZ * cos(pitch) - gravity_component
  // The gravity component along Z when pitched: g * sin(pitch)
  // Net forward acceleration = accelZ - g * sin(pitch)
  const pitchRad = pitchDeg * DEG_TO_RAD;
  const gravityComponent = 9.81 * Math.sin(pitchRad);
  const forwardAccel = accelZ - gravityComponent;

  // Clamp to realistic boat acceleration range (±2 m/s²)
  const clampedAccel = Math.max(-2.0, Math.min(2.0, forwardAccel));

  // Predict new speed
  speedEstimate = speedEstimate + clampedAccel * dt;

  // Speed cannot be negative (boat doesn't sail backwards in normal racing)
  speedEstimate = Math.max(0.0, speedEstimate);

  // Grow uncertainty with time and process noise
  P = P + Q_PROCESS_NOISE * dt + R_ACCEL_NOISE * dt * dt;
}

/**
 * UPDATE step: correct the speed estimate with a GPS measurement.
 *
 * Called at low frequency (1 Hz) when a new GPS speed arrives.
 *
 * @param gpsSpeed - GPS speed in m/s (from location.coords.speed)
 */
export function kalmanUpdate(gpsSpeed: number): void {
  if (gpsSpeed < 0) return; // Invalid GPS speed

  // Kalman gain: how much to trust GPS vs prediction
  const K = P / (P + R_GPS_NOISE);

  // Update speed estimate
  speedEstimate = speedEstimate + K * (gpsSpeed - speedEstimate);

  // Update uncertainty (decreases after GPS measurement)
  P = (1.0 - K) * P;

  lastGpsSpeed = gpsSpeed;
  hasGpsUpdate = true;

  // Ensure non-negative
  speedEstimate = Math.max(0.0, speedEstimate);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the current fused speed estimate in m/s.
 * Returns raw GPS speed if no IMU data has been processed yet.
 */
export function getKalmanSpeed(): number {
  return speedEstimate;
}

/**
 * Get the current fused speed estimate in knots.
 */
export function getKalmanSpeedKnots(): number {
  return speedEstimate * 1.94384;
}

/**
 * Reset the Kalman filter.
 * Call when tracking stops or GPS speed jumps unexpectedly.
 */
export function resetKalmanSpeed(): void {
  speedEstimate = 0.0;
  P = 1.0;
  lastPredictTime = 0;
  lastGpsSpeed = 0.0;
  hasGpsUpdate = false;
}

/**
 * Initialise the filter with a known GPS speed.
 * Call this on the first GPS update to avoid starting from 0.
 */
export function initKalmanSpeed(initialSpeedMs: number): void {
  speedEstimate = Math.max(0.0, initialSpeedMs);
  P = R_GPS_NOISE; // Start with GPS-level uncertainty
  hasGpsUpdate = true;
}

/**
 * Check if the filter has received at least one GPS update.
 */
export function isKalmanReady(): boolean {
  return hasGpsUpdate;
}

/**
 * Get the current filter uncertainty (standard deviation in m/s).
 * Useful for displaying confidence in the speed reading.
 */
export function getSpeedUncertainty(): number {
  return Math.sqrt(P);
}
