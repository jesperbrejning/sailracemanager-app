/**
 * Speed Filter — Median filter on raw GPS speed
 *
 * Replaces the previous Kalman filter which caused two problems:
 * 1. IMU predict step caused ~3.6 kn drift at rest
 * 2. GPS-only Kalman became too stiff and locked on initial value
 *
 * This module is now a simple median filter over the last 5 GPS speed readings.
 * - Median is more robust than mean: a single GPS glitch does not spike the output
 * - No state drift, no convergence issues, no tuning parameters
 * - Reacts immediately to real speed changes (within 5 readings = ~2.5 seconds at 2 Hz)
 *
 * The existing call sites (kalmanGpsUpdate, getKalmanSpeedMs, etc.) are kept
 * as stubs so no other files need to change.
 *
 * UNIT: All speeds in m/s
 */

// ─── Median Filter State ──────────────────────────────────────────────────────

/** Ring buffer of the last N raw GPS speed readings (m/s) */
const BUFFER_SIZE = 5;
const speedBuffer: number[] = [];

/** Maximum plausible boat speed: 30 knots = 15.43 m/s */
const MAX_SPEED_MS = 15.43;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Feed a new GPS speed reading into the filter.
 * Replaces kalmanGpsUpdate() call sites.
 */
export function kalmanGpsUpdate(gpsSpeedMs: number): void {
  if (gpsSpeedMs < 0) return;
  // Hard cap: discard implausible readings
  if (gpsSpeedMs > MAX_SPEED_MS) return;
  speedBuffer.push(gpsSpeedMs);
  if (speedBuffer.length > BUFFER_SIZE) speedBuffer.shift();
}

/**
 * Get the current filtered speed estimate in m/s.
 * Returns median of the last N GPS readings.
 */
export function getKalmanSpeedMs(): number {
  return median(speedBuffer);
}

/**
 * Get the current filtered speed in knots.
 */
export function getKalmanSpeedKnots(): number {
  return getKalmanSpeedMs() * 1.94384;
}

/**
 * Reset the filter. Call when tracking stops or a new session starts.
 */
export function resetKalmanSpeed(): void {
  speedBuffer.length = 0;
}

/**
 * Initialise with a known speed. Fills the buffer with the initial value.
 */
export function initKalmanSpeed(initialSpeedMs: number): void {
  speedBuffer.length = 0;
  const capped = Math.max(0, Math.min(MAX_SPEED_MS, initialSpeedMs));
  for (let i = 0; i < BUFFER_SIZE; i++) speedBuffer.push(capped);
}

/**
 * Check if the filter has received at least one reading.
 */
export function isKalmanReady(): boolean {
  return speedBuffer.length > 0;
}

/**
 * Get current speed uncertainty (std dev in m/s).
 * Approximated as half the IQR of the buffer.
 */
export function getSpeedUncertainty(): number {
  if (speedBuffer.length < 2) return 0;
  const sorted = [...speedBuffer].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  return (q3 - q1) / 2;
}

// ─── Stubs for removed functionality ─────────────────────────────────────────

/** No-op: IMU predict step removed */
export function kalmanPredict(_accelZ: number, _pitchDeg: number, _nowMs: number): void {}

/** No-op: direct update alias */
export function kalmanUpdate(gpsSpeed: number): void {
  kalmanGpsUpdate(gpsSpeed);
}

/** Get current estimate (alias) */
export function getKalmanSpeed(): number {
  return getKalmanSpeedMs();
}
