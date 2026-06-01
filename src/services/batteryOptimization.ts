/**
 * Battery Optimization Exemption for Android
 *
 * Android Doze mode suspends network access for all apps (even those with
 * foreground services) after ~1 minute of screen-off inactivity. The ONLY
 * reliable way to maintain continuous network access is to be exempt from
 * battery optimization.
 *
 * This module checks whether the app is exempt and, if not, shows the
 * Android system dialog asking the user to allow unrestricted background
 * activity for SailRaceManager.
 *
 * Why this is critical:
 * - Our foreground service keeps GPS alive (location updates continue)
 * - But HTTP fetch() calls to send GPS points to the server are BLOCKED by Doze
 * - Points accumulate in buffer but never reach the server until screen wakes
 * - With battery optimization exemption, network access is unrestricted
 *
 * Google Play policy:
 * - REQUEST_IGNORE_BATTERY_OPTIMIZATIONS is allowed for apps whose core
 *   function requires continuous background operation (GPS tracking qualifies)
 * - Must be clearly justified in Play Store listing
 */

import { Platform, Alert } from 'react-native';
import {
  isIgnoringBatteryOptimizations,
  requestIgnoreBatteryOptimizations,
} from 'expo-ignore-battery-optimizations';

/**
 * Check if the app is currently exempt from battery optimization.
 * Returns true on non-Android platforms (they don't have Doze).
 */
export function isBatteryOptimizationExempt(): boolean {
  if (Platform.OS !== 'android') return true;
  return isIgnoringBatteryOptimizations();
}

/**
 * Request battery optimization exemption from the user.
 * Shows the Android system dialog (ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).
 *
 * @param showExplanation - If true, shows an alert explaining why before the system dialog
 * @returns true if exemption was granted, false otherwise
 */
export async function requestBatteryOptimizationExemption(
  showExplanation: boolean = true
): Promise<boolean> {
  if (Platform.OS !== 'android') return true;

  // Already exempt
  if (isIgnoringBatteryOptimizations()) return true;

  if (showExplanation) {
    // Show explanation alert first
    const userAccepted = await new Promise<boolean>((resolve) => {
      Alert.alert(
        'Tillad ubegrænset baggrundsbrug',
        'For at GPS-tracking kan fortsætte med at sende data når skærmen er slukket, skal SailRaceManager undtages fra batterioptimering.\n\nDette er nødvendigt for at din sejlads-track bliver komplet.',
        [
          {
            text: 'Ikke nu',
            style: 'cancel',
            onPress: () => resolve(false),
          },
          {
            text: 'Tillad',
            onPress: () => resolve(true),
          },
        ]
      );
    });

    if (!userAccepted) return false;
  }

  // Show system dialog
  try {
    await requestIgnoreBatteryOptimizations();
    // Check if it was actually granted
    return isIgnoringBatteryOptimizations();
  } catch (error) {
    console.warn('[BatteryOptimization] Failed to request exemption:', error);
    return false;
  }
}

/**
 * Ensure battery optimization is disabled before starting tracking.
 * Call this at the beginning of startTracking().
 *
 * If the user declines, tracking will still start but may lose data
 * when the screen is off. A warning is logged.
 */
export async function ensureBatteryOptimizationForTracking(): Promise<void> {
  if (Platform.OS !== 'android') return;

  const isExempt = isIgnoringBatteryOptimizations();
  if (isExempt) {
    console.log('[BatteryOptimization] Already exempt from battery optimization');
    return;
  }

  console.log('[BatteryOptimization] Not exempt - requesting exemption');
  const granted = await requestBatteryOptimizationExemption(true);

  if (granted) {
    console.log('[BatteryOptimization] Exemption granted - tracking will work with screen off');
  } else {
    console.warn(
      '[BatteryOptimization] Exemption NOT granted - GPS data may not be sent when screen is off'
    );
  }
}
