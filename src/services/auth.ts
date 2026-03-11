/**
 * Auth Service
 * 
 * Manages authentication state for the native app.
 * Uses SecureStore to persist the session cookie obtained
 * via email/password or Google login.
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
