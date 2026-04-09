/**
 * Madgwick AHRS Filter for SailRaceManager
 *
 * Implementation of the Madgwick Sensor Fusion Algorithm for computing
 * orientation (quaternion) from gyroscope, accelerometer and magnetometer data.
 *
 * Reference:
 *   S. O. H. Madgwick, "An efficient orientation filter for inertial and
 *   inertial/magnetic sensor arrays", April 2010.
 *   http://www.x-io.co.uk/open-source-imu-and-ahrs-algorithms/
 *
 * This is the same class of algorithm used in Vakaros Atlas and other
 * high-performance sailing instruments to produce a stable, tilt-compensated
 * compass heading even in rough sea conditions.
 *
 * MOUNTING ASSUMPTION:
 *   Phone is mounted on the mast, portrait/upright, display facing AFT (cockpit).
 *   Verified axis mapping from rotation test:
 *     Phone X → horizontal, starboard
 *     Phone Y → vertical (along mast, up)
 *     Phone Z → horizontal, fore/aft
 *
 * HOW IT WORKS:
 *   1. Gyroscope integrates angular velocity → fast, no drift over short time
 *   2. Accelerometer finds gravity direction → corrects gyro pitch/roll drift
 *   3. Magnetometer finds magnetic north → corrects gyro yaw (heading) drift
 *   The beta parameter controls how aggressively we trust the accelerometer
 *   and magnetometer over the gyroscope. Higher beta = faster correction but
 *   more susceptible to magnetic interference.
 *
 * ADVANTAGES OVER SIMPLE TILT COMPENSATION:
 *   - Handles rapid boat motions (tacking, gybing) without heading spikes
 *   - Gyroscope predicts heading between magnetometer updates
 *   - Smooth output even in rough conditions
 *   - Handles gimbal lock (90° pitch) gracefully via quaternion math
 */

// ─── Quaternion State ──────────────────────────────────────────────────────────

/** Quaternion representing current orientation: [w, x, y, z] */
let q0 = 1.0;
let q1 = 0.0;
let q2 = 0.0;
let q3 = 0.0;

/** Timestamp of last update (ms) */
let lastUpdateTime = 0;

/** Whether the filter has been initialised with valid sensor data */
let isInitialised = false;

// ─── Configuration ─────────────────────────────────────────────────────────────

/**
 * Beta: filter gain (gradient descent step size).
 * Controls the trade-off between gyroscope and accelerometer/magnetometer.
 *
 * Vakaros-equivalent tuning for sailing:
 *   0.033 - Very smooth, ~2s settling time (good for steady sailing)
 *   0.1   - Balanced, ~0.5s settling time (good for tacking/gybing)
 *   0.5   - Fast response, noisier (good for dynamic manoeuvres)
 *
 * We use 0.1 as default - matches Vakaros "responsive" compass mode.
 */
const BETA = 0.1;

/**
 * Zeta: gyroscope drift rate compensation (rad/s per second).
 * Set to 0 for phones (gyro drift is handled by OS sensor fusion).
 */
const ZETA = 0.0;

// ─── Helper: Fast Inverse Square Root ─────────────────────────────────────────

function invSqrt(x: number): number {
  return 1.0 / Math.sqrt(x);
}

// ─── Core Madgwick Update ──────────────────────────────────────────────────────

/**
 * Update the Madgwick filter with new sensor readings.
 *
 * All inputs must be in SI units:
 *   - Gyroscope: rad/s
 *   - Accelerometer: m/s² (or any consistent unit, will be normalised)
 *   - Magnetometer: µT (or any consistent unit, will be normalised)
 *
 * @param gx, gy, gz - Gyroscope angular velocity (rad/s)
 * @param ax, ay, az - Accelerometer (m/s²)
 * @param mx, my, mz - Magnetometer (µT)
 * @param dt         - Time step in seconds
 */
