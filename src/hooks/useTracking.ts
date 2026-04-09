/**
 * useTracking Hook
 * 
 * Main tracking hook for the native app. Orchestrates:
 * - Background GPS tracking via expo-location
 * - Heel angle correction via DeviceMotion sensors
 * - Point batching and sending via tRPC
 * - Offline storage and sync
 * - UI state management
 * 
 * This is the React Native equivalent of the web's useGpsTracking hook,
 * but with proper background support via Android Foreground Service
 * and heel correction via gyroscope/accelerometer sensor fusion.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { CONFIG, MS_TO_KNOTS } from '../config';
import { trpc } from '../services/trpc';
import {
  startBackgroundTracking,
  stopBackgroundTracking,
  isBackgroundTrackingActive,
  requestLocationPermissions,
  forceFlush,
  updateSendCallback,
  updateLocationCallback,
  getTotalCollected,
} from '../services/backgroundTracking';
import {
  startHeelSensor,
  stopHeelSensor,
  getHeelAngle,
  getPitchAngle,
  getHDG,
  isHeelSensorActive,
  onAppBackground,
  onAppForeground,
} from '../services/heelCorrection';
import {
  saveActiveSession,
  clearActiveSession,
  getActiveSession,
  getPendingBatches,
  removePendingBatches,
} from '../services/offlineStorage';
import { haversineDistance } from '../utils/geo';
import type { TrackingPoint, TrackingState } from '../types/tracking';

const BATCH_FLUSH_INTERVAL_MS = CONFIG.GPS.BATCH_INTERVAL_MS;

export function useTracking() {
  const [state, setState] = useState<TrackingState>({
    isTracking: false,
    sessionId: null,
    pointsCollected: 0,
    pointsSent: 0,
    currentPosition: null,
    accuracy: null,
    speedKnots: null,
    distanceMeters: 0,
    error: null,
    gpsStatus: 'idle',
    duration: 0,
    heelAngle: 0,
    pitchAngle: 0,
    heelCorrectionActive: false,
    hdg: null,
    cog: null,
  });

  const [trackPoints, setTrackPoints] = useState<TrackingPoint[]>([]);

  // Refs for mutable state that doesn't trigger re-renders
  const sessionIdRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);
  const lastPositionRef = useRef<TrackingPoint | null>(null);
  const totalDistanceRef = useRef<number>(0);
  const pointCountRef = useRef<number>(0);
  const sentCountRef = useRef<number>(0);
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const heelUpdateTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const allPointsRef = useRef<TrackingPoint[]>([]);
  const isTrackingRef = useRef<boolean>(false);

  // tRPC mutations
  const startMutation = trpc.tracking.start.useMutation();
  const stopMutation = trpc.tracking.stop.useMutation();
  const sendPointsMutation = trpc.tracking.sendPoints.useMutation();

  /**
   * Send a batch of points to the backend via tRPC.
   */
  const sendPointsToServer = useCallback(
    async (sessionId: number, points: TrackingPoint[]): Promise<void> => {
      const result = await sendPointsMutation.mutateAsync({
        sessionId,
        points,
      });
      sentCountRef.current = result.totalPoints;
      setState((prev) => ({ ...prev, pointsSent: result.totalPoints }));
    },
    [sendPointsMutation]
  );

  /**
   * Handle a new location update from the background service.
   * Updates UI state (position, speed, distance).
   * Now includes heel angle data from the heel correction service.
   */
  const handleLocationUpdate = useCallback((point: TrackingPoint) => {
    if (!isTrackingRef.current) return;

    // Calculate speed
    let speedKnots: number | null = null;
    if (point.speed != null && point.speed >= 0) {
      speedKnots = parseFloat((point.speed * MS_TO_KNOTS).toFixed(1));
    }

    // Calculate distance from previous point
    const prevPos = lastPositionRef.current;
    if (prevPos) {
      const segmentDistance = haversineDistance(
        prevPos.latitude,
        prevPos.longitude,
        point.latitude,
        point.longitude
      );

      const currentAccuracy = point.accuracy ?? 9999;
      const prevAccuracy = prevPos.accuracy ?? 9999;

      // Only count distance if both points have reasonable accuracy
      if (
        currentAccuracy < CONFIG.GPS.MAX_ACCURACY_METERS &&
        prevAccuracy < CONFIG.GPS.MAX_ACCURACY_METERS &&
        segmentDistance < CONFIG.GPS.MAX_SEGMENT_DISTANCE_METERS
      ) {
        totalDistanceRef.current += segmentDistance;
      }

      // Fallback speed calculation
      if (speedKnots === null && prevPos.timestamp) {
        const timeDiffSec = (point.timestamp - prevPos.timestamp) / 1000;
        if (timeDiffSec > 0 && timeDiffSec < 120 && segmentDistance > 0) {
          const speedMs = segmentDistance / timeDiffSec;
          speedKnots = parseFloat((speedMs * MS_TO_KNOTS).toFixed(1));
        }
      }
    }

    lastPositionRef.current = point;
    pointCountRef.current += 1;

    // Update track points array
    allPointsRef.current = [...allPointsRef.current, point];
    setTrackPoints(allPointsRef.current);

    setState((prev) => ({
      ...prev,
      isTracking: true,
      gpsStatus: 'active',
      currentPosition: point,
      accuracy: point.accuracy ?? null,
      speedKnots,
      pointsCollected: getTotalCollected(), // Use global counter (foreground + background)
      distanceMeters: Math.round(totalDistanceRef.current),
      error: null,
      // Update heel data from the point (which was corrected in backgroundTracking)
      heelAngle: point.heelAngle ?? prev.heelAngle,
      pitchAngle: point.pitchAngle ?? prev.pitchAngle,
      // COG comes directly from GPS heading field (already ground-referenced)
      cog: (point.cog != null)
        ? point.cog
        : (point.heading != null && point.heading >= 0 ? point.heading : prev.cog),
      // HDG is updated separately by the heel update timer, but also refresh here
      hdg: getHDG() ?? prev.hdg,
    }));
  }, []);

  /**
   * Sync any pending offline batches to the server.
   */
  const syncPendingBatches = useCallback(async () => {
    const batches = await getPendingBatches();
    if (batches.length === 0) return;

    let synced = 0;
    for (const batch of batches) {
      try {
        await sendPointsMutation.mutateAsync({
          sessionId: batch.sessionId,
          points: batch.points,
        });
        synced++;
      } catch {
        break; // Stop trying if one fails (likely offline)
      }
    }

    if (synced > 0) {
      await removePendingBatches(synced);
    }
  }, [sendPointsMutation]);

  /**
   * Start GPS tracking for a race/event.
   * Now also starts the heel correction sensor.
   */
  const startTracking = useCallback(
    async (options?: {
      eventId?: number;
      raceId?: number;
      raceNumber?: number;
    }) => {
      // Reset state
      lastPositionRef.current = null;
      totalDistanceRef.current = 0;
      pointCountRef.current = 0;
      sentCountRef.current = 0;
      allPointsRef.current = [];
      setTrackPoints([]);

      setState((prev) => ({
        ...prev,
        gpsStatus: 'acquiring',
        error: null,
        pointsCollected: 0,
        pointsSent: 0,
        distanceMeters: 0,
        speedKnots: null,
        duration: 0,
        heelAngle: 0,
        pitchAngle: 0,
        heelCorrectionActive: false,
        hdg: null,
        cog: null,
      }));

      try {
        // Request permissions
        const permissions = await requestLocationPermissions();
        if (!permissions.foreground) {
          setState((prev) => ({
            ...prev,
            error: 'Location permission denied. Please enable in Settings.',
            gpsStatus: 'denied',
          }));
          return;
        }

        if (!permissions.background) {
          // Background location denied - the backgroundTracking service
          // already showed an alert with "Open Settings" option.
          // Continue with foreground-only tracking.
          setState((prev) => ({
            ...prev,
            error: null, // Don't show error banner - alert was already shown
            gpsStatus: 'acquiring',
          }));
        }

        // Start heel correction sensor (non-blocking - if it fails, GPS still works)
        const heelStarted = await startHeelSensor();
        if (heelStarted) {
          console.log('[Tracking] Heel correction sensor started');
        } else {
          console.warn('[Tracking] Heel correction unavailable - tracking without correction');
        }

        // Create session on backend
        const deviceInfo = `${Platform.OS} ${Platform.Version} - SailRaceManager App${heelStarted ? ' (heel correction)' : ''}`;
        const { sessionId } = await startMutation.mutateAsync({
          eventId: options?.eventId,
          raceId: options?.raceId,
          raceNumber: options?.raceNumber,
          deviceInfo,
        });

        sessionIdRef.current = sessionId;
        isTrackingRef.current = true;
        startTimeRef.current = Date.now();

        // Save session for recovery
        await saveActiveSession({
          sessionId,
          eventId: options?.eventId,
          raceId: options?.raceId,
          startedAt: Date.now(),
        });

        // Start background GPS tracking
        await startBackgroundTracking(
          sessionId,
          sendPointsToServer,
          handleLocationUpdate
        );

        // Start periodic flush timer
        flushTimerRef.current = setInterval(async () => {
          await forceFlush();
          await syncPendingBatches();
        }, BATCH_FLUSH_INTERVAL_MS);

        // Start duration timer
        durationTimerRef.current = setInterval(() => {
          if (startTimeRef.current) {
            setState((prev) => ({
              ...prev,
              duration: Math.floor(
                (Date.now() - startTimeRef.current!) / 1000
              ),
            }));
          }
        }, 1000);

        // Start heel angle UI update timer (updates heel + HDG display at 2Hz)
        if (heelStarted) {
          heelUpdateTimerRef.current = setInterval(() => {
            setState((prev) => ({
              ...prev,
              heelAngle: parseFloat(getHeelAngle().toFixed(1)),
              pitchAngle: parseFloat(getPitchAngle().toFixed(1)),
              heelCorrectionActive: isHeelSensorActive(),
              hdg: getHDG(),
            }));
          }, 500);
        }

        setState((prev) => ({
          ...prev,
          isTracking: true,
          sessionId,
          heelCorrectionActive: heelStarted,
        }));
      } catch (err) {
        isTrackingRef.current = false;
        stopHeelSensor(); // Clean up sensor if tracking failed
        const errorMsg =
          err instanceof Error ? err.message : 'Failed to start tracking';
        setState((prev) => ({ ...prev, error: errorMsg, gpsStatus: 'error' }));
      }
    },
    [
      startMutation,
      sendPointsToServer,
      handleLocationUpdate,
      syncPendingBatches,
    ]
  );

  /**
   * Stop GPS tracking and finalize the session.
   * Also stops the heel correction sensor.
   */
  const stopTracking = useCallback(async () => {
    isTrackingRef.current = false;

    // Stop timers
    if (flushTimerRef.current) {
      clearInterval(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (heelUpdateTimerRef.current) {
      clearInterval(heelUpdateTimerRef.current);
      heelUpdateTimerRef.current = null;
    }

    // Stop heel correction sensor
    stopHeelSensor();

    // Stop background tracking (flushes remaining points)
    await stopBackgroundTracking();

    // Sync any remaining offline batches
    await syncPendingBatches();

    // Stop session on backend
    let stats = null;
    if (sessionIdRef.current) {
      try {
        const result = await stopMutation.mutateAsync({
          sessionId: sessionIdRef.current,
        });
        stats = result.stats;
      } catch (err) {
        console.error('[Tracking] Failed to stop session:', err);
      }
    }

    // Clear saved session
    await clearActiveSession();

    // Reset refs
    sessionIdRef.current = null;
    startTimeRef.current = null;
    lastPositionRef.current = null;

    setState((prev) => ({
      ...prev,
      isTracking: false,
      sessionId: null,
      gpsStatus: 'idle',
      currentPosition: null,
      heelAngle: 0,
      pitchAngle: 0,
      heelCorrectionActive: false,
    }));

    return stats;
  }, [stopMutation, syncPendingBatches]);

  /**
   * Recover from an active session after app restart.
   */
  const recoverSession = useCallback(async () => {
    const saved = await getActiveSession();
    if (!saved) return false;

    // Check if background tracking is still running
    const isActive = await isBackgroundTrackingActive();
    if (isActive) {
      // Reconnect to the running session
      sessionIdRef.current = saved.sessionId;
      isTrackingRef.current = true;
      startTimeRef.current = saved.startedAt;

      // Update callbacks
      updateSendCallback(sendPointsToServer);
      updateLocationCallback(handleLocationUpdate);

      // Restart heel sensor (it was lost when app was killed)
      const heelStarted = await startHeelSensor();

      // Restart timers
      flushTimerRef.current = setInterval(async () => {
        await forceFlush();
        await syncPendingBatches();
      }, BATCH_FLUSH_INTERVAL_MS);

      durationTimerRef.current = setInterval(() => {
        if (startTimeRef.current) {
          setState((prev) => ({
            ...prev,
            duration: Math.floor(
              (Date.now() - startTimeRef.current!) / 1000
            ),
          }));
        }
      }, 1000);

      // Restart heel UI update timer
      if (heelStarted) {
        heelUpdateTimerRef.current = setInterval(() => {
          setState((prev) => ({
            ...prev,
            heelAngle: parseFloat(getHeelAngle().toFixed(1)),
            pitchAngle: parseFloat(getPitchAngle().toFixed(1)),
            heelCorrectionActive: isHeelSensorActive(),
            hdg: getHDG(),
          }));
        }, 500);
      }

      setState((prev) => ({
        ...prev,
        isTracking: true,
        sessionId: saved.sessionId,
        gpsStatus: 'active',
        duration: Math.floor((Date.now() - saved.startedAt) / 1000),
        heelCorrectionActive: heelStarted,
      }));

      return true;
    }

    // Session was saved but tracking stopped (app was killed)
    // Clean up the orphaned session
    await clearActiveSession();
    return false;
  }, [sendPointsToServer, handleLocationUpdate, syncPendingBatches]);

  // Handle app state changes (foreground/background)
  // Now also manages heel sensor foreground/background transitions
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && isTrackingRef.current) {
        // App came to foreground - reconnect callbacks and resume heel sensor
        updateLocationCallback(handleLocationUpdate);
        onAppForeground();
        // Sync any pending batches
        syncPendingBatches().catch(() => {});
      } else if (nextState === 'background') {
        // App going to background - clear foreground callback
        // Background task will continue collecting points
        // Heel sensor will use decay mode
        updateLocationCallback(null);
        onAppBackground();
      }
    });

    return () => subscription.remove();
  }, [handleLocationUpdate, syncPendingBatches]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearInterval(flushTimerRef.current);
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      if (heelUpdateTimerRef.current) clearInterval(heelUpdateTimerRef.current);
      stopHeelSensor();
    };
  }, []);

  return {
    ...state,
    trackPoints,
    startTracking,
    stopTracking,
    recoverSession,
    syncPendingBatches,
  };
}
