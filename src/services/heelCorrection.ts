/**
 * Heel Correction Service
 * 
 * Uses the device's motion sensors (accelerometer + gyroscope via DeviceMotion)
 * to detect the boat's heel angle (krængning) and correct GPS positions.
 * 
 * When a sailboat heels, the phone tilts with it, causing:
 * 1. GPS antenna displacement - the phone moves horizontally away from the boat's centerline
 * 2. Speed measurement errors - centripetal acceleration adds noise
 * 3. Heading inaccuracies - magnetometer is affected by tilt
 * 
 * This service uses Expo's DeviceMotion API which provides fused sensor data
 * (the OS already applies a complementary/Kalman filter to combine accelerometer + gyro).
 * 
 * Key insight: DeviceMotion.rotation.gamma gives us the roll angle directly,
 * which corresponds to the boat's heel angle when the phone is roughly upright.
 * 
 * LIMITATION: expo-sensors does NOT work in the background on Android.
 * When the app goes to background, we keep the last known heel angle and
 * apply a decay filter (heel angle slowly returns to 0 over time).
 */

import { DeviceMotion, Magnetometer } from 'expo-sensors';
import type { DeviceMotionMeasurement, MagnetometerMeasurement } from 'expo-sensors';
import { MagDebugLogger } from './magDebugLogger';

// ─── Configuration ──────────────────────────────────────────────────────────

/** How often to sample device motion (ms). 10Hz for heel/pitch, 2Hz for HDG display. */
const SENSOR_UPDATE_INTERVAL_MS = 100;

/** Magnetometer update interval (ms). 500ms = 2Hz for compass display. */
const MAG_UPDATE_INTERVAL_MS = 500;

/** 
 * Complementary filter alpha for smoothing heel angle.
 * Higher = more responsive but noisier. Lower = smoother but more lag.
 * 0.15 works well for sailing where heel changes are gradual (1-5 seconds).
 */
const SMOOTHING_ALPHA = 0.15;

/**
 * Minimum heel angle (degrees) to apply correction.
 * Below this, the correction is negligible and we skip it to save CPU.
 */
const MIN_HEEL_ANGLE_DEG = 3;

/**
 * Maximum realistic heel angle (degrees).
 * Most keelboats won't exceed 45°. Dinghies can go higher but GPS is useless then.
 * Clamp to this value to filter out sensor glitches.
 */
const MAX_HEEL_ANGLE_DEG = 55;

/**
 * Estimated height of phone above waterline (meters).
 * This affects the magnitude of the GPS position correction.
 * Default: 1.5m (typical cockpit height on a keelboat).
 * Can be configured by the user in settings.
 */
const DEFAULT_PHONE_HEIGHT_METERS = 1.5;

/**
 * When app goes to background, decay the heel angle towards 0.
 * This factor is applied every second: heelAngle *= BACKGROUND_DECAY_FACTOR
 * After ~10 seconds, heel angle will be ~35% of original.
 */
const BACKGROUND_DECAY_FACTOR = 0.9;

// ─── State ──────────────────────────────────────────────────────────────────

let isActive = false;
let subscription: { remove: () => void } | null = null;

/** Current smoothed heel angle in degrees. Positive = starboard heel, Negative = port heel. */
let currentHeelAngle = 0;

/** Raw (unsmoothed) heel angle from last sensor reading */
let rawHeelAngle = 0;

/** Current pitch angle in degrees (trim fore/aft) */
let currentPitchAngle = 0;

/** Timestamp of last sensor update */
let lastSensorTimestamp = 0;

/** Whether we're in foreground (sensors active) or background (using decay) */
let isForeground = true;

/** Background decay timer */
let decayTimer: ReturnType<typeof setInterval> | null = null;

/** Phone height above waterline - configurable */
let phoneHeightMeters = DEFAULT_PHONE_HEIGHT_METERS;

// ─── Magnetometer / HDG state ────────────────────────────────────────────────

/** Raw magnetometer values (µT) */
let magX = 0;
let magY = 0;
let magZ = 0;

/** Tilt-compensated magnetic heading in degrees (0–360, 0 = North, clockwise) */
let currentHDG = 0;

/** Magnetometer subscription */
let magSubscription: { remove: () => void } | null = null;

/** Smoothing alpha for HDG (lower = smoother, more lag) */
const HDG_SMOOTHING_ALPHA = 0.1;

/** Magnetic declination in degrees (positive = east). 0 = no correction.
 *  For Denmark: ~3° East (2025). Can be updated from GPS location later. */
let magneticDeclination = 3.0;

// ─── Sensor Processing ─────────────────────────────────────────────────────

