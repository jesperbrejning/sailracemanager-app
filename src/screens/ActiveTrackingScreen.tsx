/**
 * Active Tracking Screen
 * 
 * The main tracking interface showing:
 * - Live map with GPS trail (WebView + Leaflet/OpenStreetMap)
 * - Speed gauge (knots)
 * - Distance traveled
 * - Duration timer
 * - Points collected/sent status
 * - Start/Stop controls
 * 
 * This screen uses the useTracking hook which manages
 * background GPS via expo-location TaskManager.
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  SafeAreaView,
  StatusBar,
} from 'react-native';
import { useTracking } from '../hooks/useTracking';
import { formatDuration, formatSpeed, formatDistance } from '../utils/geo';
import WebViewMap from '../components/WebViewMap';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

/** Convert degrees to cardinal direction (N, NNE, NE, ENE, E, ...)
 *  Handles nautical convention where 360 = North */
function degreesToCardinal(deg: number): string {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  // Normalise 360 back to 0 for index calculation
  const normalised = deg % 360;
  const idx = Math.round(((normalised % 360) + 360) % 360 / 22.5) % 16;
  return dirs[idx];
}

/** Normalise GPS COG to nautical convention: 1-360 (0 shown as 360) */
function normaliseCOG(deg: number): number {
  const n = ((deg % 360) + 360) % 360;
  return n === 0 ? 360 : n;
}

export default function ActiveTrackingScreen({ navigation, route }: Props) {
  const { eventId, eventName } = route.params as {
    eventId?: number;
    eventName: string;
  };

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
    navigation.goBack();
  }, [navigation]);

  // GPS status indicator color
  const gpsColor =
    gpsStatus === 'active'
      ? '#4ade80'
      : gpsStatus === 'acquiring'
        ? '#facc15'
        : gpsStatus === 'error' || gpsStatus === 'denied'
          ? '#ef4444'
          : '#64748b';

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a1628" />

      {/* Header */}
      <View style={styles.header}>
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
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {eventName}
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
          // Normalise both to nautical convention (1-360, North=360)
          const hdgDisplay = hdg != null ? (hdg === 0 ? 360 : hdg) : null;
          const cogDisplay = cog != null ? normaliseCOG(cog) : null;
          // For CSS rotation, 360 and 0 are identical - use raw value
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

        {/* Start/Stop Button */}
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
      </View>

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
    fontWeight: '600',
    color: '#ffffff',
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
    marginRight: 4,
  },
  gpsText: {
    fontSize: 11,
    color: '#94a3b8',
  },
  headerRight: {
    width: 40,
  },
  mapContainer: {
    height: '40%',
    backgroundColor: '#0f1f38',
  },
  map: {
    flex: 1,
  },
  dashboard: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginBottom: 16,
  },
  statPrimary: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  statValue: {
    fontSize: 48,
    fontWeight: '700',
    color: '#ffffff',
    fontVariant: ['tabular-nums'],
  },
  statUnit: {
    fontSize: 20,
    color: '#e85d2a',
    marginLeft: 4,
    fontWeight: '600',
  },
  statSecondary: {
    marginLeft: 12,
  },
  statLabel: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '600',
    letterSpacing: 1,
  },
  statGrid: {
    flexDirection: 'row',
    backgroundColor: '#162d4d',
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: 12,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
  },
  statCellValue: {
    fontSize: 16,
    fontWeight: '600',
    color: '#e0f2fe',
    fontVariant: ['tabular-nums'],
  },
  statCellLabel: {
    fontSize: 9,
    color: '#64748b',
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#1e3d66',
  },
  heelRow: {
    backgroundColor: '#162d4d',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  heelIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heelBarContainer: {
    flex: 1,
    height: 8,
    backgroundColor: '#0f1f38',
    borderRadius: 4,
    overflow: 'hidden',
  },
  heelBar: {
    height: '100%',
    borderRadius: 4,
    minWidth: 4,
  },
  heelValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#e0f2fe',
    fontVariant: ['tabular-nums'],
    width: 70,
    textAlign: 'right',
  },
  heelLabel: {
    fontSize: 9,
    color: '#64748b',
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  courseRow: {
    flexDirection: 'row',
    backgroundColor: '#162d4d',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  courseCell: {
    flex: 1,
    alignItems: 'center',
  },
  courseCellValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#e0f2fe',
    fontVariant: ['tabular-nums'],
  },
  courseCellLabel: {
    fontSize: 9,
    color: '#64748b',
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 2,
  },
  courseCardinal: {
    fontSize: 11,
    color: '#e85d2a',
    fontWeight: '600',
    marginTop: 2,
  },
  courseDivider: {
    width: 1,
    height: 50,
    backgroundColor: '#1e3d66',
  },
  courseCompassContainer: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#0f1f38',
    borderWidth: 1,
    borderColor: '#1e3d66',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginHorizontal: 8,
  },
  courseCompassNeedle: {
    position: 'absolute',
    width: 2,
    height: 20,
    backgroundColor: '#e85d2a',
    borderRadius: 1,
    top: 6,
    left: 25,
    transformOrigin: 'bottom center',
  },
  courseCompassCOG: {
    position: 'absolute',
    width: 2,
    height: 18,
    backgroundColor: '#4ade80',
    borderRadius: 1,
    top: 8,
    left: 25,
    transformOrigin: 'bottom center',
  },
  pointsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  pointsText: {
    fontSize: 12,
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
    color: '#fca5a5',
    fontSize: 13,
    textAlign: 'center',
  },
  controlRow: {
    marginTop: 'auto',
    paddingBottom: 20,
  },
  startButton: {
    backgroundColor: '#e85d2a',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  startButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  stopButton: {
    backgroundColor: '#7f1d1d',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#ef4444',
  },
  stopButtonText: {
    color: '#fca5a5',
    fontSize: 18,
    fontWeight: '700',
  },
  statsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10, 22, 40, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  statsModal: {
    backgroundColor: '#162d4d',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: '#1e3d66',
  },
  statsTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 20,
  },
  statsGrid2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  statsItem: {
    width: '50%',
    alignItems: 'center',
    paddingVertical: 10,
  },
  statsItemValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#e85d2a',
  },
  statsItemLabel: {
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
    fontWeight: '500',
  },
  statsNote: {
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 18,
  },
  statsDismissButton: {
    backgroundColor: '#e85d2a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statsDismissText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});
