/**
 * 1D Kalman Filter for Speed Over Ground (SOG) Fusion
 *
 * Fuses GPS speed (accurate, 1-2 Hz) with IMU forward acceleration
 * (fast but drifts, 10-100 Hz) to produce a smooth, responsive speed estimate.
 *
 * IMPORTANT TUNING NOTES (after field testing 2026-06):
 *   - IMU-based prediction is only used as a gentle smoothing aid, NOT as the
 *     primary speed source. The GPS speed is the ground truth.
 *   - R_GPS_NOISE is intentionally high (trust GPS less aggressively) to prevent
 *     the filter from over-correcting on noisy GPS spikes.
 *   - Q_PROCESS_NOISE is low to prevent IMU drift from inflating speed.
 *   - A hard cap of MAX_SPEED_MS (30 knots) prevents runaway estimates.
 *   - GPS outlier rejection: if a GPS reading jumps >5 kn from the previous,
 *     it is discarded (likely a GPS glitch).
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

/** Last GPS speed accepted by the filter (m/s) — used for outlier rejection */
let lastGpsSpeed = 0.0;

/** Whether the filter has received at least one GPS update */
let hasGpsUpdate = false;

// ─── Noise Parameters ─────────────────────────────────────────────────────────

/**
 * Process noise variance (Q): how much we trust the IMU acceleration.
 * Reduced from 0.01 to 0.005 — boats accelerate slowly, IMU should only
 * provide gentle smoothing between GPS updates, not drive the estimate.
 */
const Q_PROCESS_NOISE = 0.005;

/**
 * Measurement noise variance (R): how much we trust the GPS speed.
 * Increased from 0.04 to 0.09 — phone GPS speed accuracy is typically
 * ±0.2-0.5 m/s (±0.4-1.0 knots). Being more conservative prevents the
 * filter from chasing GPS noise spikes.
 * R = 0.09 m²/s² corresponds to ±0.3 m/s (±0.6 knots) GPS noise.
 */
const R_GPS_NOISE = 0.09;

/**
 * Accelerometer noise variance: uncertainty in IMU forward acceleration.
 * Increased from 0.1 to 0.25 — phone accelerometers on a boat are very
 * noisy due to wave motion, vibration, and non-ideal mounting.
 */
const R_ACCEL_NOISE = 0.25;

/**
 * Maximum plausible boat speed: 30 knots = 15.43 m/s.
 * Hard cap to prevent runaway Kalman estimates.
 */
const MAX_SPEED_MS = 15.43; // 30 knots

/**
 * GPS outlier rejection threshold: 5 knots = 2.57 m/s.
 * If a GPS reading jumps more than this from the previous accepted reading,
 * it is treated as a GPS glitch and discarded.
 * Only applied after the first GPS update.
 */
const GPS_OUTLIER_THRESHOLD_MS = 2.57; // 5 knots jump

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

  // Only apply IMU prediction if we already have a GPS baseline.
  // Before first GPS update, don't let IMU drive the estimate.
  if (!hasGpsUpdate) return;

  // Extract forward acceleration:
  // For mast-mounted phone (Y up, Z fore/aft):
  //   Forward accel = accelZ * cos(pitch) - gravity_component
  // The gravity component along Z when pitched: g * sin(pitch)
  // Net forward acceleration = accelZ - g * sin(pitch)
  const pitchRad = pitchDeg * DEG_TO_RAD;
  const gravityComponent = 9.81 * Math.sin(pitchRad);
  const forwardAccel = accelZ - gravityComponent;

  // Clamp to realistic boat acceleration range (±1 m/s² — conservative)
  const clampedAccel = Math.max(-1.0, Math.min(1.0, forwardAccel));

  // Predict new speed
  speedEstimate = speedEstimate + clampedAccel * dt;

  // Speed cannot be negative (boat doesn't sail backwards in normal racing)
  // and cannot exceed the hard cap
  speedEstimate = Math.max(0.0, Math.min(MAX_SPEED_MS, speedEstimate));

  // Grow uncertainty with time and process noise
  P = P + Q_PROCESS_NOISE * dt + R_ACCEL_NOISE * dt * dt;
}

/**
 * UPDATE step: correct the speed estimate with a GPS measurement.
 *
 * Called at low frequency (1-2 Hz) when a new GPS speed arrives.
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

  // Kalman gain: how much to trust GPS vs prediction
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
 * Useful for displaying confidence in the speed reading.
 */
export function getSpeedUncertainty(): number {
  return Math.sqrt(P);
}