/**
 * Process a DeviceMotion measurement to extract heel angle.
 * 
 * DeviceMotion.rotation gives us Euler angles:
 * - alpha: rotation around Z axis (yaw/heading) - 0 to 2π
 * - beta:  rotation around X axis (pitch/trim)  - -π to π
 * - gamma: rotation around Y axis (roll/heel)   - -π/2 to π/2
 * 
 * For a phone held roughly upright in portrait mode on a boat:
 * - gamma directly corresponds to heel angle
 * - beta corresponds to pitch/trim
 */
function processSensorData(data: DeviceMotionMeasurement): void {
  if (!data.rotation) return;

  const { beta, gamma } = data.rotation;

  // Convert from radians to degrees
  const heelDeg = (gamma ?? 0) * (180 / Math.PI);
  const pitchDeg = (beta ?? 0) * (180 / Math.PI);

  // Clamp to realistic range
  const clampedHeel = Math.max(-MAX_HEEL_ANGLE_DEG, Math.min(MAX_HEEL_ANGLE_DEG, heelDeg));

  // Store raw value
  rawHeelAngle = clampedHeel;

  // Apply complementary (exponential moving average) filter for smoothing
  currentHeelAngle = currentHeelAngle + SMOOTHING_ALPHA * (clampedHeel - currentHeelAngle);
  currentPitchAngle = currentPitchAngle + SMOOTHING_ALPHA * (pitchDeg - currentPitchAngle);

  lastSensorTimestamp = Date.now();

  // Recompute HDG whenever tilt changes (uses latest magX/Y/Z)
  computeTiltCompensatedHDG();
}

/**
 * Process a magnetometer measurement.
 * Stores raw values and recomputes tilt-compensated heading.
 */
function processMagnetometerData(data: MagnetometerMeasurement): void {
  magX = data.x;
  magY = data.y;
  magZ = data.z;
  computeTiltCompensatedHDG();
}

/**
 * Compute tilt-compensated magnetic heading (HDG) from magnetometer + tilt angles.
 *
 * MOUNTING ASSUMPTION: Phone is mounted on the mast, upright (portrait),
 * with the DISPLAY FACING AFT (towards the cockpit).
 *
 * In this orientation, the phone's axes map to the boat as follows:
 *   Phone X  → points to STARBOARD
 *   Phone Y  → points AFT (towards cockpit)
 *   Phone Z  → points UP (towards sky)
 *
 * For a flat, level phone in this orientation:
 *   - Heading North: magX ≈ 0, magY ≈ -H (H = horizontal field strength)
 *   - Heading East:  magX ≈ H, magY ≈ 0
 *   - Heading South: magX ≈ 0, magY ≈ +H
 *   - Heading West:  magX ≈ -H, magY ≈ 0
 *
 * So the flat (no tilt) heading formula is: atan2(magX, -magY)
 * This gives 0=N, 90=E, 180=S, 270=W.
 *
 * With tilt compensation for heel (roll around Y-axis for mast mount):
 *   Xh = Bx * cos(pitch) - Bz * sin(pitch)
 *   Yh = Bx * sin(heel) * sin(pitch) + By * cos(heel) + Bz * sin(heel) * cos(pitch)
 *   HDG = atan2(Xh, -Yh)
 *
 * DeviceMotion.rotation for mast-mounted phone:
 *   beta  (pitch) = fore/aft tilt of mast
 *   gamma (roll)  = heel (port/starboard)
 */
function computeTiltCompensatedHDG(): void {
  // Skip if no magnetometer data yet
  if (magX === 0 && magY === 0 && magZ === 0) return;

  const heel  = currentHeelAngle  * DEG_TO_RAD;  // gamma - port/starboard heel
  const pitch = currentPitchAngle * DEG_TO_RAD;  // beta  - fore/aft mast tilt

  const cosHeel  = Math.cos(heel);
  const sinHeel  = Math.sin(heel);
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);

  // Tilt-compensated components for mast-mounted phone (display facing aft)
  const Xh =  magX * cosPitch
             - magZ * sinPitch;

  const Yh =  magX * sinHeel * sinPitch
             + magY * cosHeel
             + magZ * sinHeel * cosPitch;

  // atan2(Xh, -Yh): North-referenced, clockwise
  // N=0°, E=90°, S=180°, W=270°
  let hdgDeg = Math.atan2(Xh, -Yh) * (180 / Math.PI);

  // Apply magnetic declination (Denmark ~3° East)
  hdgDeg += magneticDeclination;

  // Normalise to 0–360
  hdgDeg = ((hdgDeg % 360) + 360) % 360;

  // Nautical convention: 0° displayed as 360°
  if (hdgDeg < 0.5) hdgDeg = 360;

  // Log every reading to debug file (if logging is active)
  // Also log to console every ~5 sec
  void MagDebugLogger.log(magX, magY, magZ, currentHeelAngle, currentPitchAngle, Xh, Yh, hdgDeg);
  if (Math.random() < 0.1) {
    console.log(
      `[HDG] mag=(${magX.toFixed(1)},${magY.toFixed(1)},${magZ.toFixed(1)})` +
      ` heel=${currentHeelAngle.toFixed(1)}° pitch=${currentPitchAngle.toFixed(1)}°` +
      ` Xh=${Xh.toFixed(2)} Yh=${Yh.toFixed(2)} hdg=${hdgDeg.toFixed(1)}°`
    );
  }

  // Smooth with EMA, handling 359°→1° wrap-around
  let diff = hdgDeg - currentHDG;
  if (diff > 180)  diff -= 360;
  if (diff < -180) diff += 360;
  let smoothed = currentHDG + HDG_SMOOTHING_ALPHA * diff;
  smoothed = ((smoothed % 360) + 360) % 360;
  currentHDG = smoothed < 0.5 ? 360 : smoothed;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Start the heel correction sensor.
 * Call this when GPS tracking starts.
 */
