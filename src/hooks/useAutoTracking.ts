/**
 * useAutoTracking Hook
 *
 * Polls tracking.myActiveEvents every 1 second and automatically:
 * - Starts GPS tracking when race-officer starts the timer (timerStartedAt set)
 * - Stops GPS tracking when race ends (timerEndedAt set)
 *
 * This mirrors the browser LiveTracking.tsx auto-tracking logic exactly.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { trpc } from '../services/trpc';

export interface ActiveRace {
  id: number;
  raceNumber: number;
  status: string;
  timerStartedAt: string | Date | null;
  timerEndedAt: string | Date | null;
}

export interface ActiveEvent {
  id: number;
  name: string;
  location: string | null;
  startProcedure: string;
  teamName: string;
  activeRace: ActiveRace | null;
}

interface UseAutoTrackingOptions {
  isAuthenticated: boolean;
  isTracking: boolean;
  startTracking: (opts?: { eventId?: number; raceId?: number; raceNumber?: number }) => Promise<void>;
  stopTracking: () => Promise<any>;
  onStopped?: (stats: any, sessionId: number | null) => void;
  sessionId: number | null;
}

export function useAutoTracking({
  isAuthenticated,
  isTracking,
  startTracking,
  stopTracking,
  onStopped,
  sessionId,
}: UseAutoTrackingOptions) {
  const autoStartedRef = useRef(false);
  const [selectedEventId, setSelectedEventId] = useState<number | undefined>();
  const [activeEvent, setActiveEvent] = useState<ActiveEvent | null>(null);

  // Poll myActiveEvents every 1 second (same as browser)
  const myActiveEventsQuery = trpc.tracking.myActiveEvents.useQuery(undefined, {
    enabled: isAuthenticated,
    refetchInterval: 1000,
    staleTime: 0,
  });

  const myEvents: ActiveEvent[] = (myActiveEventsQuery.data?.events ?? []) as ActiveEvent[];

  // Auto-select the event with an active race timer
  useEffect(() => {
    if (!isAuthenticated || myEvents.length === 0) {
      setSelectedEventId(undefined);
      setActiveEvent(null);
      return;
    }
    // Find event where race-officer has started the timer (and not ended it)
    const withActiveRace = myEvents.find(
      (e) => e.activeRace?.timerStartedAt && !e.activeRace?.timerEndedAt
    );
    if (withActiveRace) {
      setSelectedEventId(withActiveRace.id);
      setActiveEvent(withActiveRace);
    } else {
      // No active race – show the first event (for timer display) or null
      const firstEvent = myEvents[0] ?? null;
      setSelectedEventId(firstEvent?.id);
      setActiveEvent(firstEvent);
    }
  }, [myEvents, isAuthenticated]);

  // Derived active race from selected event
  const activeRace = activeEvent?.activeRace ?? null;

  // Auto-start/stop tracking (mirrors browser LiveTracking.tsx useEffect)
  useEffect(() => {
    if (activeRace) {
      const raceActive = activeRace.timerStartedAt && !activeRace.timerEndedAt;

      // Case 1: Race just became active – start tracking
      if (raceActive && !isTracking && !autoStartedRef.current) {
        autoStartedRef.current = true;
        startTracking({
          eventId: selectedEventId,
          raceId: activeRace.id,
          raceNumber: activeRace.raceNumber,
        });
      }

      // Case 2: Race ended (timerEndedAt set) – stop tracking
      if (activeRace.timerEndedAt && isTracking && autoStartedRef.current) {
        const sid = sessionId;
        stopTracking().then((stats) => {
          if (stats && onStopped) {
            onStopped(stats, sid);
          }
        });
        autoStartedRef.current = false;
      }
    } else {
      // Case 3: activeRace became null – race disappeared from poll
      // If we were auto-tracking, stop now
      if (isTracking && autoStartedRef.current) {
        const sid = sessionId;
        stopTracking().then((stats) => {
          if (stats && onStopped) {
            onStopped(stats, sid);
          }
        });
        autoStartedRef.current = false;
      }
    }
  }, [activeRace, isTracking]);

  return {
    myEvents,
    activeEvent,
    activeRace,
    selectedEventId,
    isAutoTracking: autoStartedRef.current,
    isLoading: myActiveEventsQuery.isLoading,
  };
}