export function madgwickUpdate(
  gx: number, gy: number, gz: number,
  ax: number, ay: number, az: number,
  mx: number, my: number, mz: number,
  dt: number
): void {
  let recipNorm: number;
  let s0: number, s1: number, s2: number, s3: number;
  let qDot1: number, qDot2: number, qDot3: number, qDot4: number;
  let hx: number, hy: number;
  let _2q0mx: number, _2q0my: number, _2q0mz: number, _2q1mx: number;
  let _2bx: number, _2bz: number;
  let _4bx: number, _4bz: number;
  let _2q0: number, _2q1: number, _2q2: number, _2q3: number;
  let _2q0q2: number, _2q2q3: number;
  let q0q0: number, q0q1: number, q0q2: number, q0q3: number;
  let q1q1: number, q1q2: number, q1q3: number, q2q2: number, q2q3: number, q3q3: number;

  // Rate of change of quaternion from gyroscope
  qDot1 = 0.5 * (-q1 * gx - q2 * gy - q3 * gz);
  qDot2 = 0.5 * (q0 * gx + q2 * gz - q3 * gy);
  qDot3 = 0.5 * (q0 * gy - q1 * gz + q3 * gx);
  qDot4 = 0.5 * (q0 * gz + q1 * gy - q2 * gx);

  // Compute feedback only if accelerometer measurement valid
  const accNorm = Math.sqrt(ax * ax + ay * ay + az * az);
  if (accNorm > 0.01) {
    // Normalise accelerometer measurement
    recipNorm = invSqrt(ax * ax + ay * ay + az * az);
    ax *= recipNorm;
    ay *= recipNorm;
    az *= recipNorm;

    // Normalise magnetometer measurement
    const magNorm = Math.sqrt(mx * mx + my * my + mz * mz);
    if (magNorm > 0.01) {
      recipNorm = invSqrt(mx * mx + my * my + mz * mz);
      mx *= recipNorm;
      my *= recipNorm;
      mz *= recipNorm;

      // Auxiliary variables to avoid repeated arithmetic
      _2q0mx = 2.0 * q0 * mx;
      _2q0my = 2.0 * q0 * my;
      _2q0mz = 2.0 * q0 * mz;
      _2q1mx = 2.0 * q1 * mx;
      _2q0 = 2.0 * q0;
      _2q1 = 2.0 * q1;
      _2q2 = 2.0 * q2;
      _2q3 = 2.0 * q3;
      _2q0q2 = 2.0 * q0 * q2;
      _2q2q3 = 2.0 * q2 * q3;
      q0q0 = q0 * q0;
      q0q1 = q0 * q1;
      q0q2 = q0 * q2;
      q0q3 = q0 * q3;
      q1q1 = q1 * q1;
      q1q2 = q1 * q2;
      q1q3 = q1 * q3;
      q2q2 = q2 * q2;
      q2q3 = q2 * q3;
      q3q3 = q3 * q3;

      // Reference direction of Earth's magnetic field
      hx = mx * q0q0 - _2q0my * q3 + _2q0mz * q2 + mx * q1q1 + _2q1 * my * q2 + _2q1 * mz * q3 - mx * q2q2 - mx * q3q3;
      hy = _2q0mx * q3 + my * q0q0 - _2q0mz * q1 + _2q1mx * q2 - my * q1q1 + my * q2q2 + _2q2 * mz * q3 - my * q3q3;
      _2bx = Math.sqrt(hx * hx + hy * hy);
      _2bz = -_2q0mx * q2 + _2q0my * q1 + mz * q0q0 + _2q1mx * q3 - mz * q1q1 + _2q2 * my * q3 - mz * q2q2 + mz * q3q3;
      _4bx = 2.0 * _2bx;
      _4bz = 2.0 * _2bz;

      // Gradient descent algorithm corrective step
      s0 = -_2q2 * (2.0 * q1q3 - _2q0q2 - ax) + _2q1 * (2.0 * q0q1 + _2q2q3 - ay) - _2bz * q2 * (_2bx * (0.5 - q2q2 - q3q3) + _2bz * (q1q3 - q0q2) - mx) + (-_2bx * q3 + _2bz * q1) * (_2bx * (q1q2 - q0q3) + _2bz * (q0q1 + q2q3) - my) + _2bx * q2 * (_2bx * (q0q2 + q1q3) + _2bz * (0.5 - q1q1 - q2q2) - mz);
      s1 = _2q3 * (2.0 * q1q3 - _2q0q2 - ax) + _2q0 * (2.0 * q0q1 + _2q2q3 - ay) - 4.0 * q1 * (1 - 2.0 * q1q1 - 2.0 * q2q2 - az) + _2bz * q3 * (_2bx * (0.5 - q2q2 - q3q3) + _2bz * (q1q3 - q0q2) - mx) + (_2bx * q2 + _2bz * q0) * (_2bx * (q1q2 - q0q3) + _2bz * (q0q1 + q2q3) - my) + (_2bx * q3 - _4bz * q1) * (_2bx * (q0q2 + q1q3) + _2bz * (0.5 - q1q1 - q2q2) - mz);
      s2 = -_2q0 * (2.0 * q1q3 - _2q0q2 - ax) + _2q3 * (2.0 * q0q1 + _2q2q3 - ay) - 4.0 * q2 * (1 - 2.0 * q1q1 - 2.0 * q2q2 - az) + (-_4bx * q2 - _2bz * q0) * (_2bx * (0.5 - q2q2 - q3q3) + _2bz * (q1q3 - q0q2) - mx) + (_2bx * q1 + _2bz * q3) * (_2bx * (q1q2 - q0q3) + _2bz * (q0q1 + q2q3) - my) + (_2bx * q0 - _4bz * q2) * (_2bx * (q0q2 + q1q3) + _2bz * (0.5 - q1q1 - q2q2) - mz);
      s3 = _2q1 * (2.0 * q1q3 - _2q0q2 - ax) + _2q2 * (2.0 * q0q1 + _2q2q3 - ay) + (-_4bx * q3 + _2bz * q1) * (_2bx * (0.5 - q2q2 - q3q3) + _2bz * (q1q3 - q0q2) - mx) + (-_2bx * q0 + _2bz * q2) * (_2bx * (q1q2 - q0q3) + _2bz * (q0q1 + q2q3) - my) + _2bx * q1 * (_2bx * (q0q2 + q1q3) + _2bz * (0.5 - q1q1 - q2q2) - mz);

      // Normalise step magnitude
      recipNorm = invSqrt(s0 * s0 + s1 * s1 + s2 * s2 + s3 * s3);
      s0 *= recipNorm;
      s1 *= recipNorm;
      s2 *= recipNorm;
      s3 *= recipNorm;

      // Apply feedback step
      qDot1 -= BETA * s0;
      qDot2 -= BETA * s1;
      qDot3 -= BETA * s2;
      qDot4 -= BETA * s3;
    }
  }

  // Integrate rate of change of quaternion to yield quaternion
  q0 += qDot1 * dt;
  q1 += qDot2 * dt;
  q2 += qDot3 * dt;
  q3 += qDot4 * dt;

  // Normalise quaternion
  recipNorm = invSqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
  q0 *= recipNorm;
  q1 *= recipNorm;
  q2 *= recipNorm;
  q3 *= recipNorm;
}

