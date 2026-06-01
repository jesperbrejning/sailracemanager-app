/**
 * Offline Storage Service
 *
 * Minimal persistence: only saves the active session metadata for
 * crash/restart recovery. GPS points are NOT stored on disk - they
 * are sent directly to the server. If the server is unreachable,
 * points are held in a small in-memory buffer only (no disk writes).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CONFIG } from '../config';
import type { TrackingPoint } from '../types/tracking';

// ─── In-memory offline buffer (replaces disk-based pending batches) ──────────

interface PendingBatch {
  sessionId: number;
  points: TrackingPoint[];
  createdAt: number;
}

/** Maximum number of points to hold in memory when offline */
const MAX_OFFLINE_POINTS = 500;

let memoryBatches: PendingBatch[] = [];

/** Add a batch of points to the in-memory offline queue */
export async function addPendingBatch(
  sessionId: number,
  points: TrackingPoint[]
): Promise<void> {
  const totalBuffered = memoryBatches.reduce((sum, b) => sum + b.points.length, 0);

  if (totalBuffered + points.length > MAX_OFFLINE_POINTS) {
    // Drop oldest batch to make room (prefer keeping newest data)
    if (memoryBatches.length > 0) {
      memoryBatches.shift();
    }
  }

  memoryBatches.push({ sessionId, points, createdAt: Date.now() });
}

/** Get all pending (unsent) GPS point batches from memory */
export async function getPendingBatches(): Promise<PendingBatch[]> {
  return [...memoryBatches];
}

/** Remove the first N batches (after successful sync) */
export async function removePendingBatches(count: number): Promise<void> {
  memoryBatches = memoryBatches.slice(count);
}

/** Clear all pending batches */
export async function clearPendingBatches(): Promise<void> {
  memoryBatches = [];
}

/** Get the count of pending points across all batches */
export async function getPendingPointCount(): Promise<number> {
  return memoryBatches.reduce((sum, batch) => sum + batch.points.length, 0);
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
  // Also clear any leftover pending points key from old versions
  await AsyncStorage.removeItem(CONFIG.STORAGE_KEYS.PENDING_POINTS);
}
