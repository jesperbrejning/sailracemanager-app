/**
 * useAuth Hook
 * 
 * Manages authentication state for the native app.
 * Uses tRPC auth.me to check if the session cookie is valid.
 */

import { useState, useCallback, useEffect } from 'react';
import { trpc } from '../services/trpc';
import {
  getSessionCookie,
  clearSessionCookie,
  clearCachedUser,
  getCachedUser,
  setCachedUser,
} from '../services/auth';
import type { UserProfile } from '../types/tracking';

export function useAuth() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    enabled: true,
  });

  // Sync query result to local state
  useEffect(() => {
    if (meQuery.data) {
      setUser(meQuery.data as UserProfile);
      setCachedUser(meQuery.data as UserProfile).catch(() => {});
      setError(null);
    } else if (meQuery.error) {
      setUser(null);
      setError(meQuery.error.message);
    }
    setLoading(meQuery.isLoading);
  }, [meQuery.data, meQuery.error, meQuery.isLoading]);

  // Try to load cached user on mount (for faster initial render)
  useEffect(() => {
    getCachedUser().then((cached) => {
      if (cached && !user) {
        setUser(cached);
      }
    });
  }, []);

  const logout = useCallback(async () => {
    try {
      // Call server logout
      // Note: This may fail if already logged out, that's ok
    } catch {
      // Ignore
    }
    await clearSessionCookie();
    await clearCachedUser();
    setUser(null);
  }, []);

  const refresh = useCallback(async () => {
    await meQuery.refetch();
  }, [meQuery]);

  const isAuthenticated = user !== null;

  return {
    user,
    loading,
    error,
    isAuthenticated,
    logout,
    refresh,
  };
}
