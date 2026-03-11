/**
 * SailRaceManager GPS Tracking App
 * 
 * Main entry point. Sets up:
 * - tRPC client with React Query
 * - Authentication state management
 * - Navigation (auth flow vs main app)
 * - Background tracking task registration
 */

import React, { useState, useEffect, useCallback } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { trpc, queryClient, createTrpcClient } from './src/services/trpc';
import { isAuthenticated as checkAuth } from './src/services/auth';
import AppNavigator from './src/navigation/AppNavigator';

// IMPORTANT: Import backgroundTracking at the top level to register
// the TaskManager task before any component renders.
import './src/services/backgroundTracking';

export default function App() {
  const [trpcClient] = useState(() => createTrpcClient());
  const [isAuth, setIsAuth] = useState<boolean | null>(null); // null = loading

  // Check auth state on mount
  useEffect(() => {
    checkAuth().then(setIsAuth);
  }, []);

  const handleLoginSuccess = useCallback(() => {
    setIsAuth(true);
    // Invalidate all queries to refetch with new auth
    queryClient.invalidateQueries();
  }, []);

  // Show nothing while checking auth (could add splash screen)
  if (isAuth === null) {
    return null;
  }

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" />
        <AppNavigator
          isAuthenticated={isAuth}
          onLoginSuccess={handleLoginSuccess}
        />
      </QueryClientProvider>
    </trpc.Provider>
  );
}
