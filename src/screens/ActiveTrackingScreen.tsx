/**
 * Active Tracking Screen
 * 
 * The main tracking interface showing:
 * - Live map with GPS trail
 * - Speed gauge (knots)
 * - Distance traveled
 * - Duration timer
 * - Points collected/sent status
 * - Start/Stop controls
 * 
 * This screen uses the useTracking hook which manages
 * background GPS via expo-location TaskManager.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo, Component } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  SafeAreaView,
  StatusBar,
  Dimensions,
  ScrollView,
} from 'react-native';
import { useTracking } from '../hooks/useTracking';
import { formatDuration, formatSpeed, formatDistance } from '../utils/geo';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';

const { width, height } = Dimensions.get('window');

// Lazy-load MapView to prevent crash if react-native-maps has issues
let MapViewComponent: any = null;
let MarkerComponent: any = null;
let PolylineComponent: any = null;

try {
  const maps = require('react-native-maps');
  MapViewComponent = maps.default;
  MarkerComponent = maps.Marker;
  PolylineComponent = maps.Polyline;
} catch (e) {
  console.warn('[ActiveTracking] react-native-maps not available:', e);
}

/**
 * Error boundary to catch MapView crashes gracefully
 */
class MapErrorBoundary extends Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.warn('[MapErrorBoundary] Map crashed:', error.message);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