export async function startHeelSensor(): Promise<boolean> {
  if (isActive) return true;

  try {
    const isAvailable = await DeviceMotion.isAvailableAsync();
    if (!isAvailable) {
      console.warn('[HeelCorrection] DeviceMotion not available on this device');
      return false;
    }

    // Set update interval
    DeviceMotion.setUpdateInterval(SENSOR_UPDATE_INTERVAL_MS);

    // Subscribe to DeviceMotion (heel/pitch)
    subscription = DeviceMotion.addListener(processSensorData);

    // Subscribe to Magnetometer (HDG) at 2Hz
    const magAvailable = await Magnetometer.isAvailableAsync();
    if (magAvailable) {
      Magnetometer.setUpdateInterval(MAG_UPDATE_INTERVAL_MS); // 500ms = 2Hz
      magSubscription = Magnetometer.addListener(processMagnetometerData);
      console.log('[HeelCorrection] Magnetometer started for HDG at 2Hz');
    } else {
      console.warn('[HeelCorrection] Magnetometer not available - HDG will be unavailable');
    }

    isActive = true;
    isForeground = true;
    currentHeelAngle = 0;
    rawHeelAngle = 0;
    currentPitchAngle = 0;
    currentHDG = 0;
    magX = 0; magY = 0; magZ = 0;

    console.log('[HeelCorrection] Sensor started (heel + HDG)');
    return true;
  } catch (err) {
    console.error('[HeelCorrection] Failed to start:', err);
    return false;
  }
}

/**
 * Stop the heel correction sensor.
 * Call this when GPS tracking stops.
 */
export function stopHeelSensor(): void {
  if (subscription) {
    subscription.remove();
    subscription = null;
  }

  if (magSubscription) {
    magSubscription.remove();
    magSubscription = null;
  }

  if (decayTimer) {
    clearInterval(decayTimer);
    decayTimer = null;
  }

  isActive = false;
  currentHeelAngle = 0;
  rawHeelAngle = 0;
  currentPitchAngle = 0;
  currentHDG = 0;
  magX = 0; magY = 0; magZ = 0;

  console.log('[HeelCorrection] Sensor stopped');
}

/**
 * Notify the service that the app has gone to background.
 * Sensors stop working, so we decay the heel angle gradually.
 */
export function onAppBackground(): void {
  isForeground = false;

  // Start decay timer - gradually reduce heel angle towards 0
  if (!decayTimer) {
    decayTimer = setInterval(() => {
      currentHeelAngle *= BACKGROUND_DECAY_FACTOR;
      currentPitchAngle *= BACKGROUND_DECAY_FACTOR;

      // Stop decaying when angle is negligible
      if (Math.abs(currentHeelAngle) < 0.5) {
        currentHeelAngle = 0;
        currentPitchAngle = 0;
        if (decayTimer) {
          clearInterval(decayTimer);
          decayTimer = null;
        }
      }
    }, 1000);
  }
}

/**
 * Notify the service that the app has come to foreground.
 * Sensors will resume automatically via the subscription.
 */
export function onAppForeground(): void {
  isForeground = true;

  if (decayTimer) {
    clearInterval(decayTimer);
    decayTimer = null;
  }
}

/**
 * Get the current smoothed heel angle in degrees.
 * Positive = starboard heel, Negative = port heel.
 */
export function getHeelAngle(): number {
  return currentHeelAngle;
}

/**
 * Get the current raw (unsmoothed) heel angle in degrees.
 */
export function getRawHeelAngle(): number {
  return rawHeelAngle;
}

/**
 * Get the current pitch angle in degrees.
 * Positive = bow up, Negative = bow down.
 */
export function getPitchAngle(): number {
  return currentPitchAngle;
}

