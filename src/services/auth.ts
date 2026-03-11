/**
 * Auth Service
 * 
 * Manages authentication state for the native app.
 * Uses SecureStore to persist the session cookie obtained
 * via the OAuth WebView login flow.
 */

import * as SecureStore from 'expo-secure-store';
import { CONFIG } from '../config';
import type { UserProfile } from '../types/tracking';

/** Get the stored session cookie */
export async function getSessionCookie(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(CONFIG.STORAGE_KEYS.SESSION_COOKIE);
  } catch {
    return null;
  }
}

/** Store the session cookie after login */
export async function setSessionCookie(cookie: string): Promise<void> {
  await SecureStore.setItemAsync(CONFIG.STORAGE_KEYS.SESSION_COOKIE, cookie);
}

/** Clear the session cookie (logout) */
export async function clearSessionCookie(): Promise<void> {
  await SecureStore.deleteItemAsync(CONFIG.STORAGE_KEYS.SESSION_COOKIE);
}

/** Get cached user data */
export async function getCachedUser(): Promise<UserProfile | null> {
  try {
    const data = await SecureStore.getItemAsync(CONFIG.STORAGE_KEYS.USER_DATA);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/** Cache user data locally */
export async function setCachedUser(user: UserProfile): Promise<void> {
  await SecureStore.setItemAsync(
    CONFIG.STORAGE_KEYS.USER_DATA,
    JSON.stringify(user)
  );
}

/** Clear cached user data */
export async function clearCachedUser(): Promise<void> {
  await SecureStore.deleteItemAsync(CONFIG.STORAGE_KEYS.USER_DATA);
}

/** Check if user is authenticated (has a session cookie) */
export async function isAuthenticated(): Promise<boolean> {
  const cookie = await getSessionCookie();
  return cookie !== null && cookie.length > 0;
}

/** Full logout - clear all auth data */
export async function logout(): Promise<void> {
  await clearSessionCookie();
  await clearCachedUser();
}

/**
 * Build the OAuth login URL for WebView.
 * 
 * The flow is:
 * 1. Open WebView to Manus OAuth portal
 * 2. User logs in
 * 3. OAuth redirects to /api/oauth/callback on our backend
 * 4. Backend sets the session cookie
 * 5. We intercept the cookie from the WebView response
 */
export function buildLoginUrl(redirectUri: string): string {
  const state = btoa(redirectUri);
  const url = new URL(`${CONFIG.OAUTH_PORTAL_URL}/app-auth`);
  url.searchParams.set('appId', CONFIG.APP_ID);
  url.searchParams.set('redirectUri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('type', 'signIn');
  return url.toString();
}

/**
 * Extract session cookie from Set-Cookie header or cookie string.
 * Looks for the app_session_id cookie.
 */
export function extractSessionCookie(cookieString: string): string | null {
  const cookies = cookieString.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, ...valueParts] = cookie.split('=');
    if (name?.trim() === CONFIG.COOKIE_NAME) {
      return valueParts.join('=').trim();
    }
  }
  return null;
}
