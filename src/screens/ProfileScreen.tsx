/**
 * Profile Screen
 * 
 * Shows user profile info, app settings, and logout option.
 */

import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Alert,
  ScrollView,
  Image,
  Linking,
} from 'react-native';
import { useAuth } from '../hooks/useAuth';
import { CONFIG } from '../config';

export default function ProfileScreen() {
  const { user, logout } = useAuth();

  const handleLogout = useCallback(() => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await logout();
        },
      },
    ]);
  }, [logout]);

  const handleOpenWebsite = useCallback(() => {
    Linking.openURL(CONFIG.API_BASE_URL);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a1628" />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Profile Header */}
        <View style={styles.profileHeader}>
          {user?.avatarUrl ? (
            <Image
              source={{ uri: user.avatarUrl }}
              style={styles.avatar}
            />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.avatarInitial}>
                {user?.name?.[0]?.toUpperCase() || '?'}
              </Text>
            </View>
          )}
          <Text style={styles.userName}>{user?.name || 'Sailor'}</Text>
          {user?.email && (
            <Text style={styles.userEmail}>{user.email}</Text>
          )}
          {user?.sailingClub && (
            <View style={styles.clubBadge}>
              <Text style={styles.clubText}>⛵ {user.sailingClub}</Text>
            </View>
          )}
        </View>

        {/* App Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>App</Text>

          <TouchableOpacity
            style={styles.menuItem}
            onPress={handleOpenWebsite}
          >
            <Text style={styles.menuItemText}>Open SailRaceManager.com</Text>
            <Text style={styles.menuItemArrow}>→</Text>
          </TouchableOpacity>

          <View style={styles.menuItem}>
            <Text style={styles.menuItemText}>App Version</Text>
            <Text style={styles.menuItemValue}>1.0.0</Text>
          </View>

          <View style={styles.menuItem}>
            <Text style={styles.menuItemText}>GPS Batch Interval</Text>
            <Text style={styles.menuItemValue}>
              {CONFIG.GPS.BATCH_INTERVAL_MS / 1000}s
            </Text>
          </View>
        </View>

        {/* About */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>About</Text>

          <View style={styles.aboutCard}>
            <Text style={styles.aboutText}>
              SailRaceManager GPS Tracking App enables reliable background GPS
              tracking during sailing races. Your route is recorded even when
              the screen is off, using Android's Foreground Service.
            </Text>
            <Text style={styles.aboutText}>
              All tracking data is synced to your SailRaceManager account and
              automatically creates sailing activities with route maps, speed
              stats, and distance calculations.
            </Text>
          </View>
        </View>

        {/* Logout */}
        <TouchableOpacity
          style={styles.logoutButton}
          onPress={handleLogout}
        >
          <Text style={styles.logoutButtonText}>Log Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a1628',
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  profileHeader: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#e85d2a',
  },
  avatarPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#162d4d',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 2,
    borderColor: '#e85d2a',
  },
  avatarInitial: {
    fontSize: 32,
    fontWeight: '700',
    color: '#e85d2a',
  },
  userName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
  },
  userEmail: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 4,
  },
  clubBadge: {
    marginTop: 8,
    backgroundColor: '#162d4d',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  clubText: {
    fontSize: 13,
    color: '#e0f2fe',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748b',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 8,
  },
  menuItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#162d4d',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 2,
  },
  menuItemText: {
    fontSize: 15,
    color: '#e0f2fe',
  },
  menuItemValue: {
    fontSize: 14,
    color: '#64748b',
  },
  menuItemArrow: {
    fontSize: 16,
    color: '#e85d2a',
  },
  aboutCard: {
    backgroundColor: '#162d4d',
    borderRadius: 12,
    padding: 16,
    gap: 12,
  },
  aboutText: {
    fontSize: 14,
    color: '#cbd5e1',
    lineHeight: 20,
  },
  logoutButton: {
    backgroundColor: '#3b1a1a',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#dc2626',
  },
  logoutButtonText: {
    color: '#fca5a5',
    fontSize: 16,
    fontWeight: '600',
  },
});
