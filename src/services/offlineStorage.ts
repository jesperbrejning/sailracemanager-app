/**
 * Offline Storage Service
 *
 * Persists unsent GPS point batches to AsyncStorage (disk) so they survive
 * app restarts, crashes, and forced stops. Also saves active session metadata
 * for crash/restart recovery.
 *
 * Strategy:
 * - GPS point batches are stored in AsyncStorage under PENDING_POINTS key
 * - Max 2000 points total (oldest dropped when limit exceeded)
 * - Session metadata stored separately under ACTIVE_SESSION key
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CONFIG } from '../config';
import type { TrackingPoint } from '../types/tracking';

// ─── Pending batch persistence ────────────────────────────────────────────────

interface PendingBatch {
  sessionId: number;
  points: TrackingPoint[];
  createdAt: number;
}

/** Maximum number of points to persist when offline */
const MAX_OFFLINE_POINTS = 2000;

/** Add a batch of points to the persistent offline queue (disk) */
export async function addPendingBatch(
  sessionId: number,
  points: TrackingPoint[]
): Promise<void> {
  try {
    const existing = await getPendingBatches();
    let totalBuffered = existing.reduce((sum, b) => sum + b.points.length, 0);

    let batches = [...existing];

    // Drop oldest batches to make room if needed
    while (batches.length > 0 && totalBuffered + points.length > MAX_OFFLINE_POINTS) {
      const dropped = batches.shift();
      totalBuffered -= dropped?.points.length ?? 0;
    }

    batches.push({ sessionId, points, createdAt: Date.now() });
    await AsyncStorage.setItem(
      CONFIG.STORAGE_KEYS.PENDING_POINTS,
      JSON.stringify(batches)
    );
  } catch (err) {
    console.warn('[OfflineStorage] Failed to save pending batch:', err);
  }
}

/** Get all pending (unsent) GPS point batches from disk */
export async function getPendingBatches(): Promise<PendingBatch[]> {
  try {
    const data = await AsyncStorage.getItem(CONFIG.STORAGE_KEYS.PENDING_POINTS);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

/** Remove the first N batches (after successful sync) */
export async function removePendingBatches(count: number): Promise<void> {
  try {
    const existing = await getPendingBatches();
    const remaining = existing.slice(count);
    await AsyncStorage.setItem(
      CONFIG.STORAGE_KEYS.PENDING_POINTS,
      JSON.stringify(remaining)
    );
  } catch (err) {
    console.warn('[OfflineStorage] Failed to remove pending batches:', err);
  }
}

/** Clear all pending batches */
export async function clearPendingBatches(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CONFIG.STORAGE_KEYS.PENDING_POINTS);
  } catch (err) {
    console.warn('[OfflineStorage] Failed to clear pending batches:', err);
  }
}

/** Get the count of pending points across all batches */
export async function getPendingPointCount(): Promise<number> {
  const batches = await getPendingBatches();
  return batches.reduce((sum, batch) => sum + batch.points.length, 0);
}

// ─── Session recovery (AsyncStorage - small metadata only) ───────────────────

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