// ─── Orientation Extraction ────────────────────────────────────────────────────

/**
 * Extract roll (heel) angle in degrees from the current quaternion.
 * Positive = starboard heel, Negative = port heel.
 *
 * For mast-mounted phone (Y axis vertical):
 *   Roll is rotation around Y axis.
 */
export function getMadgwickHeel(): number {
  // Roll around Y axis (for mast-mounted phone, Y is vertical)
  // Using standard quaternion-to-Euler conversion
  const sinRoll = 2.0 * (q0 * q1 + q2 * q3);
  const cosRoll = 1.0 - 2.0 * (q1 * q1 + q2 * q2);
  return Math.atan2(sinRoll, cosRoll) * (180 / Math.PI);
}

/**
 * Extract pitch (trim) angle in degrees from the current quaternion.
 * Positive = bow up, Negative = bow down.
 */
export function getMadgwickPitch(): number {
  const sinPitch = 2.0 * (q0 * q2 - q3 * q1);
  const clampedSin = Math.max(-1.0, Math.min(1.0, sinPitch));
  return Math.asin(clampedSin) * (180 / Math.PI);
}

/**
 * Extract magnetic heading (HDG) in degrees from the current quaternion.
 *
 * For mast-mounted phone (display facing aft, Y axis vertical):
 *   Heading is the yaw angle around the vertical (Y) axis.
 *
 * Returns nautical convention: N=360, E=090, S=180, W=270.
 * Returns null if not yet initialised.
 */
