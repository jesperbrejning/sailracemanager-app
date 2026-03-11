/**
 * Background GPS Tracking Service
 * 
 * Uses expo-location with expo-task-manager to maintain GPS tracking
 * even when the app is in the background or the screen is off.
 * 
 * On Android, this creates a Foreground Service with a persistent
 * notification, which is required by Android to keep GPS active.
 * 
 * Architecture:
 * 1. TaskManager defines a background task that receives location updates
 * 2. Location updates are buffered in memory and AsyncStorage
 * 3. A periodic flush sends batched points to the backend
 * 4. If offline, points are queued in AsyncStorage for later sync
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { CONFIG } from '../config';
import { addPendingBatch } from './offlineStorage';
import type { TrackingPoint } from '../types/tracking';

const TASK_NAME = CONFIG.GPS.BACKGROUND_TASK_NAME;

/**
 * In-memory buffer for GPS points collected in background.
 * This is shared between the background task and the foreground app.
 */
let pointBuffer: TrackingPoint[] = [];
let activeSessionId: number | null = null;
let lastTimestamp = 0;
let sendPointsCallback: ((sessionId: number, points: TrackingPoint[]) => Promise<void>) | null = null;
let onLocationUpdateCallback: ((point: TrackingPoint) => void) | null = null;

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
    const point: TrackingPoint = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy ?? undefined,
      altitude: location.coords.altitude ?? undefined,
      altitudeAccuracy: location.coords.altitudeAccuracy ?? undefined,
      speed: location.coords.speed ?? undefined,
      heading: location.coords.heading ?? undefined,
      timestamp: location.timestamp,
    };

    // Skip duplicate timestamps
    if (Math.abs(point.timestamp - lastTimestamp) < 100) {
      continue;
    }
    lastTimestamp = point.timestamp;

    pointBuffer.push(point);

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
 * Request location permissions (foreground + background).
 * Must be called before starting tracking.
 */
export async function requestLocationPermissions(): Promise<{
  foreground: boolean;
  background: boolean;
}> {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') {
    return { foreground: false, background: false };
  }

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  return {
    foreground: true,
    background: bgStatus === 'granted',
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
  sendPointsCallback = onSendPoints;
  onLocationUpdateCallback = onUpdate ?? null;

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
