/**
 * Login Screen
 * 
 * Handles authentication via:
 * 1. Email/Password login (direct tRPC call)
 * 2. Google Sign-In (via WebBrowser OAuth flow)
 * 3. Email/Password registration
 * 
 * The flow:
 * 1. User enters email + password OR taps "Continue with Google"
 * 2. For email/password: tRPC mutation to auth.login or auth.register
 * 3. For Google: Opens Google OAuth in system browser, gets ID token
 * 4. Backend validates and returns session cookie
 * 5. Store cookie in SecureStore and navigate to main app
 */

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Dimensions,
  Alert,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { CONFIG } from '../config';
import { setSessionCookie, setCachedUser } from '../services/auth';

const { width } = Dimensions.get('window');

interface LoginScreenProps {
  onLoginSuccess: () => void;
}

type AuthMode = 'login' | 'register';

export default function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form fields
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  /**
   * Handle email/password login via direct API call.
   * Calls the tRPC auth.login endpoint which returns a session cookie.
   */
  const handleEmailLogin = useCallback(async () => {
    if (!email.trim() || !password.trim()) {
      setError('Udfyld venligst email og adgangskode');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${CONFIG.API_BASE_URL}/api/trpc/auth.login`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            json: { email: email.trim().toLowerCase(), password },
          }),
        }
      );

      // Extract session cookie from response
      const setCookieHeader = response.headers.get('set-cookie');
      let sessionCookie: string | null = null;

      if (setCookieHeader) {
        const match = setCookieHeader.match(
          new RegExp(`${CONFIG.COOKIE_NAME}=([^;]+)`)
        );
        if (match) {
          sessionCookie = match[1];
        }
      }

      const data = await response.json();

      if (!response.ok) {
        // Extract error message from tRPC error response
        const errorMsg =
          data?.error?.json?.message ||
          data?.error?.message ||
          'Login fejlede';
        setError(errorMsg);
        return;
      }

      // Get the user data from the response
      const userData = data?.result?.data?.json?.user || data?.result?.data?.user;

      if (sessionCookie) {
        await setSessionCookie(sessionCookie);
        if (userData) {
          await setCachedUser(userData);
        }
        onLoginSuccess();
      } else {
        // If no cookie in header, try to verify session
        setError('Login lykkedes, men session cookie kunne ikke hentes. Prøv igen.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login fejlede';
      console.error('[Login] Email login error:', msg);
      setError('Netværksfejl. Tjek din internetforbindelse.');
    } finally {
      setLoading(false);
    }
  }, [email, password, onLoginSuccess]);

  /**
   * Handle email/password registration via direct API call.
   */
  const handleEmailRegister = useCallback(async () => {
    if (!name.trim() || !email.trim() || !password.trim() || !confirmPassword.trim()) {
      setError('Udfyld venligst alle felter');
      return;
    }
    if (password.length < 8) {
      setError('Adgangskoden skal være mindst 8 tegn');
      return;
    }
    if (password !== confirmPassword) {
      setError('Adgangskoderne matcher ikke');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${CONFIG.API_BASE_URL}/api/trpc/auth.register`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            json: {
              name: name.trim(),
              email: email.trim().toLowerCase(),
              password,
            },
          }),
        }
      );

      // Extract session cookie from response
      const setCookieHeader = response.headers.get('set-cookie');
      let sessionCookie: string | null = null;

      if (setCookieHeader) {
        const match = setCookieHeader.match(
          new RegExp(`${CONFIG.COOKIE_NAME}=([^;]+)`)
        );
        if (match) {
          sessionCookie = match[1];
        }
      }

      const data = await response.json();

      if (!response.ok) {
        const errorMsg =
          data?.error?.json?.message ||
          data?.error?.message ||
          'Registrering fejlede';
        setError(errorMsg);
        return;
      }

      const userData = data?.result?.data?.json?.user || data?.result?.data?.user;

      if (sessionCookie) {
        await setSessionCookie(sessionCookie);
        if (userData) {
          await setCachedUser(userData);
        }
        onLoginSuccess();
      } else {
        setError('Konto oprettet, men session cookie kunne ikke hentes. Prøv at logge ind.');
        setMode('login');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Registrering fejlede';
      console.error('[Login] Registration error:', msg);
      setError('Netværksfejl. Tjek din internetforbindelse.');
    } finally {
      setLoading(false);
    }
  }, [name, email, password, confirmPassword, onLoginSuccess]);

  /**
   * Handle Google Sign-In.
   * Opens the Google OAuth consent screen in the system browser,
   * then the web app handles the callback and sets the cookie.
   */
  const handleGoogleLogin = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Open the web app's login page which has Google Sign-In
      const loginUrl = `${CONFIG.API_BASE_URL}/login`;
      console.log('[Login] Opening Google login via web:', loginUrl);

      const result = await WebBrowser.openAuthSessionAsync(
        loginUrl,
        CONFIG.API_BASE_URL,
        {
          showInRecents: true,
          preferEphemeralSession: false,
        }
      );

      console.log('[Login] Browser result:', result.type);

      if (result.type === 'success' || result.type === 'dismiss') {
        // After web login, try to verify the session
        const sessionOk = await verifySession();
        if (sessionOk) {
          onLoginSuccess();
          return;
        }
        setError(
          'Google login lykkedes muligvis. Hvis du er logget ind på sailracemanager.com, prøv at genstarte appen.'
        );
      } else if (result.type === 'cancel') {
        setError('Login blev annulleret');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google login fejlede';
      console.error('[Login] Google login error:', msg);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [onLoginSuccess]);

  /**
   * Verify the session by calling auth.me on the backend.
   */
  const verifySession = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(
        `${CONFIG.API_BASE_URL}/api/trpc/auth.me`,
        {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        }
      );

      const setCookieHeader = response.headers.get('set-cookie');
      if (setCookieHeader) {
        const match = setCookieHeader.match(
          new RegExp(`${CONFIG.COOKIE_NAME}=([^;]+)`)
        );
        if (match) {
          await setSessionCookie(match[1]);
          return true;
        }
      }

      if (response.ok) {
        const data = await response.json();
        if (data?.result?.data?.user) {
          return true;
        }
      }

      return false;
    } catch {
      return false;
    }
  }, []);

  const switchMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError(null);
    setPassword('');
    setConfirmPassword('');
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a1628" />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Logo and branding */}
          <View style={styles.logoContainer}>
            <View style={styles.logoCircle}>
              <Text style={styles.logoEmoji}>⛵</Text>
            </View>
            <Text style={styles.title}>SailRaceManager</Text>
            <Text style={styles.subtitle}>GPS Race Tracking</Text>
          </View>

          {/* Auth Form Card */}
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>
              {mode === 'login' ? 'Log ind' : 'Opret konto'}
            </Text>
            <Text style={styles.formSubtitle}>
              {mode === 'login'
                ? 'Log ind med din email eller Google konto'
                : 'Opret en gratis konto og kom i gang med at sejle'}
            </Text>

            {/* Google Sign-In Button */}
            <TouchableOpacity
              style={styles.googleButton}
              onPress={handleGoogleLogin}
              disabled={loading}
            >
              <Text style={styles.googleIcon}>G</Text>
              <Text style={styles.googleButtonText}>Fortsæt med Google</Text>
            </TouchableOpacity>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>eller</Text>
              <View style={styles.dividerLine} />
            </View>

            {/* Name field (register only) */}
            {mode === 'register' && (
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Navn</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Dit fulde navn"
                  placeholderTextColor="#64748b"
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  autoComplete="name"
                  editable={!loading}
                />
              </View>
            )}

            {/* Email field */}
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="din@email.dk"
                placeholderTextColor="#64748b"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                autoCorrect={false}
                editable={!loading}
              />
            </View>

            {/* Password field */}
            <View style={styles.inputContainer}>
              <Text style={styles.inputLabel}>Adgangskode</Text>
              <TextInput
                style={styles.input}
                placeholder={mode === 'register' ? 'Mindst 8 tegn' : '••••••••'}
                placeholderTextColor="#64748b"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                editable={!loading}
              />
            </View>

            {/* Confirm password (register only) */}
            {mode === 'register' && (
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Bekræft adgangskode</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Gentag adgangskode"
                  placeholderTextColor="#64748b"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  autoComplete="new-password"
                  editable={!loading}
                />
              </View>
            )}

            {/* Error message */}
            {error && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Submit button */}
            <TouchableOpacity
              style={styles.submitButton}
              onPress={mode === 'login' ? handleEmailLogin : handleEmailRegister}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.submitButtonText}>
                  {mode === 'login' ? 'Log ind' : 'Opret konto'}
                </Text>
              )}
            </TouchableOpacity>

            {/* Switch mode */}
            <TouchableOpacity style={styles.switchButton} onPress={switchMode}>
              <Text style={styles.switchText}>
                {mode === 'login'
                  ? 'Har du ikke en konto? '
                  : 'Har du allerede en konto? '}
                <Text style={styles.switchTextHighlight}>
                  {mode === 'login' ? 'Opret konto' : 'Log ind'}
                </Text>
              </Text>
            </TouchableOpacity>
          </View>

          {/* Features */}
          <View style={styles.featureList}>
            <FeatureItem icon="📍" text="Background GPS tracking" />
            <FeatureItem icon="📊" text="Live speed and distance" />
            <FeatureItem icon="🗺️" text="Route map visualization" />
            <FeatureItem icon="🏆" text="Automatic race activity logging" />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  logoContainer: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 24,
  },
  logoCircle: {
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
  logoEmoji: {
    fontSize: 40,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 4,
  },
  formCard: {
    backgroundColor: '#0f1f38',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1e3d66',
    marginBottom: 24,
  },
  formTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#ffffff',
    textAlign: 'center',
    marginBottom: 4,
  },
  formSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    textAlign: 'center',
    marginBottom: 20,
  },
  googleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderRadius: 10,
    gap: 10,
  },
  googleIcon: {
    fontSize: 18,
    fontWeight: '700',
    color: '#4285F4',
  },
  googleButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1f2937',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#1e3d66',
  },
  dividerText: {
    color: '#64748b',
    fontSize: 12,
    marginHorizontal: 12,
    textTransform: 'uppercase',
  },
  inputContainer: {
    marginBottom: 12,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#cbd5e1',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0a1628',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    color: '#e0f2fe',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#1e3d66',
  },
  errorContainer: {
    backgroundColor: '#3b1a1a',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 12,
    marginTop: 4,
  },
  errorText: {
    color: '#fca5a5',
    fontSize: 13,
    textAlign: 'center',
  },
  submitButton: {
    backgroundColor: '#e85d2a',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 4,
    shadowColor: '#e85d2a',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  submitButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
  },
  switchButton: {
    marginTop: 16,
    alignItems: 'center',
  },
  switchText: {
    color: '#94a3b8',
    fontSize: 14,
  },
  switchTextHighlight: {
    color: '#e85d2a',
    fontWeight: '600',
  },
  featureList: {
    gap: 10,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#162d4d',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  featureIcon: {
    fontSize: 18,
    marginRight: 10,
  },
  featureText: {
    fontSize: 14,
    color: '#e0f2fe',
    fontWeight: '500',
  },
});
