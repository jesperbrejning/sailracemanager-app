/**
 * Offline Storage Service
 * 
 * Handles local persistence of GPS points when the device
 * is offline or the server is unreachable. Points are stored
 * in AsyncStorage and synced when connectivity returns.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { CONFIG } from '../config';
import type { TrackingPoint } from '../types/tracking';

interface PendingBatch {
  sessionId: number;
  points: TrackingPoint[];
  createdAt: number;
}

/** Get all pending (unsent) GPS point batches */
export async function getPendingBatches(): Promise<PendingBatch[]> {
  try {
    const data = await AsyncStorage.getItem(CONFIG.STORAGE_KEYS.PENDING_POINTS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/** Add a batch of points to the pending queue */
export async function addPendingBatch(
  sessionId: number,
  points: TrackingPoint[]
): Promise<void> {
  const batches = await getPendingBatches();
  batches.push({
    sessionId,
    points,
    createdAt: Date.now(),
  });
  await AsyncStorage.setItem(
    CONFIG.STORAGE_KEYS.PENDING_POINTS,
    JSON.stringify(batches)
  );
}

/** Remove the first N batches (after successful sync) */
export async function removePendingBatches(count: number): Promise<void> {
  const batches = await getPendingBatches();
  const remaining = batches.slice(count);
  await AsyncStorage.setItem(
    CONFIG.STORAGE_KEYS.PENDING_POINTS,
    JSON.stringify(remaining)
  );
}

/** Clear all pending batches */
export async function clearPendingBatches(): Promise<void> {
  await AsyncStorage.removeItem(CONFIG.STORAGE_KEYS.PENDING_POINTS);
}

/** Get the count of pending points across all batches */
export async function getPendingPointCount(): Promise<number> {
  const batches = await getPendingBatches();
  return batches.reduce((sum, batch) => sum + batch.points.length, 0);
}

/** Save active session info for recovery after app restart */
export async function saveActiveSession(data: {
  sessionId: number;
  eventId?: number;
  raceId?: number;
  startedAt: number;
}): Promise<void> {
  await AsyncStorage.setItem(
    CONFIG.STORAGE_KEYS.ACTIVE_SESSION,
    JSON.stringify(data)
  );
}

/** Get saved active session (for recovery) */
export async function getActiveSession(): Promise<{
  sessionId: number;
  eventId?: number;
  raceId?: number;
  startedAt: number;
} | null> {
  try {
    const data = await AsyncStorage.getItem(CONFIG.STORAGE_KEYS.ACTIVE_SESSION);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/** Clear active session data */
export async function clearActiveSession(): Promise<void> {
  await AsyncStorage.removeItem(CONFIG.STORAGE_KEYS.ACTIVE_SESSION);
}
