/**
 * History Screen
 * 
 * Shows the user's past tracking sessions with stats.
 * Fetches data from the tracking.myHistory tRPC endpoint.
 */

import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  RefreshControl,
} from 'react-native';
import { trpc } from '../services/trpc';
import { formatDistance, formatDuration } from '../utils/geo';
import type { TrackingSession } from '../types/tracking';

export default function HistoryScreen() {
  const [refreshing, setRefreshing] = useState(false);

  const historyQuery = trpc.tracking.myHistory.useQuery(
    { limit: 50, offset: 0 },
    { retry: 1 }
  );

  const sessions = (historyQuery.data as TrackingSession[] | undefined) ?? [];

  const onRefresh = async () => {
    setRefreshing(true);
    await historyQuery.refetch();
    setRefreshing(false);
  };

  const renderSession = ({ item }: { item: TrackingSession }) => {
    const startDate = new Date(item.startedAt);
    const statusColor =
      item.status === 'completed'
        ? '#4ade80'
        : item.status === 'active'
          ? '#facc15'
          : '#ef4444';

    // Calculate duration if we have start and end times
    let durationStr = '--';
    if (item.startedAt && item.endedAt) {
      const durationSec = Math.round(
        (new Date(item.endedAt).getTime() - new Date(item.startedAt).getTime()) / 1000
      );
      durationStr = formatDuration(durationSec);
    }

    return (
      <View style={styles.sessionCard}>
        <View style={styles.sessionHeader}>
          <View style={styles.sessionDate}>
            <Text style={styles.dateDay}>
              {startDate.toLocaleDateString('da-DK', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
              })}
            </Text>
            <Text style={styles.dateTime}>
              {startDate.toLocaleTimeString('da-DK', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        </View>

        <View style={styles.sessionStats}>
          <View style={styles.sessionStat}>
            <Text style={styles.sessionStatValue}>
              {item.totalDistanceMeters
                ? formatDistance(item.totalDistanceMeters)
                : '--'}
            </Text>
            <Text style={styles.sessionStatLabel}>Distance</Text>
          </View>

          <View style={styles.sessionStatDivider} />

          <View style={styles.sessionStat}>
            <Text style={styles.sessionStatValue}>{durationStr}</Text>
            <Text style={styles.sessionStatLabel}>Duration</Text>
          </View>

          <View style={styles.sessionStatDivider} />

          <View style={styles.sessionStat}>
            <Text style={styles.sessionStatValue}>
              {item.avgSpeedKnots ? `${item.avgSpeedKnots} kn` : '--'}
            </Text>
            <Text style={styles.sessionStatLabel}>Avg Speed</Text>
          </View>

          <View style={styles.sessionStatDivider} />

          <View style={styles.sessionStat}>
            <Text style={styles.sessionStatValue}>
              {item.maxSpeedKnots ? `${item.maxSpeedKnots} kn` : '--'}
            </Text>
            <Text style={styles.sessionStatLabel}>Max Speed</Text>
          </View>
        </View>

        <View style={styles.sessionFooter}>
          <Text style={styles.sessionPoints}>
            📍 {item.totalPoints ?? 0} GPS points
          </Text>
          {item.eventId && (
            <Text style={styles.sessionEvent}>🏁 Event #{item.eventId}</Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a1628" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>Tracking History</Text>
        <Text style={styles.headerSubtitle}>
          Your past sailing sessions
        </Text>
      </View>

      {historyQuery.isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#e85d2a" />
          <Text style={styles.loadingText}>Loading history...</Text>
        </View>
      ) : historyQuery.error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>
            Could not load history. Check your connection.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={onRefresh}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sessions}
          renderItem={renderSession}
          keyExtractor={(item) => item.id.toString()}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#e85d2a"
              colors={['#e85d2a']}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyIcon}>⛵</Text>
              <Text style={styles.emptyTitle}>No sessions yet</Text>
              <Text style={styles.emptyText}>
                Start tracking your first sailing session to see it here.
              </Text>
            </View>
          }
        />
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
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#ffffff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 4,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  sessionCard: {
    backgroundColor: '#162d4d',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e3d66',
  },
  sessionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sessionDate: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  dateDay: {
    fontSize: 15,
    fontWeight: '600',
    color: '#ffffff',
  },
  dateTime: {
    fontSize: 13,
    color: '#94a3b8',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  sessionStats: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f1f38',
    borderRadius: 10,
    paddingVertical: 10,
    marginBottom: 10,
  },
  sessionStat: {
    flex: 1,
    alignItems: 'center',
  },
  sessionStatValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#e0f2fe',
    fontVariant: ['tabular-nums'],
  },
  sessionStatLabel: {
    fontSize: 9,
    color: '#64748b',
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  sessionStatDivider: {
    width: 1,
    height: 24,
    backgroundColor: '#1e3d66',
  },
  sessionFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  sessionPoints: {
    fontSize: 12,
    color: '#64748b',
  },
  sessionEvent: {
    fontSize: 12,
    color: '#e85d2a',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#94a3b8',
    marginTop: 12,
    fontSize: 14,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: '#e85d2a',
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  emptyContainer: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#ffffff',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
