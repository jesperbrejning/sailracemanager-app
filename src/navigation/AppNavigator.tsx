/**
 * App Navigator
 * 
 * Defines the navigation structure:
 * - Auth flow (Login screen) when not authenticated
 * - Main app with bottom tab navigation when authenticated:
 *   - Track tab: Event selection → Active tracking
 *   - History tab: Past sessions
 *   - Profile tab: User info and settings
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, StyleSheet } from 'react-native';

// Screens
import LoginScreen from '../screens/LoginScreen';
import EventSelectScreen from '../screens/EventSelectScreen';
import ActiveTrackingScreen from '../screens/ActiveTrackingScreen';
import HistoryScreen from '../screens/HistoryScreen';
import ProfileScreen from '../screens/ProfileScreen';

// Types for navigation params
export type RootStackParamList = {
  Login: undefined;
  Main: undefined;
  EventSelect: undefined;
  ActiveTracking: { eventId?: number; eventName: string };
  History: undefined;
  Profile: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

interface AppNavigatorProps {
  isAuthenticated: boolean;
  onLoginSuccess: () => void;
}

/**
 * Simple bottom tab bar component (no @react-navigation/bottom-tabs dependency).
 * Uses a stack navigator with a custom tab bar for simplicity.
 */
function MainTabs({ navigation }: any) {
  const [activeTab, setActiveTab] = React.useState<'track' | 'history' | 'profile'>('track');

  const handleTabPress = (tab: 'track' | 'history' | 'profile') => {
    setActiveTab(tab);
  };

  return (
    <View style={styles.mainContainer}>
      {/* Content */}
      <View style={styles.contentContainer}>
        {activeTab === 'track' && <EventSelectScreen navigation={navigation} />}
        {activeTab === 'history' && <HistoryScreen />}
        {activeTab === 'profile' && <ProfileScreen />}
      </View>

      {/* Tab Bar */}
      <View style={styles.tabBar}>
        <TabButton
          icon="📍"
          label="Track"
          active={activeTab === 'track'}
          onPress={() => handleTabPress('track')}
        />
        <TabButton
          icon="📊"
          label="History"
          active={activeTab === 'history'}
          onPress={() => handleTabPress('history')}
        />
        <TabButton
          icon="👤"
          label="Profile"
          active={activeTab === 'profile'}
          onPress={() => handleTabPress('profile')}
        />
      </View>
    </View>
  );
}

function TabButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: string;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <View style={styles.tabButtonContainer}>
      <Text
        style={[styles.tabIcon, active && styles.tabIconActive]}
        onPress={onPress}
      >
        {icon}
      </Text>
      <Text
        style={[styles.tabLabel, active && styles.tabLabelActive]}
        onPress={onPress}
      >
        {label}
      </Text>
    </View>
  );
}

export default function AppNavigator({
  isAuthenticated,
  onLoginSuccess,
}: AppNavigatorProps) {
  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0a1628' },
          animation: 'slide_from_right',
        }}
      >
        {!isAuthenticated ? (
          <Stack.Screen name="Login">
            {(props) => (
              <LoginScreen {...props} onLoginSuccess={onLoginSuccess} />
            )}
          </Stack.Screen>
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen
              name="ActiveTracking"
              component={ActiveTrackingScreen}
              options={{
                gestureEnabled: false, // Prevent accidental back during tracking
              }}
            />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  mainContainer: {
    flex: 1,
    backgroundColor: '#0a1628',
  },
  contentContainer: {
    flex: 1,
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#0f1f38',
    borderTopWidth: 1,
    borderTopColor: '#1e3d66',
    paddingBottom: 20, // Safe area padding
    paddingTop: 8,
  },
  tabButtonContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIcon: {
    fontSize: 22,
    opacity: 0.5,
  },
  tabIconActive: {
    opacity: 1,
  },
  tabLabel: {
    fontSize: 11,
    color: '#64748b',
    marginTop: 2,
    fontWeight: '500',
  },
  tabLabelActive: {
    color: '#e85d2a',
    fontWeight: '600',
  },
});
