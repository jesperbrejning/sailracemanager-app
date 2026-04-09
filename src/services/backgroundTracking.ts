/**
 * Background GPS Tracking Service
 * 
 * Uses expo-location with expo-task-manager to maintain GPS tracking
 * even when the app is in the background or the screen is off.
 * 
 * On Android, this creates a Foreground Service with a persistent
 * notification, which is required by Android to keep GPS active.
 * 
 * Permission Flow (Android 11+):
 * 1. Request foreground location first
 * 2. If granted, request background location separately
 * 3. If background denied, show alert with "Open Settings" option
 * 4. Tracking can still work in foreground-only mode
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Alert, Linking, Platform } from 'react-native';
import { CONFIG } from '../config';
import { addPendingBatch } from './offlineStorage';
import {
  correctPositionForHeel,
  getHeelAngle,
  getPitchAngle,
  filterSpeedForHeel,
  kalmanGpsUpdate,
  getKalmanSpeedMs,
} from './heelCorrection';
import type { TrackingPoint } from '../types/tracking';

const TASK_NAME = CONFIG.GPS.BACKGROUND_TASK_NAME;

/**
 * In-memory buffer for GPS points collected in background.
 * This is shared between the background task and the foreground app.
 */
let pointBuffer: TrackingPoint[] = [];
let activeSessionId: number | null = null;
let lastTimestamp = 0;
let totalCollectedCount = 0; // Counts ALL points (foreground + background)
let sendPointsCallback: ((sessionId: number, points: TrackingPoint[]) => Promise<void>) | null = null;
let onLocationUpdateCallback: ((point: TrackingPoint) => void) | null = null;
let lastFilteredSpeed = 0; // Legacy fallback speed filter

/**
 * Define the background location task.
 * This MUST be called at the top level of the app (outside any component).
 */
TaskManager.defineTask(TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('[BackgroundTracking] Task error:', error.message);
    return;
  }

  if (!data) return;

  const { locations } = data as { locations: Location.LocationObject[] };

  for (const location of locations) {
    // Apply heel correction to GPS position
    const heelCorrected = correctPositionForHeel(
      location.coords.latitude,
      location.coords.longitude,
      location.coords.heading
    );

    // Feed GPS speed into Kalman filter for fused speed estimate
    const rawSpeed = location.coords.speed ?? undefined;
    let fusedSpeed: number | undefined;
    if (rawSpeed != null && rawSpeed >= 0) {
      kalmanGpsUpdate(rawSpeed);
      fusedSpeed = parseFloat(getKalmanSpeedMs().toFixed(3));
    } else {
      // Fallback legacy filter
      if (rawSpeed != null) {
        lastFilteredSpeed = filterSpeedForHeel(rawSpeed, lastFilteredSpeed);
        fusedSpeed = lastFilteredSpeed;
      }
    }

    const point: TrackingPoint = {
      latitude: heelCorrected.latitude,
      longitude: heelCorrected.longitude,
      accuracy: location.coords.accuracy ?? undefined,
      altitude: location.coords.altitude ?? undefined,
      altitudeAccuracy: location.coords.altitudeAccuracy ?? undefined,
      speed: fusedSpeed,
      heading: location.coords.heading ?? undefined,
      timestamp: location.timestamp,
      heelAngle: parseFloat(getHeelAngle().toFixed(1)),
      pitchAngle: parseFloat(getPitchAngle().toFixed(1)),
      heelCorrected: heelCorrected.correctionApplied,
    };

    // Skip duplicate timestamps
    if (Math.abs(point.timestamp - lastTimestamp) < 100) {
      continue;
    }
    lastTimestamp = point.timestamp;

    pointBuffer.push(point);
    totalCollectedCount += 1;

    // Notify foreground if callback is set
    if (onLocationUpdateCallback) {
      onLocationUpdateCallback(point);
    }
  }

  // Flush buffer if we have enough points or enough time has passed
  if (pointBuffer.length >= 10 && activeSessionId) {
    await flushBuffer();
  }
});

/**
 * Flush the point buffer to the server or offline storage.
 */
