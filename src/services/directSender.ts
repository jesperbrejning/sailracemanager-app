/**
 * Direct HTTP Sender for Background GPS Tracking
 *
 * This module sends GPS points directly via fetch() without going through
 * React hooks or tRPC React Query. It is safe to call from:
 * - expo-task-manager background tasks (screen off)
 * - Any async context outside React component lifecycle
 *
 * Why this is needed:
 * - When the screen is off, React hooks (useMutation, etc.) are unreliable
 * - The background task runs in a separate JS context on Android
 * - Direct fetch() with the stored session cookie always works
 */
import * as SecureStore from 'expo-secure-store';
import superjson from 'superjson';
import { CONFIG } from '../config';
import type { TrackingPoint } from '../types/tracking';

const TRPC_URL = `${CONFIG.API_BASE_URL}${CONFIG.TRPC_ENDPOINT}`;

/**
 * Send a batch of GPS points directly to the server via fetch.
 * Does NOT require React hooks or tRPC client.
 * Safe to call from background tasks when screen is off.
 */
export async function sendPointsDirect(
  sessionId: number,
  points: TrackingPoint[]
): Promise<{ received: number; totalPoints: number }> {
  // Get session cookie from secure storage
  const cookie = await SecureStore.getItemAsync(CONFIG.STORAGE_KEYS.SESSION_COOKIE);
  if (!cookie) {
    throw new Error('No session cookie available');
  }

  // Build tRPC batch request body (superjson serialized)
  const input = superjson.serialize({
    sessionId,
    points: points.map(p => ({
      latitude: p.latitude,
      longitude: p.longitude,
      accuracy: p.accuracy,
      altitude: p.altitude,
      altitudeAccuracy: p.altitudeAccuracy,
      speed: p.speed,
      heading: p.heading,
      timestamp: p.timestamp,
    })),
  });

  const response = await fetch(`${TRPC_URL}/tracking.sendPoints`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': `${CONFIG.COOKIE_NAME}=${cookie}`,
    },
    body: JSON.stringify({
      json: input.json,
      meta: input.meta,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
  }

  const raw = await response.json();
  // tRPC response format: { result: { data: { json: ..., meta: ... } } }
  const result = raw?.result?.data;
  if (result) {
    const parsed = superjson.deserialize(result) as { received: number; totalPoints: number };
    return parsed;
  }

  // Fallback: return optimistic result
  return { received: points.length, totalPoints: 0 };
}

/**
 * Check if we have a valid session cookie (i.e., user is logged in).
 * Used by background task to decide whether to attempt sending.
 */
export async function hasValidSession(): Promise<boolean> {
  try {
    const cookie = await SecureStore.getItemAsync(CONFIG.STORAGE_KEYS.SESSION_COOKIE);
    return cookie !== null && cookie.length > 0;
  } catch {
    return false;
  }
}