type Props = {
  navigation: NativeStackNavigationProp<any>;
  route: RouteProp<any>;
};

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
    trackPoints,
    startTracking,
    stopTracking,
    recoverSession,
  } = useTracking();

  const mapRef = useRef<any>(null);
  const [showStats, setShowStats] = useState(false);
  const [finalStats, setFinalStats] = useState<any>(null);
  const [mapAvailable, setMapAvailable] = useState(!!MapViewComponent);

  // Try to recover an existing session on mount
  useEffect(() => {
    recoverSession();
  }, []);

  // Center map on current position
  useEffect(() => {
    if (currentPosition && mapRef.current && mapAvailable) {
      try {
        mapRef.current.animateToRegion(
          {
            latitude: currentPosition.latitude,
            longitude: currentPosition.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          },
          500
        );
      } catch (e) {
        // Ignore map animation errors
      }
    }
  }, [currentPosition?.latitude, currentPosition?.longitude, mapAvailable]);

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

  // Default map region (Denmark)
  const defaultRegion = {
    latitude: 55.6761,
    longitude: 12.5683,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };

  /** Fallback UI when map is not available */
  const MapFallback = () => (
    <View style={styles.mapFallback}>
      <Text style={styles.mapFallbackIcon}>🗺️</Text>
      <Text style={styles.mapFallbackTitle}>Map Unavailable</Text>
      <Text style={styles.mapFallbackText}>
        GPS tracking is still working.{'\n'}
        Your route is being recorded.
      </Text>
      {currentPosition && (
        <View style={styles.coordsBox}>
          <Text style={styles.coordsText}>
            📍 {currentPosition.latitude.toFixed(5)}, {currentPosition.longitude.toFixed(5)}
          </Text>
        </View>
      )}
    </View>
  );

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

      {/* Map */}
      <View style={styles.mapContainer}>
        {mapAvailable && MapViewComponent ? (
          <MapErrorBoundary fallback={<MapFallback />}>
            <MapViewComponent
              ref={mapRef}
              style={styles.map}
              initialRegion={
                currentPosition
                  ? {
                      latitude: currentPosition.latitude,
                      longitude: currentPosition.longitude,
                      latitudeDelta: 0.01,
                      longitudeDelta: 0.01,
                    }
                  : defaultRegion
              }
              mapType="standard"
              showsUserLocation={false}
              showsMyLocationButton={false}
            >
              {/* Track polyline */}
              {PolylineComponent && polylineCoords.length > 1 && (
                <PolylineComponent
                  coordinates={polylineCoords}
                  strokeColor="#e85d2a"
                  strokeWidth={3}
                />
              )}

              {/* Current position marker */}
              {MarkerComponent && currentPosition && (
                <MarkerComponent
                  coordinate={{
                    latitude: currentPosition.latitude,
                    longitude: currentPosition.longitude,
                  }}
                  title="Current Position"
                >
                  <View style={styles.markerContainer}>
                    <View style={styles.markerDot} />
                    {accuracy && accuracy < 100 && (
                      <View
                        style={[
                          styles.accuracyCircle,
                          {
                            width: Math.max(20, Math.min(accuracy / 2, 80)),
                            height: Math.max(20, Math.min(accuracy / 2, 80)),
                            borderRadius: Math.max(10, Math.min(accuracy / 4, 40)),
                          },
                        ]}
                      />
                    )}
                  </View>
                </MarkerComponent>
              )}
            </MapViewComponent>

            {/* Map overlay - center on position button */}
            {currentPosition && (
              <TouchableOpacity
                style={styles.centerButton}
                onPress={() => {
                  try {
                    mapRef.current?.animateToRegion(
                      {
                        latitude: currentPosition.latitude,
                        longitude: currentPosition.longitude,
                        latitudeDelta: 0.01,
                        longitudeDelta: 0.01,
                      },
                      500
                    );
                  } catch (e) {
                    // Ignore
                  }
                }}
              >
                <Text style={styles.centerButtonText}>◎</Text>
              </TouchableOpacity>
            )}
          </MapErrorBoundary>
        ) : (
          <MapFallback />
        )}
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
    marginRight: 6,
  },
  gpsText: {
    fontSize: 11,
    color: '#94a3b8',
  },
  headerRight: {
    width: 40,
  },

  // Map
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  map: {
    flex: 1,
  },
  mapFallback: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0f1f38',
    padding: 24,
  },
  mapFallbackIcon: {
    fontSize: 48,
    marginBottom: 12,
  },
  mapFallbackTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 8,
  },
  mapFallbackText: {
    fontSize: 14,
    color: '#94a3b8',
    textAlign: 'center',
    lineHeight: 20,
  },
  coordsBox: {
    marginTop: 16,
    backgroundColor: '#162d4d',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e3d66',
  },
  coordsText: {
    fontSize: 13,
    color: '#e0f2fe',
    fontVariant: ['tabular-nums'],
  },
  centerButton: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#162d4d',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e3d66',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  centerButtonText: {
    fontSize: 22,
    color: '#e85d2a',
  },
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#e85d2a',
    borderWidth: 2,
    borderColor: '#ffffff',
    zIndex: 2,
  },
  accuracyCircle: {
    position: 'absolute',
    backgroundColor: 'rgba(232, 93, 42, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(232, 93, 42, 0.3)',
  },

  // Dashboard
  dashboard: {
    backgroundColor: '#0f1f38',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderColor: '#1e3d66',
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    marginBottom: 12,
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
    color: '#94a3b8',
    marginLeft: 4,
  },
  statSecondary: {
    marginLeft: 8,
  },
  statLabel: {
    fontSize: 12,
    color: '#64748b',
    fontWeight: '600',
    letterSpacing: 1,
  },
  statGrid: {
    flexDirection: 'row',
    alignItems: 'center',
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
    fontSize: 10,
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
  pointsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  pointsText: {
    fontSize: 12,
    color: '#64748b',
  },
  pendingText: {
    fontSize: 12,
    color: '#facc15',
    marginLeft: 8,
  },
  errorBanner: {
    backgroundColor: '#3b1a1a',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  errorBannerText: {
    color: '#fca5a5',
    fontSize: 12,
    textAlign: 'center',
  },
  controlRow: {
    alignItems: 'center',
  },
  startButton: {
    backgroundColor: '#e85d2a',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 30,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#e85d2a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  startButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },
  stopButton: {
    backgroundColor: '#dc2626',
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderRadius: 30,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#dc2626',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  stopButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: '700',
  },

  // Stats overlay
  statsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  statsModal: {
    backgroundColor: '#162d4d',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 360,
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
    paddingVertical: 12,
  },
  statsItemValue: {
    fontSize: 20,
    fontWeight: '700',
    color: '#e85d2a',
  },
  statsItemLabel: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 4,
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
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  statsDismissText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
});
