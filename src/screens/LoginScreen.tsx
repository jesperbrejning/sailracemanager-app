/**
 * Login Screen
 * 
 * Handles OAuth authentication via a WebView.
 * The flow:
 * 1. User taps "Log in with SailRaceManager"
 * 2. WebView opens the Manus OAuth portal
 * 3. User authenticates (Google, email, etc.)
 * 4. OAuth redirects to /api/oauth/callback on our backend
 * 5. Backend sets the session cookie in the response
 * 6. We intercept the cookie from the WebView
 * 7. Store cookie in SecureStore
 * 8. Navigate to the main app
 */

import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  SafeAreaView,
  StatusBar,
  Dimensions,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { CONFIG } from '../config';
import { setSessionCookie, extractSessionCookie } from '../services/auth';

const { width } = Dimensions.get('window');

interface LoginScreenProps {
  onLoginSuccess: () => void;
}

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Open the OAuth login in the system browser.
   * We use a custom scheme deep link to capture the callback.
   * 
   * Alternative approach: Use a WebView component inline.
   * For simplicity, we use the system browser approach.
   */
  const handleLogin = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Build the OAuth URL
      // The redirect URI points to our backend which handles the OAuth callback
      const redirectUri = `${CONFIG.API_BASE_URL}${CONFIG.OAUTH_CALLBACK_PATH}`;
      const state = btoa(redirectUri);

      const loginUrl = `${CONFIG.OAUTH_PORTAL_URL}/app-auth?appId=${CONFIG.APP_ID}&redirectUri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&type=signIn`;

      // Open in-app browser
      const result = await WebBrowser.openAuthSessionAsync(
        loginUrl,
        `${CONFIG.API_BASE_URL}/`, // Return URL pattern
        {
          showInRecents: true,
          preferEphemeralSession: false,
        }
      );

      if (result.type === 'success' && result.url) {
        // The browser redirected back - try to fetch the session
        // After OAuth callback, the backend sets a cookie.
        // We need to make a request to get the cookie value.
        await fetchSessionFromBackend();
      } else if (result.type === 'cancel') {
        setError('Login was cancelled');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [onLoginSuccess]);

  /**
   * After OAuth callback, fetch the session by calling auth.me.
   * If the cookie was set in the browser, we need to extract it.
   * 
   * Alternative: Make a direct fetch to get the Set-Cookie header.
   */
  const fetchSessionFromBackend = useCallback(async () => {
    try {
      // Try to get session cookie by making a request to the backend
      // The OAuth callback should have set the cookie in the browser
      const response = await fetch(`${CONFIG.API_BASE_URL}/api/trpc/auth.me`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Check for Set-Cookie header
      const setCookie = response.headers.get('set-cookie');
      if (setCookie) {
        const sessionCookie = extractSessionCookie(setCookie);
        if (sessionCookie) {
          await setSessionCookie(sessionCookie);
          onLoginSuccess();
          return;
        }
      }

      // If we got a successful response, the session might already be active
      if (response.ok) {
        const data = await response.json();
        if (data?.result?.data) {
          // Session is valid - but we need the cookie value
          // This is a known challenge with WebView auth in React Native
          setError(
            'Login successful but cookie extraction failed. Please try the manual login option.'
          );
          return;
        }
      }

      setError('Could not establish session. Please try again.');
    } catch (err) {
      setError('Failed to verify login. Please try again.');
    }
  }, [onLoginSuccess]);

  /**
   * Manual cookie input - fallback for when WebView cookie extraction fails.
   * User can copy the cookie from their browser's developer tools.
   */
  const handleManualLogin = useCallback(async () => {
    // This would open a text input for manual cookie entry
    // For now, we'll use the WebView approach
    setError('Manual login not yet implemented. Please use the browser login.');
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a1628" />

      <View style={styles.content}>
        {/* Logo and branding */}
        <View style={styles.logoContainer}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoEmoji}>⛵</Text>
          </View>
          <Text style={styles.title}>SailRaceManager</Text>
          <Text style={styles.subtitle}>GPS Race Tracking</Text>
        </View>

        {/* Description */}
        <View style={styles.descriptionContainer}>
          <Text style={styles.description}>
            Track your sailing races with precision GPS. Your route is recorded
            even when the screen is off, so you can focus on racing.
          </Text>

          <View style={styles.featureList}>
            <FeatureItem icon="📍" text="Background GPS tracking" />
            <FeatureItem icon="📊" text="Live speed and distance" />
            <FeatureItem icon="🗺️" text="Route map visualization" />
            <FeatureItem icon="🏆" text="Automatic race activity logging" />
          </View>
        </View>

        {/* Login button */}
        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={styles.loginButton}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.loginButtonText}>
                Log in with SailRaceManager
              </Text>
            )}
          </TouchableOpacity>

          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Text style={styles.footerText}>
            Don't have an account? Sign up at sailracemanager.com
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

function FeatureItem({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.featureItem}>
      <Text style={styles.featureIcon}>{icon}</Text>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a1628',
  },
  content: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 40,
  },
  logoCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#162d4d',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: '#e85d2a',
  },
  logoEmoji: {
    fontSize: 48,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 16,
    color: '#94a3b8',
    marginTop: 4,
  },
  descriptionContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  description: {
    fontSize: 16,
    color: '#cbd5e1',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  featureList: {
    gap: 12,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#162d4d',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  featureIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  featureText: {
    fontSize: 15,
    color: '#e0f2fe',
    fontWeight: '500',
  },
  buttonContainer: {
    alignItems: 'center',
  },
  loginButton: {
    backgroundColor: '#e85d2a',
    paddingVertical: 16,
    paddingHorizontal: 32,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#e85d2a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  loginButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  errorContainer: {
    marginTop: 12,
    backgroundColor: '#3b1a1a',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    width: '100%',
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    textAlign: 'center',
  },
  footerText: {
    color: '#64748b',
    fontSize: 13,
    marginTop: 16,
    textAlign: 'center',
  },
});
