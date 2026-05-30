/**
 * Active Tracking Screen
 * 
 * The main tracking interface showing:
 * - Synchronized Race Timer (same as browser LiveTracking.tsx)
 * - Auto start/stop tracking when race-officer starts/stops the timer
 * - Live map with GPS trail (WebView + Leaflet/OpenStreetMap)
 * - Speed gauge (knots)
 * - Distance traveled
 * - Duration timer
 * - Points collected/sent status
 * - Manual Start/Stop controls (fallback)
 * 
 * Auto-tracking logic mirrors browser LiveTracking.tsx exactly:
 * - Polls tracking.myActiveEvents every 1 second
 * - Starts GPS when timerStartedAt is set
 * - Stops GPS when timerEndedAt is set
 */

import React, { useState, useCallback, useMemo } from 'react';
import { MagDebugLogger } from '../services/magDebugLogger';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  SafeAreaView,
  StatusBar,
  ScrollView,
} from 'react-native';
import { useTracking } from '../hooks/useTracking';
import { useAutoTracking } from '../hooks/useAutoTracking';
import { useAuth } from '../hooks/useAuth';
import { formatDuration, formatSpeed, formatDistance } from '../utils/geo';
import WebViewMap from '../components/WebViewMap';
import SyncedRaceTimer from '../components/SyncedRaceTimer';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
  onShowEventList?: () => void; // Optional: called when user wants to see event list
};

/** Convert degrees to cardinal direction */
function degreesToCardinal(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  const normalised = deg % 360;
  const idx = Math.round(((normalised % 360) + 360) % 360 / 22.5) % 16;
  return dirs[idx];
}

/** Normalise GPS COG to nautical convention: 1-360 (0 shown as 360) */
function normaliseCOG(deg: number): number {
  const n = ((deg % 360) + 360) % 360;
  return n === 0 ? 360 : n;
}