export function getMadgwickHDG(magneticDeclination: number = 3.0): number | null {
  if (!isInitialised) return null;

  // Extract yaw from quaternion
  // For Y-up coordinate system (mast-mounted phone):
  const sinYaw = 2.0 * (q0 * q3 + q1 * q2);
  const cosYaw = 1.0 - 2.0 * (q2 * q2 + q3 * q3);
  let yawDeg = Math.atan2(sinYaw, cosYaw) * (180 / Math.PI);

  // Apply magnetic declination
  yawDeg += magneticDeclination;

  // Normalise to 0–360
  yawDeg = ((yawDeg % 360) + 360) % 360;

  // Nautical convention: 0° → 360°
  return yawDeg < 0.5 ? 360 : parseFloat(yawDeg.toFixed(1));
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Process a new set of sensor readings through the Madgwick filter.
 *
 * Call this every time you receive a gyroscope update (typically 10-100 Hz).
 * Magnetometer and accelerometer can be updated at lower rates.
 *
 * @param gyro  - {x, y, z} in rad/s
 * @param accel - {x, y, z} in m/s² (raw, not normalised)
 * @param mag   - {x, y, z} in µT (raw, not normalised)
 * @param nowMs - Current timestamp in milliseconds
 */
export function updateMadgwick(
  gyro: { x: number; y: number; z: number },
  accel: { x: number; y: number; z: number },
  mag: { x: number; y: number; z: number },
  nowMs: number
): void {
  if (lastUpdateTime === 0) {
    lastUpdateTime = nowMs;
    isInitialised = false;
    return;
  }

  const dt = (nowMs - lastUpdateTime) / 1000.0; // Convert to seconds
  lastUpdateTime = nowMs;

  // Reject unreasonable dt values (e.g. after app resume from background)
  if (dt <= 0 || dt > 1.0) {
    lastUpdateTime = nowMs;
    return;
  }

  // Run Madgwick update
  madgwickUpdate(
    gyro.x, gyro.y, gyro.z,
    accel.x, accel.y, accel.z,
    mag.x, mag.y, mag.z,
    dt
  );

  // Mark as initialised after first valid update
  if (!isInitialised) {
    isInitialised = true;
  }
}

/**
 * Reset the filter to initial state.
 * Call this when tracking stops or the phone is repositioned.
 */
export function resetMadgwick(): void {
  q0 = 1.0;
  q1 = 0.0;
  q2 = 0.0;
  q3 = 0.0;
  lastUpdateTime = 0;
  isInitialised = false;
}

/**
 * Check if the filter has been initialised with valid data.
 */
export function isMadgwickReady(): boolean {
  return isInitialised;
}

/**
 * Get the current quaternion (for debugging or advanced use).
 */
export function getQuaternion(): { w: number; x: number; y: number; z: number } {
  return { w: q0, x: q1, y: q2, z: q3 };
}
