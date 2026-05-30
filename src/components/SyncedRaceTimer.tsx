/**
 * SyncedRaceTimer Component
 *
 * Mirrors the race-officer's RaceStartTimer on the sailor's phone.
 * Shows the same phase label, countdown, progress bar and signal milestones.
 *
 * This is the React Native equivalent of the browser's SyncedRaceTimer
 * in LiveTracking.tsx – visually and functionally identical.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';

// Procedure-specific countdown lengths (mirrors browser LiveTracking.tsx)
const PROCEDURE_TOTAL_SECONDS: Record<string, number> = {
  standard: 360, // 6-5-4-1-0 → 6 minutes
  short: 240,    // 4-3-2-1-0 → 4 minutes
};

interface SyncSignal {
  timeSeconds: number;
  label: string;
}

const STANDARD_SYNC_SIGNALS: SyncSignal[] = [
  { timeSeconds: 360, label: '6:00' },
  { timeSeconds: 300, label: '5:00' },
  { timeSeconds: 240, label: '4:00' },
  { timeSeconds: 60,  label: '1:00' },
  { timeSeconds: 0,   label: '0:00' },
];

const SHORT_SYNC_SIGNALS: SyncSignal[] = [
  { timeSeconds: 240, label: '4:00' },
  { timeSeconds: 180, label: '3:00' },
  { timeSeconds: 120, label: '2:00' },
  { timeSeconds: 60,  label: '1:00' },
  { timeSeconds: 0,   label: '0:00' },
];

function getSyncSignals(procedure: string): SyncSignal[] {
  return procedure === 'short' ? SHORT_SYNC_SIGNALS : STANDARD_SYNC_SIGNALS;
}

function getSyncProcedureLabel(procedure: string): string {
  return procedure === 'short' ? '4-3-2-1-0' : '6-5-4-1-0';
}

function getSyncPhaseLabel(remainingSec: number, procedure: string): string {
  if (remainingSec <= 0) return 'START';
  if (procedure === 'standard') {
    if (remainingSec > 300) return 'ADVARSELSSIGNAL';
    if (remainingSec > 240) return 'FORBEREDELSESSIGNAL';
    if (remainingSec > 60)  return 'MELLEMSIGNAL';
    return 'ET-MINUT SIGNAL';
  } else {
    if (remainingSec > 180) return 'ADVARSELSSIGNAL';
    if (remainingSec > 120) return 'FORBEREDELSESSIGNAL';
    if (remainingSec > 60)  return 'MELLEMSIGNAL';
    return 'ET-MINUT SIGNAL';
  }
}

function getSyncPhaseColor(remainingSec: number, procedure: string, isPostStart: boolean): string {
  if (isPostStart) return '#059669'; // emerald-600
  if (remainingSec <= 0) return '#10b981'; // emerald-500
  if (procedure === 'standard') {
    if (remainingSec > 300) return '#e8380d'; // warning red
    if (remainingSec > 240) return '#f59e0b'; // amber
    if (remainingSec > 60)  return '#f97316'; // orange
    return '#ef4444'; // red
  } else {
    if (remainingSec > 180) return '#e8380d';
    if (remainingSec > 120) return '#f59e0b';
    if (remainingSec > 60)  return '#f97316';
    return '#ef4444';
  }
}

interface SyncedRaceTimerProps {
  timerStartedAt: string | Date;
  raceNumber: number;
  startProcedure?: string;
}

export default function SyncedRaceTimer({
  timerStartedAt,
  raceNumber,
  startProcedure = 'standard',
}: SyncedRaceTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 250); // 250ms for smooth display
    return () => clearInterval(interval);
  }, []);

  const totalSeconds = PROCEDURE_TOTAL_SECONDS[startProcedure] ?? 360;
  const startMs = timerStartedAt instanceof Date
    ? timerStartedAt.getTime()
    : new Date(timerStartedAt).getTime();
  const goMs = startMs + totalSeconds * 1000;
  const msUntilGo = goMs - now;
  const remainingSec = Math.ceil(msUntilGo / 1000);
  const isPreStart = remainingSec > 0;
  const isPostStart = remainingSec <= 0;

  // Display time
  const displaySec = isPreStart ? remainingSec : Math.abs(remainingSec);
  const dispMin = Math.floor(displaySec / 60);
  const dispSecRem = displaySec % 60;
  const timeStr = `${dispMin}:${dispSecRem.toString().padStart(2, '0')}`;

  // Progress bar (0% = just started countdown, 100% = GO)
  const progress = Math.min(100, Math.max(0, ((totalSeconds - remainingSec) / totalSeconds) * 100));

  const bgColor = getSyncPhaseColor(remainingSec, startProcedure, isPostStart);
  const phaseLabel = isPostStart ? 'RACE I GANG' : getSyncPhaseLabel(remainingSec, startProcedure);
  const signals = getSyncSignals(startProcedure);

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.headerTitle}>
            {isPostStart ? 'STOPWATCH' : 'STARTTIMER'}
          </Text>
          {!isPostStart && (
            <Text style={styles.procedureLabel}>
              {getSyncProcedureLabel(startProcedure)}
            </Text>
          )}
        </View>
        <Text style={styles.raceLabel}>Race {raceNumber}</Text>
      </View>

      {/* Phase label */}
      <Text style={styles.phaseLabel}>{phaseLabel}</Text>

      {/* Main time display */}
      <View style={styles.timeContainer}>
        {remainingSec === 0 && !isPostStart ? (
          <Text style={styles.goText}>GO!</Text>
        ) : (
          <Text style={styles.timeText}>{timeStr}</Text>
        )}
      </View>

      {/* Progress bar */}
      <View style={styles.progressBar}>
        <View style={[styles.progressFill, { width: `${progress}%` as any }]} />
      </View>

      {/* Signal milestones */}
      <View style={styles.signalsRow}>
        {signals.map((signal) => {
          const isPassed = remainingSec <= signal.timeSeconds;
          return (
            <View key={signal.timeSeconds} style={styles.signalItem}>
              <View style={[styles.signalDot, isPassed && styles.signalDotPassed]} />
              <Text style={[styles.signalLabel, isPassed && styles.signalLabelPassed]}>
                {signal.label}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Auto-tracking status */}
      <View style={styles.autoTrackRow}>
        <View style={[styles.autoTrackDot, isPostStart ? styles.autoTrackDotActive : styles.autoTrackDotPending]} />
        <Text style={styles.autoTrackText}>
          {isPostStart
            ? '🏁 Race i gang – GPS tracker automatisk'
            : 'GPS tracking starter automatisk ved start'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    overflow: 'hidden',
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  procedureLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.75)',
    marginLeft: 6,
  },
  raceLabel: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.65)',
  },
  phaseLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.9)',
    textAlign: 'center',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  timeContainer: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  timeText: {
    fontSize: 72,
    fontWeight: '900',
    color: '#ffffff',
    fontVariant: ['tabular-nums'],
    letterSpacing: -2,
    lineHeight: 80,
  },
  goText: {
    fontSize: 72,
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: -2,
    lineHeight: 80,
  },
  progressBar: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 12,
  },
  progressFill: {
    height: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 3,
  },
  signalsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  signalItem: {
    alignItems: 'center',
    gap: 4,
  },
  signalDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  signalDotPassed: {
    backgroundColor: '#ffffff',
    borderColor: '#ffffff',
  },
  signalLabel: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.55)',
    fontVariant: ['tabular-nums'],
  },
  signalLabelPassed: {
    color: '#ffffff',
    fontWeight: '600',
  },
  autoTrackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.2)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 8,
  },
  autoTrackDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  autoTrackDotActive: {
    backgroundColor: '#4ade80',
  },
  autoTrackDotPending: {
    backgroundColor: '#facc15',
  },
  autoTrackText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.85)',
    flex: 1,
  },
});