/**
 * Get the tilt-compensated magnetic heading (HDG) in degrees.
 * Nautical convention: N=360, E=090, S=180, W=270.
 * Returns null if magnetometer is not available.
 */
export function getHDG(): number | null {
  if (!magSubscription && magX === 0 && magY === 0 && magZ === 0) return null;
  const hdg = parseFloat(currentHDG.toFixed(1));
  // Ensure nautical convention: 0 is displayed as 360
  return hdg === 0 ? 360 : hdg;
}

/**
 * Set the magnetic declination for the current location.
 * @param declinationDeg - Degrees east (positive) or west (negative)
 */
export function setMagneticDeclination(declinationDeg: number): void {
  magneticDeclination = declinationDeg;
}

/**
 * Check if the heel sensor is currently active.
 */
export function isHeelSensorActive(): boolean {
  return isActive;
}

/**
 * Set the phone height above waterline (meters).
 * This affects the magnitude of GPS position correction.
 */
export function setPhoneHeight(heightMeters: number): void {
  phoneHeightMeters = Math.max(0.5, Math.min(5, heightMeters));
}

/**
 * Get the current phone height setting.
 */
export function getPhoneHeight(): number {
  return phoneHeightMeters;
}

// ─── GPS Correction Functions ───────────────────────────────────────────────

/** Earth radius in meters */
const EARTH_RADIUS = 6371000;

/** Degrees to radians */
const DEG_TO_RAD = Math.PI / 180;

/**
 * Correct a GPS position for heel angle displacement.
 * 
 * When the boat heels, the phone (GPS antenna) moves horizontally
 * away from the boat's centerline. The displacement is:
 *   horizontal_offset = phone_height * sin(heel_angle)
 * 
 * The direction of the offset is perpendicular to the boat's heading,
 * towards the heeling side.
 * 
 * @param latitude  - Raw GPS latitude
 * @param longitude - Raw GPS longitude
 * @param heading   - Boat heading in degrees (0 = north, clockwise)
 * @returns Corrected {latitude, longitude} or original if no correction needed
 */
export function correctPositionForHeel(
  latitude: number,
  longitude: number,
  heading: number | undefined | null
): { latitude: number; longitude: number; heelAngle: number; correctionApplied: boolean } {
  const heelAngle = currentHeelAngle;

  // Skip correction if heel angle is too small or no heading available
  if (Math.abs(heelAngle) < MIN_HEEL_ANGLE_DEG || heading == null || heading === -1) {
    return { latitude, longitude, heelAngle, correctionApplied: false };
  }

  // Calculate horizontal displacement in meters
  const heelRad = heelAngle * DEG_TO_RAD;
  const horizontalOffset = phoneHeightMeters * Math.sin(heelRad);

  // The offset direction is perpendicular to heading, towards the heeling side
  // Heel positive (starboard) = offset to starboard = heading + 90°
  // Heel negative (port) = offset to port = heading - 90° (but sin is already negative)
  // So we always use heading + 90° and the sign of horizontalOffset handles direction
  const offsetBearing = ((heading + 90) % 360) * DEG_TO_RAD;

  // Convert offset to lat/lon delta
  // At the equator: 1° lat ≈ 111,320m, 1° lon ≈ 111,320m * cos(lat)
  const dLat = (horizontalOffset * Math.cos(offsetBearing)) / EARTH_RADIUS * (180 / Math.PI);
  const dLon = (horizontalOffset * Math.sin(offsetBearing)) / (EARTH_RADIUS * Math.cos(latitude * DEG_TO_RAD)) * (180 / Math.PI);

  // Apply correction (subtract the displacement to get the true boat position)
  return {
    latitude: latitude - dLat,
    longitude: longitude - dLon,
    heelAngle,
    correctionApplied: true,
  };
}

/**
 * Apply a simple low-pass filter to speed to reduce noise from heel-induced movement.
 * 
 * When the boat heels/rolls, the phone moves in an arc, adding apparent speed.
 * This filter smooths out these oscillations.
 * 
 * @param currentSpeed - Current GPS speed in m/s
 * @param previousFilteredSpeed - Previous filtered speed in m/s
 * @param alpha - Filter coefficient (0-1). Lower = smoother. Default 0.3.
 * @returns Filtered speed in m/s
 */
export function filterSpeedForHeel(
  currentSpeed: number | undefined | null,
  previousFilteredSpeed: number,
  alpha: number = 0.3
): number {
  if (currentSpeed == null || currentSpeed < 0) return previousFilteredSpeed;

  // If heel angle is significant, use stronger filtering
  const heelFactor = Math.abs(currentHeelAngle) > 15 ? 0.15 : alpha;

  return previousFilteredSpeed + heelFactor * (currentSpeed - previousFilteredSpeed);
}
