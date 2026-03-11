/**
 * Event Selection Screen
 * 
 * Allows the user to select an event/race to track for,
 * or start a free sailing (training) session without an event.
 */

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  TextInput,
  RefreshControl,
} from 'react-native';
import { trpc } from '../services/trpc';
import type { SailEvent } from '../types/tracking';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

export default function EventSelectScreen({ navigation }: Props) {
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Fetch events from backend
  const eventsQuery = trpc.events.list.useQuery(
    { status: 'active', limit: 50 },
    { retry: 1 }
  );

  const events = useMemo(() => {
    const list = (eventsQuery.data as SailEvent[] | undefined) ?? [];
    if (!search.trim()) return list;
    const q = search.toLowerCase();
    return list.filter(
      (e) =>
        e.name?.toLowerCase().includes(q) ||
        e.boatClass?.toLowerCase().includes(q) ||
        e.organizer?.toLowerCase().includes(q) ||
        e.location?.toLowerCase().includes(q)
    );
  }, [eventsQuery.data, search]);

  const onRefresh = async () => {
    setRefreshing(true);
    await eventsQuery.refetch();
    setRefreshing(false);
  };

  const handleSelectEvent = (event: SailEvent) => {
    navigation.navigate('ActiveTracking', {
      eventId: event.id,
      eventName: event.name,
    });
  };

  const handleFreeSailing = () => {
    navigation.navigate('ActiveTracking', {
      eventId: undefined,
      eventName: 'Free Sailing',
    });
  };

  const renderEvent = ({ item }: { item: SailEvent }) => (
    <TouchableOpacity
      style={styles.eventCard}
      onPress={() => handleSelectEvent(item)}
      activeOpacity={0.7}
    >
      <View style={styles.eventHeader}>
        <Text style={styles.eventName} numberOfLines={2}>
          {item.name}
        </Text>
        <View style={styles.statusBadge}>
          <Text style={styles.statusText}>{item.status}</Text>
        </View>
      </View>

      {item.boatClass && (
        <View style={styles.eventDetail}>
          <Text style={styles.detailLabel}>Class:</Text>
          <Text style={styles.detailValue}>{item.boatClass}</Text>
        </View>
      )}

      {item.organizer && (
        <View style={styles.eventDetail}>
          <Text style={styles.detailLabel}>Organizer:</Text>
          <Text style={styles.detailValue}>{item.organizer}</Text>
        </View>
      )}

      {item.location && (
        <View style={styles.eventDetail}>
          <Text style={styles.detailLabel}>Location:</Text>
          <Text style={styles.detailValue}>{item.location}</Text>
        </View>
      )}

      {item.startDate && (
        <View style={styles.eventDetail}>
          <Text style={styles.detailLabel}>Date:</Text>
          <Text style={styles.detailValue}>
            {new Date(item.startDate).toLocaleDateString()}
          </Text>
        </View>
      )}

      <View style={styles.trackButton}>
        <Text style={styles.trackButtonText}>Start Tracking →</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a1628" />

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Select Event</Text>
        <Text style={styles.headerSubtitle}>
          Choose a race to track, or start free sailing
        </Text>
      </View>

      {/* Free Sailing Button */}
      <TouchableOpacity
        style={styles.freeSailButton}
        onPress={handleFreeSailing}
        activeOpacity={0.7}
      >
        <Text style={styles.freeSailIcon}>⛵</Text>
        <View style={styles.freeSailContent}>
          <Text style={styles.freeSailTitle}>Free Sailing</Text>
          <Text style={styles.freeSailSubtitle}>
            Track without a specific event
          </Text>
        </View>
        <Text style={styles.freeSailArrow}>→</Text>
      </TouchableOpacity>

      {/* Search */}
      <View style={styles.searchContainer}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search events..."
          placeholderTextColor="#64748b"
          value={search}
          onChangeText={setSearch}
        />
      </View>

      {/* Events List */}
      {eventsQuery.isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#e85d2a" />
          <Text style={styles.loadingText}>Loading events...</Text>
        </View>
      ) : eventsQuery.error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>
            Could not load events. Check your connection.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={onRefresh}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={events}
          renderItem={renderEvent}
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
              <Text style={styles.emptyText}>
                {search ? 'No events match your search' : 'No active events'}
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
    paddingBottom: 8,
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
  freeSailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#162d4d',
    marginHorizontal: 20,
    marginVertical: 12,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e85d2a',
  },
  freeSailIcon: {
    fontSize: 32,
    marginRight: 12,
  },
  freeSailContent: {
    flex: 1,
  },
  freeSailTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#ffffff',
  },
  freeSailSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 2,
  },
  freeSailArrow: {
    fontSize: 20,
    color: '#e85d2a',
    fontWeight: '700',
  },
  searchContainer: {
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  searchInput: {
    backgroundColor: '#162d4d',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#1e3d66',
  },
  listContent: {
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  eventCard: {
    backgroundColor: '#162d4d',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e3d66',
  },
  eventHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  eventName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ffffff',
    flex: 1,
    marginRight: 8,
  },
  statusBadge: {
    backgroundColor: '#1a4d2e',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 11,
    color: '#4ade80',
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  eventDetail: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  detailLabel: {
    fontSize: 13,
    color: '#64748b',
    width: 80,
  },
  detailValue: {
    fontSize: 13,
    color: '#cbd5e1',
    flex: 1,
  },
  trackButton: {
    marginTop: 12,
    alignItems: 'flex-end',
  },
  trackButtonText: {
    fontSize: 14,
    color: '#e85d2a',
    fontWeight: '600',
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
    paddingVertical: 40,
    alignItems: 'center',
  },
  emptyText: {
    color: '#64748b',
    fontSize: 15,
  },
});
