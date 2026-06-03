/**
 * GPS-Only Kalman Filter for Speed Over Ground (SOG)
 *
 * This is a simple 1D Kalman filter that smooths GPS speed readings.
 * It does NOT use IMU acceleration — the IMU predict step was removed
 * because phone accelerometers on a boat are too noisy and cause speed
 * drift even when stationary (observed: ~3.6 kn at rest).
 *
 * Without IMU, the filter acts as an adaptive low-pass filter:
 * - When GPS speed is stable: output tracks GPS closely
 * - When GPS speed jumps suddenly: output transitions smoothly
 * - At rest: output stays near 0 (matching Vakaros-level 0.2-0.8 kn noise)
 *
 * UNIT: All speeds in m/s
 */

// ─── Kalman Filter State ───────────────────────────────────────────────────────

/** Current speed estimate (m/s) */
let speedEstimate = 0.0;

/** Estimate uncertainty (variance, m²/s²) */
let P = 1.0;

/** Last GPS speed accepted by the filter (m/s) — used for outlier rejection */
let lastGpsSpeed = 0.0;

/** Whether the filter has received at least one GPS update */
let hasGpsUpdate = false;

// ─── Noise Parameters ─────────────────────────────────────────────────────────

/**
 * Process noise variance (Q): how much the speed can change between GPS updates.
 * Without IMU, this represents natural speed variation between 0.5s GPS samples.
 * Q = 0.01 m²/s² per update ≈ ±0.1 m/s (±0.2 kn) natural variation per step.
 */
const Q_PROCESS_NOISE = 0.01;

/**
 * Measurement noise variance (R): how much we trust each GPS speed reading.
 * Phone GPS speed accuracy: ±0.2-0.5 m/s (±0.4-1.0 knots).
 * R = 0.09 m²/s² corresponds to ±0.3 m/s (±0.6 knots) GPS noise.
 */
const R_GPS_NOISE = 0.09;

/**
 * Maximum plausible boat speed: 30 knots = 15.43 m/s.
 * Hard cap to prevent runaway estimates from GPS glitches.
 */
const MAX_SPEED_MS = 15.43; // 30 knots

/**
 * GPS outlier rejection threshold: 5 knots = 2.57 m/s per update.
 * If a GPS reading jumps more than this from the previous accepted reading,
 * it is treated as a GPS glitch and discarded.
 * Only applied after the first GPS update.
 */
const GPS_OUTLIER_THRESHOLD_MS = 2.57; // 5 knots

// ─── Kalman Filter Steps ──────────────────────────────────────────────────────

/**
 * PREDICT step: advance uncertainty without IMU.
 * Called implicitly inside kalmanUpdate — no separate predict call needed.
 * We grow P slightly each update to allow the filter to track changes.
 */
function predictStep(): void {
  P = P + Q_PROCESS_NOISE;
  // Cap uncertainty to prevent filter from becoming too trusting of GPS
  P = Math.min(P, 1.0);
}

/**
 * UPDATE step: correct the speed estimate with a GPS measurement.
 *
 * Called at 1-2 Hz when a new GPS speed arrives from expo-location.
 * Includes outlier rejection to discard GPS glitches.
 *
 * @param gpsSpeed - GPS speed in m/s (from location.coords.speed)
 */
export function kalmanUpdate(gpsSpeed: number): void {
  if (gpsSpeed < 0) return; // Invalid GPS speed

  // Hard cap: reject GPS readings above max plausible speed
  if (gpsSpeed > MAX_SPEED_MS) {
    console.warn(`[KalmanSpeed] GPS speed ${(gpsSpeed * 1.94384).toFixed(1)} kn exceeds cap, discarding`);
    return;
  }

  // Outlier rejection: skip GPS readings that jump too far from last accepted value
  if (hasGpsUpdate) {
    const jump = Math.abs(gpsSpeed - lastGpsSpeed);
    if (jump > GPS_OUTLIER_THRESHOLD_MS) {
      console.warn(
        `[KalmanSpeed] GPS speed jump ${(jump * 1.94384).toFixed(1)} kn > threshold, discarding outlier`
      );
      return;
    }
  }

  // Predict step: grow uncertainty since last update
  predictStep();

  // Kalman gain: how much to trust GPS vs current estimate
  const K = P / (P + R_GPS_NOISE);

  // Update speed estimate
  speedEstimate = speedEstimate + K * (gpsSpeed - speedEstimate);

  // Update uncertainty (decreases after GPS measurement)
  P = (1.0 - K) * P;

  lastGpsSpeed = gpsSpeed;
  hasGpsUpdate = true;

  // Ensure non-negative and within cap
  speedEstimate = Math.max(0.0, Math.min(MAX_SPEED_MS, speedEstimate));
}

// ─── Stub: kalmanPredict is now a no-op ───────────────────────────────────────

/**
 * IMU predict step — DISABLED.
 * Phone accelerometers on a boat are too noisy and cause speed drift
 * even when stationary. This function is kept as a stub so existing
 * call sites in heelCorrection.ts do not need to be changed.
 */
export function kalmanPredict(
  _accelZ: number,
  _pitchDeg: number,
  _nowMs: number
): void {
  // No-op: IMU-based speed prediction removed to prevent drift
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the current fused speed estimate in m/s.
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
 * Call when tracking stops or a new session starts.
 */
export function resetKalmanSpeed(): void {
  speedEstimate = 0.0;
  P = 1.0;
  lastGpsSpeed = 0.0;
  hasGpsUpdate = false;
}

/**
 * Initialise the filter with a known GPS speed.
 * Call this on the first GPS update to avoid starting from 0.
 */
export function initKalmanSpeed(initialSpeedMs: number): void {
  const capped = Math.max(0.0, Math.min(MAX_SPEED_MS, initialSpeedMs));
  speedEstimate = capped;
  lastGpsSpeed = capped;
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
 */
export function getSpeedUncertainty(): number {
  return Math.sqrt(P);
}
