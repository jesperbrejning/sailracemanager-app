/**
 * tRPC Client for React Native
 * 
 * Configures a tRPC client that sends the session cookie
 * with every request to the SailRaceManager backend.
 * 
 * Since we can't use browser cookies in React Native,
 * we manually attach the cookie header from SecureStore.
 */

import { createTRPCReact } from '@trpc/react-query';
import { httpBatchLink } from '@trpc/client';
import { QueryClient } from '@tanstack/react-query';
import superjson from 'superjson';
import { CONFIG } from '../config';
import { getSessionCookie } from './auth';

/**
 * We define a minimal type for the tRPC router.
 * In a monorepo setup, you'd import the actual AppRouter type.
 * For this standalone app, we use `any` and rely on runtime behavior.
 * 
 * The backend endpoints we use:
 * - auth.me (query) - get current user
 * - auth.logout (mutation) - logout
 * - tracking.start (mutation) - start tracking session
 * - tracking.sendPoints (mutation) - send GPS points
 * - tracking.stop (mutation) - stop tracking session
 * - tracking.getActive (query) - get active session
 * - tracking.myHistory (query) - get tracking history
 * - events.list (query) - list available events
 */
type AppRouter = any;

/** tRPC React hooks */
export const trpc = createTRPCReact<AppRouter>();

/** React Query client */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

/** Create the tRPC client with cookie auth */
export function createTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: `${CONFIG.API_BASE_URL}${CONFIG.TRPC_ENDPOINT}`,
        transformer: superjson,
        async headers() {
          const cookie = await getSessionCookie();
          if (cookie) {
            return {
              Cookie: `${CONFIG.COOKIE_NAME}=${cookie}`,
            };
          }
          return {};
        },
      }),
    ],
  });
}