export default function ActiveTrackingScreen({ navigation, route, onShowEventList }: Props) {
  const routeParams = (route?.params ?? {}) as { eventId?: number; eventName?: string };
  const eventId = routeParams.eventId;
  const routeEventName = routeParams.eventName ?? '';

  const { isAuthenticated } = useAuth();

  const {
    isTracking,
    sessionId,
    pointsCollected,
    pointsSent,
    currentPosition,
    accuracy,
    speedKnots,
    distanceMeters,
    error,
    gpsStatus,
    duration,
    heelAngle,
    pitchAngle,
    heelCorrectionActive,
    hdg,
    cog,
    trackPoints,
    startTracking,
    stopTracking,
    recoverSession,
  } = useTracking();

  const [showStats, setShowStats] = useState(false);
  const [finalStats, setFinalStats] = useState<any>(null);

  // Auto-tracking: polls myActiveEvents and auto starts/stops GPS
  const autoTracking = useAutoTracking({
    isAuthenticated: isAuthenticated ?? false,
    isTracking,
    startTracking,
    stopTracking,
    sessionId,
    onStopped: (stats, _sid) => {
      if (stats) {
        setFinalStats(stats);
        setShowStats(true);
      }
    },
  });

  // Try to recover an existing session on mount
  React.useEffect(() => {
    recoverSession();
  }, []);

  // Build polyline coordinates from track points
  const polylineCoords = useMemo(
    () =>
      trackPoints.map((p) => ({
        latitude: p.latitude,
        longitude: p.longitude,
      })),
    [trackPoints]
  );

  const handleStart = useCallback(async () => {
    await startTracking({ eventId });
  }, [startTracking, eventId]);

  const handleStop = useCallback(async () => {
    Alert.alert(
      'Stop Tracking',
      'Are you sure you want to stop tracking? Your session will be saved.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: async () => {
            const stats = await stopTracking();
            if (stats) {
              setFinalStats(stats);
              setShowStats(true);
            }
          },
        },
      ]
    );
  }, [stopTracking]);

  const handleDismissStats = useCallback(() => {
    setShowStats(false);
    setFinalStats(null);
    // Only go back if we're in a stack (not embedded in a tab)
    if (!onShowEventList) {
      navigation.goBack();
    }
  }, [navigation, onShowEventList]);

  // GPS status indicator color
  const gpsColor =
    gpsStatus === 'active'
      ? '#4ade80'
      : gpsStatus === 'acquiring'
        ? '#facc15'
        : gpsStatus === 'error' || gpsStatus === 'denied'
          ? '#ef4444'
          : '#64748b';

  // Active race from auto-tracking
  const activeRace = autoTracking.activeRace;
  const activeEvent = autoTracking.activeEvent;
  const startProcedure = activeEvent?.startProcedure ?? 'standard';

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a1628" />

      {/* Header */}
      <View style={styles.header}>
        {/* Back/menu button – hidden when used as tab (onShowEventList present) */}
        {!onShowEventList && (
          <TouchableOpacity
            onPress={() => {
              if (isTracking) {
                Alert.alert(
                  'Tracking Active',
                  'Tracking will continue in the background if you leave this screen.'
                );
              } else {
                navigation.goBack();
              }
            }}
            style={styles.backButton}
          >
            <Text style={styles.backButtonText}>←</Text>
          </TouchableOpacity>
        )}
        {onShowEventList && <View style={styles.backButton} />}
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {(activeEvent?.name ?? routeEventName) || 'SailRaceManager'}
          </Text>
          <View style={styles.gpsIndicator}>
            <View style={[styles.gpsDot, { backgroundColor: gpsColor }]} />
            <Text style={styles.gpsText}>
              {gpsStatus === 'active'
                ? 'GPS Active'
                : gpsStatus === 'acquiring'
                  ? 'Acquiring GPS...'
                  : gpsStatus === 'denied'
                    ? 'GPS Denied'
                    : gpsStatus === 'error'
                      ? 'GPS Error'
                      : 'GPS Idle'}
            </Text>
          </View>
        </View>
        <View style={styles.headerRight} />
      </View>

      <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
        {/* Synchronized Race Timer – shown when there is an active race timer */}
        {activeRace?.timerStartedAt && (
          <SyncedRaceTimer
            timerStartedAt={activeRace.timerStartedAt}
            raceNumber={activeRace.raceNumber}
            startProcedure={startProcedure}
          />
        )}

        {/* No active race – show waiting message */}
        {!activeRace?.timerStartedAt && activeEvent && (
          <View style={styles.waitingBanner}>
            <Text style={styles.waitingIcon}>⏳</Text>
            <View style={styles.waitingContent}>
              <Text style={styles.waitingTitle}>{activeEvent.name}</Text>
              <Text style={styles.waitingSubtitle}>
                GPS tracking starter automatisk når race-officeren starter timeren
              </Text>
            </View>
          </View>
        )}

        {/* No events at all – prompt to register */}
        {!autoTracking.isLoading && autoTracking.myEvents.length === 0 && (
          <View style={styles.waitingBanner}>
            <Text style={styles.waitingIcon}>⛵</Text>
            <View style={styles.waitingContent}>
              <Text style={styles.waitingTitle}>Ingen tilmeldte events</Text>
              <Text style={styles.waitingSubtitle}>
                {'Tilmeld dig et event på sailracemanager.com for at se det her.\nDu kan altid bruge Free Sailing nedenfor.'}
              </Text>
            </View>
          </View>
        )}

        {/* Map - WebView with Leaflet/OpenStreetMap */}
        <View style={styles.mapContainer}>
          <WebViewMap
            currentPosition={currentPosition}
            accuracy={accuracy}
            trackPoints={polylineCoords}
            style={styles.map}
          />
        </View>

        {/* Stats Dashboard */}
        <View style={styles.dashboard}>
          {/* Speed */}
          <View style={styles.statRow}>
            <View style={styles.statPrimary}>
              <Text style={styles.statValue}>
                {formatSpeed(speedKnots)}
              </Text>
              <Text style={styles.statUnit}>kn</Text>
            </View>
            <View style={styles.statSecondary}>
              <Text style={styles.statLabel}>SPEED</Text>
            </View>
          </View>

          {/* Distance and Duration */}
          <View style={styles.statGrid}>
            <View style={styles.statCell}>
              <Text style={styles.statCellValue}>
                {formatDistance(distanceMeters)}
              </Text>
              <Text style={styles.statCellLabel}>DISTANCE</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statCellValue}>
                {formatDuration(duration)}
              </Text>
              <Text style={styles.statCellLabel}>DURATION</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Text style={styles.statCellValue}>
                {accuracy ? `${Math.round(accuracy)}m` : '--'}
              </Text>
              <Text style={styles.statCellLabel}>ACCURACY</Text>
            </View>
          </View>

          {/* HDG & COG Row */}
          {(() => {
            const hdgDisplay = hdg != null ? (hdg === 0 ? 360 : hdg) : null;
            const cogDisplay = cog != null ? normaliseCOG(cog) : null;
            const hdgRotate = hdg ?? 0;
            const cogRotate = cog ?? 0;
            return (
              <View style={styles.courseRow}>
                <View style={styles.courseCell}>
                  <Text style={styles.courseCellValue}>
                    {hdgDisplay != null ? `${Math.round(hdgDisplay)}°` : '--'}
                  </Text>
                  <Text style={styles.courseCellLabel}>HDG</Text>
                  {hdgDisplay != null && (
                    <Text style={styles.courseCardinal}>
                      {degreesToCardinal(hdgDisplay)}
                    </Text>
                  )}
                </View>
                <View style={styles.courseDivider} />
                <View style={styles.courseCompassContainer}>
                  <View style={[styles.courseCompassNeedle, {
                    transform: [{ rotate: `${hdgRotate}deg` }],
                    opacity: hdgDisplay != null ? 1 : 0.2,
                  }]} />
                  <View style={[styles.courseCompassCOG, {
                    transform: [{ rotate: `${cogRotate}deg` }],
                    opacity: cogDisplay != null ? 1 : 0.2,
                  }]} />
                </View>
                <View style={styles.courseDivider} />
                <View style={styles.courseCell}>
                  <Text style={styles.courseCellValue}>
                    {cogDisplay != null ? `${Math.round(cogDisplay)}°` : '--'}
                  </Text>
                  <Text style={styles.courseCellLabel}>COG</Text>
                  {cogDisplay != null && (
                    <Text style={styles.courseCardinal}>
                      {degreesToCardinal(cogDisplay)}
                    </Text>
                  )}
                </View>
              </View>
            );
          })()}

          {/* Heel Angle Display */}
          {heelCorrectionActive && (
            <View style={styles.heelRow}>
              <View style={styles.heelIndicator}>
                <View style={styles.heelBarContainer}>
                  <View style={[
                    styles.heelBar,
                    {
                      width: `${Math.min(Math.abs(heelAngle) * 2, 100)}%`,
                      backgroundColor: Math.abs(heelAngle) > 25 ? '#ef4444' : Math.abs(heelAngle) > 15 ? '#f59e0b' : '#4ade80',
                      alignSelf: heelAngle >= 0 ? 'flex-end' : 'flex-start',
                    },
                  ]} />
                </View>
                <Text style={styles.heelValue}>
                  {Math.abs(heelAngle).toFixed(1)}°{heelAngle >= 0 ? ' SB' : ' PS'}
                </Text>
              </View>
              <Text style={styles.heelLabel}>HEEL{heelAngle !== 0 && (heelAngle > 0 ? ' (Starboard)' : ' (Port)')}</Text>
            </View>
          )}

          {/* Points status */}
          <View style={styles.pointsRow}>
            <Text style={styles.pointsText}>
              📍 {pointsCollected} collected · {pointsSent} sent
            </Text>
            {pointsCollected > pointsSent + 10 && (
              <Text style={styles.pendingText}>⏳ Syncing...</Text>
            )}
          </View>

          {/* Error message */}
          {error && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorBannerText}>{error}</Text>
            </View>
          )}

          {/* Manual Start/Stop Button (fallback when no auto-tracking event) */}
          <View style={styles.controlRow}>
            {!isTracking ? (
              <TouchableOpacity
                style={styles.startButton}
                onPress={handleStart}
                activeOpacity={0.7}
              >
                <Text style={styles.startButtonText}>▶ Start Tracking</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={styles.stopButton}
                onPress={handleStop}
                activeOpacity={0.7}
              >
                <Text style={styles.stopButtonText}>⬛ Stop Tracking</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Auto-tracking status note */}
          {activeRace?.timerStartedAt && (
            <View style={styles.autoNote}>
              <Text style={styles.autoNoteText}>
                🤖 GPS tracking styres automatisk af race-timeren
              </Text>
            </View>
          )}

          {/* Free Sailing shortcut */}
          {!isTracking && (
            <TouchableOpacity
              style={styles.freeSailButton}
              onPress={async () => {
                await startTracking({ eventId: undefined });
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.freeSailButtonText}>⛵ Start Free Sailing</Text>
            </TouchableOpacity>
          )}

          {/* Magnetometer Debug Tools */}
          <View style={styles.debugRow}>
            <TouchableOpacity
              style={[styles.debugButton, MagDebugLogger.isActive && styles.debugButtonActive]}
              onPress={() => {
                if (MagDebugLogger.isActive) {
                  const rows = MagDebugLogger.rowCount;
                  void MagDebugLogger.stop().then(() => {
                    Alert.alert('Debug Log', `Logging stoppet.\n${rows} rækker gemt.\nTryk 'Send log' for at sende filen.`);
                  });
                } else {
                  void MagDebugLogger.start().then(() => {
                    Alert.alert('Debug Log', 'Magnetometer logging startet!\n\nDrej telefonen LANGSOMT 360° (tag 30-60 sek).\nTryk derefter \'Stop mag-log\'.');
                  });
                }
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.debugButtonText}>
                {MagDebugLogger.isActive ? '⏹ Stop mag-log' : '📝 Start mag-log'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.debugButton}
              onPress={() => void MagDebugLogger.share()}
              activeOpacity={0.7}
            >
              <Text style={styles.debugButtonText}>📤 Send log</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* Final Stats Modal */}
      {showStats && finalStats && (
        <View style={styles.statsOverlay}>
          <View style={styles.statsModal}>
            <Text style={styles.statsTitle}>Session Complete 🏁</Text>

            <View style={styles.statsGrid2}>
              <View style={styles.statsItem}>
                <Text style={styles.statsItemValue}>
                  {finalStats.totalPoints}
                </Text>
                <Text style={styles.statsItemLabel}>GPS Points</Text>
              </View>
              <View style={styles.statsItem}>
                <Text style={styles.statsItemValue}>
                  {formatDistance(finalStats.totalDistanceMeters)}
                </Text>
                <Text style={styles.statsItemLabel}>Distance</Text>
              </View>
              <View style={styles.statsItem}>
                <Text style={styles.statsItemValue}>
                  {finalStats.avgSpeedKnots} kn
                </Text>
                <Text style={styles.statsItemLabel}>Avg Speed</Text>
              </View>
              <View style={styles.statsItem}>
                <Text style={styles.statsItemValue}>
                  {finalStats.maxSpeedKnots} kn
                </Text>
                <Text style={styles.statsItemLabel}>Max Speed</Text>
              </View>
            </View>

            <Text style={styles.statsNote}>
              Your sailing activity has been automatically created on
              SailRaceManager.
            </Text>

            <TouchableOpacity
              style={styles.statsDismissButton}
              onPress={handleDismissStats}
            >
              <Text style={styles.statsDismissText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a1628',
  },
  scrollView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#0a1628',
  },
  backButton: {
    padding: 8,
  },
  backButtonText: {
    fontSize: 24,
    color: '#ffffff',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    maxWidth: 220,
  },
  gpsIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  gpsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  gpsText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  headerRight: {
    width: 40,
  },
  waitingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#162d4d',
    marginHorizontal: 16,
    marginVertical: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3d66',
    gap: 12,
  },
  waitingIcon: {
    fontSize: 24,
  },
  waitingContent: {
    flex: 1,
  },
  waitingTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 2,
  },
  waitingSubtitle: {
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 16,
  },
  mapContainer: {
    height: 220,
    marginHorizontal: 16,
    marginVertical: 8,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e3d66',
  },
  map: {
    flex: 1,
  },
  dashboard: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  statPrimary: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  statValue: {
    fontSize: 56,
    fontWeight: '900',
    color: '#ffffff',
    fontVariant: ['tabular-nums'],
    lineHeight: 64,
  },
  statUnit: {
    fontSize: 20,
    fontWeight: '600',
    color: '#94a3b8',
    marginLeft: 6,
  },
  statSecondary: {
    marginLeft: 12,
  },
  statLabel: {
    fontSize: 11,
    color: '#64748b',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  statGrid: {
    flexDirection: 'row',
    backgroundColor: '#162d4d',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
  },
  statCellValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    fontVariant: ['tabular-nums'],
  },
  statCellLabel: {
    fontSize: 10,
    color: '#64748b',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    backgroundColor: '#1e3d66',
    marginVertical: 4,
  },
  courseRow: {
    flexDirection: 'row',
    backgroundColor: '#162d4d',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    alignItems: 'center',
  },
  courseCell: {
    flex: 1,
    alignItems: 'center',
  },
  courseCellValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    fontVariant: ['tabular-nums'],
  },
  courseCellLabel: {
    fontSize: 10,
    color: '#64748b',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  courseCardinal: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },
  courseDivider: {
    width: 1,
    height: 40,
    backgroundColor: '#1e3d66',
    marginHorizontal: 8,
  },
  courseCompassContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#0a1628',
    borderWidth: 2,
    borderColor: '#1e3d66',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  courseCompassNeedle: {
    position: 'absolute',
    width: 3,
    height: 20,
    backgroundColor: '#e85d2a',
    borderRadius: 2,
    top: 4,
  },
  courseCompassCOG: {
    position: 'absolute',
    width: 2,
    height: 18,
    backgroundColor: '#4ade80',
    borderRadius: 1,
    top: 5,
  },
  heelRow: {
    backgroundColor: '#162d4d',
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  heelIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  heelBarContainer: {
    flex: 1,
    height: 12,
    backgroundColor: '#0a1628',
    borderRadius: 6,
    overflow: 'hidden',
    marginRight: 12,
  },
  heelBar: {
    height: '100%',
    borderRadius: 6,
  },
  heelValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
    width: 60,
    textAlign: 'right',
  },
  heelLabel: {
    fontSize: 10,
    color: '#64748b',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  pointsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  pointsText: {
    fontSize: 13,
    color: '#64748b',
  },
  pendingText: {
    fontSize: 12,
    color: '#facc15',
  },
  errorBanner: {
    backgroundColor: '#7f1d1d',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  errorBannerText: {
    fontSize: 13,
    color: '#fca5a5',
  },
  controlRow: {
    marginVertical: 8,
  },
  startButton: {
    backgroundColor: '#e85d2a',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  stopButton: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ef4444',
  },
  stopButtonText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#ef4444',
    letterSpacing: 0.5,
  },
  autoNote: {
    backgroundColor: '#162d4d',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e3d66',
  },
  autoNoteText: {
    fontSize: 12,
    color: '#94a3b8',
    textAlign: 'center',
  },
  freeSailButton: {
    backgroundColor: '#162d4d',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#e85d2a40',
  },
  freeSailButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#e85d2a',
  },
  debugRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
  },
  debugButton: {
    flex: 1,
    backgroundColor: '#162d4d',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e3d66',
  },
  debugButtonActive: {
    borderColor: '#e85d2a',
    backgroundColor: '#2d1a0e',
  },
  debugButtonText: {
    fontSize: 12,
    color: '#94a3b8',
  },
  statsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  statsModal: {
    backgroundColor: '#162d4d',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    borderWidth: 1,
    borderColor: '#1e3d66',
  },
  statsTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 20,
  },
  statsGrid2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  statsItem: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: '#0a1628',
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
  },
  statsItemValue: {
    fontSize: 24,
    fontWeight: '800',
    color: '#e85d2a',
    fontVariant: ['tabular-nums'],
  },
  statsItemLabel: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  statsNote: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 18,
  },
  statsDismissButton: {
    backgroundColor: '#e85d2a',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statsDismissText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#ffffff',
  },
});