async function flushBuffer(): Promise<void> {
  if (pointBuffer.length === 0 || !activeSessionId) return;

  const points = [...pointBuffer];
  pointBuffer = [];

  // Split into batches of MAX_BATCH_SIZE
  for (let i = 0; i < points.length; i += CONFIG.GPS.MAX_BATCH_SIZE) {
    const batch = points.slice(i, i + CONFIG.GPS.MAX_BATCH_SIZE);

    if (sendPointsCallback) {
      try {
        await sendPointsCallback(activeSessionId, batch);
      } catch (err) {
        console.warn('[BackgroundTracking] Failed to send points, queuing offline:', err);
        await addPendingBatch(activeSessionId, batch);
      }
    } else {
      // No callback set (app might be fully backgrounded), store offline
      await addPendingBatch(activeSessionId, batch);
    }
  }
}

/**
 * Show an alert guiding the user to enable background location in Settings.
 */
function showBackgroundLocationSettingsAlert(): void {
  Alert.alert(
    'Background Location Required',
    'To track your sailing route when the screen is off or the app is in the background, you need to enable "Allow all the time" for location access.\n\nGo to Settings → Location → Allow all the time',
    [
      {
        text: 'Open Settings',
        onPress: () => {
          if (Platform.OS === 'android') {
            Linking.openSettings();
          } else {
            Linking.openURL('app-settings:');
          }
        },
      },
      {
        text: 'Continue without background',
        style: 'cancel',
      },
    ]
  );
}

/**
 * Request location permissions with proper step-by-step flow for Android 11+.
 * 
 * On Android 11+, background location MUST be requested separately after
 * foreground location is granted. The system may not show a dialog and instead
 * require the user to go to Settings manually.
 * 
 * Returns the permission status and whether the user should be guided to Settings.
 */
export async function requestLocationPermissions(): Promise<{
  foreground: boolean;
  background: boolean;
}> {
  // Step 1: Check if we already have permissions
  const existingFg = await Location.getForegroundPermissionsAsync();
  const existingBg = await Location.getBackgroundPermissionsAsync();
  
  if (existingFg.status === 'granted' && existingBg.status === 'granted') {
    return { foreground: true, background: true };
  }

  // Step 2: Request foreground location first
  if (existingFg.status !== 'granted') {
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      return { foreground: false, background: false };
    }
  }

  // Step 3: Request background location (separate step on Android 11+)
  if (existingBg.status !== 'granted') {
    const { status: bgStatus, canAskAgain } = await Location.requestBackgroundPermissionsAsync();
    
    if (bgStatus === 'granted') {
      return { foreground: true, background: true };
    }

    // On Android 12+, the system often doesn't show a dialog for background location.
    // Instead, it returns 'denied' immediately and the user must go to Settings.
    if (Platform.OS === 'android') {
      // Show a helpful alert guiding the user to Settings
      showBackgroundLocationSettingsAlert();
    }

    return { foreground: true, background: false };
  }

  return {
    foreground: existingFg.status === 'granted',
    background: existingBg.status === 'granted',
  };
}

/**
 * Check current permission status without requesting.
 */
export async function checkLocationPermissions(): Promise<{
  foreground: boolean;
  background: boolean;
}> {
  const fg = await Location.getForegroundPermissionsAsync();
  const bg = await Location.getBackgroundPermissionsAsync();
  return {
    foreground: fg.status === 'granted',
    background: bg.status === 'granted',
  };
}

/**
 * Start background GPS tracking.
 * 
 * If background permission is not granted, falls back to foreground-only
 * tracking using watchPositionAsync instead of startLocationUpdatesAsync.
 * 
 * @param sessionId - The tracking session ID from the backend
 * @param onSendPoints - Callback to send points to the backend
 * @param onUpdate - Callback for each new location update (foreground UI)
 */
export async function startBackgroundTracking(
  sessionId: number,
  onSendPoints: (sessionId: number, points: TrackingPoint[]) => Promise<void>,
  onUpdate?: (point: TrackingPoint) => void
): Promise<void> {
  // Reset state
  pointBuffer = [];
  activeSessionId = sessionId;
  lastTimestamp = 0;
  totalCollectedCount = 0;
  lastFilteredSpeed = 0;
  sendPointsCallback = onSendPoints;
  onLocationUpdateCallback = onUpdate ?? null;

  // Check current permissions
  const perms = await checkLocationPermissions();

  if (perms.background) {
    // Full background tracking via TaskManager
    // Check if already tracking
    const isTracking = await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
    if (isTracking) {
      await Location.stopLocationUpdatesAsync(TASK_NAME);
    }

    // Start background location updates
    await Location.startLocationUpdatesAsync(TASK_NAME, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: CONFIG.GPS.MIN_UPDATE_INTERVAL_MS,
      distanceInterval: 0, // Get updates even when stationary
      deferredUpdatesInterval: 0,
      deferredUpdatesDistance: 0,
      showsBackgroundLocationIndicator: true, // iOS
      foregroundService: {
        notificationTitle: CONFIG.GPS.NOTIFICATION_TITLE,
        notificationBody: CONFIG.GPS.NOTIFICATION_BODY,
        notificationColor: '#e85d2a',
        killServiceOnDestroy: false,
      },
      // Android: Keep tracking even when app is killed
      pausesUpdatesAutomatically: false,
      activityType: Location.ActivityType.OtherNavigation,
    });
  } else if (perms.foreground) {
    // Foreground-only fallback using watchPositionAsync
    console.log('[BackgroundTracking] Background denied, using foreground-only tracking');
    
    await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: CONFIG.GPS.MIN_UPDATE_INTERVAL_MS,
        distanceInterval: 0,
      },
      (location) => {
        // Apply heel correction to GPS position
        const heelCorrected = correctPositionForHeel(
          location.coords.latitude,
          location.coords.longitude,
          location.coords.heading
        );

        // Apply speed filtering for heel-induced noise
        const rawSpeed = location.coords.speed ?? undefined;
        if (rawSpeed != null) {
          lastFilteredSpeed = filterSpeedForHeel(rawSpeed, lastFilteredSpeed);
        }

        const point: TrackingPoint = {
          latitude: heelCorrected.latitude,
          longitude: heelCorrected.longitude,
          accuracy: location.coords.accuracy ?? undefined,
          altitude: location.coords.altitude ?? undefined,
          altitudeAccuracy: location.coords.altitudeAccuracy ?? undefined,
          speed: rawSpeed != null ? lastFilteredSpeed : undefined,
          heading: location.coords.heading ?? undefined,
          timestamp: location.timestamp,
          heelAngle: parseFloat(getHeelAngle().toFixed(1)),
          pitchAngle: parseFloat(getPitchAngle().toFixed(1)),
          heelCorrected: heelCorrected.correctionApplied,
        };

        if (Math.abs(point.timestamp - lastTimestamp) < 100) return;
        lastTimestamp = point.timestamp;

        pointBuffer.push(point);
        totalCollectedCount += 1;

        if (onLocationUpdateCallback) {
          onLocationUpdateCallback(point);
        }

        // Auto-flush when buffer is large enough
        if (pointBuffer.length >= 10 && activeSessionId) {
          flushBuffer().catch(() => {});
        }
      }
    );
  } else {
    throw new Error('Location permission not granted');
  }
}

/**
 * Stop background GPS tracking and flush remaining points.
 */
export async function stopBackgroundTracking(): Promise<void> {
  // Flush any remaining points
  await flushBuffer();

  // Stop location updates
  try {
    const isTracking = await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
    if (isTracking) {
      await Location.stopLocationUpdatesAsync(TASK_NAME);
    }
  } catch (err) {
    console.warn('[BackgroundTracking] Error stopping location updates:', err);
  }

  // Reset state
  activeSessionId = null;
  sendPointsCallback = null;
  onLocationUpdateCallback = null;
  pointBuffer = [];
  lastTimestamp = 0;
}

/**
 * Check if background tracking is currently active.
 */
export async function isBackgroundTrackingActive(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(TASK_NAME);
  } catch {
    return false;
  }
}

/**
 * Get the current GPS position (one-shot).
 * Useful for showing initial position before tracking starts.
 */
export async function getCurrentPosition(): Promise<Location.LocationObject | null> {
  try {
    return await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
  } catch {
    return null;
  }
}

/**
 * Force flush the buffer (called from foreground when needed).
 */
export async function forceFlush(): Promise<void> {
  await flushBuffer();
}

/**
 * Get the number of points currently in the buffer.
 */
export function getBufferSize(): number {
  return pointBuffer.length;
}

/**
 * Update the send callback (e.g., when tRPC client reconnects).
 */
export function updateSendCallback(
  callback: (sessionId: number, points: TrackingPoint[]) => Promise<void>
): void {
  sendPointsCallback = callback;
}

/**
 * Update the location update callback (e.g., when screen becomes visible).
 */
export function updateLocationCallback(
  callback: ((point: TrackingPoint) => void) | null
): void {
  onLocationUpdateCallback = callback;
}

/**
 * Get the total number of GPS points collected (foreground + background).
 * This is the authoritative counter for "collected" in the UI.
 */
export function getTotalCollected(): number {
  return totalCollectedCount;
}
