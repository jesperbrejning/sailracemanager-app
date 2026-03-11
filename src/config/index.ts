/**
 * App Configuration
 * 
 * Central configuration for the SailRaceManager native app.
 * The API_BASE_URL points to the production SailRaceManager backend.
 */

export const CONFIG = {
  // Backend API
  API_BASE_URL: 'https://sailracemanager.com',
  TRPC_ENDPOINT: '/api/trpc',

  // Auth - email/password + Google login
  // Google Client ID is optional - set it to enable Google Sign-In
  GOOGLE_CLIENT_ID: '',  // Set your Google Client ID here if needed

  // GPS Tracking
  GPS: {
    /** How often to send batched points to server (ms) */
    BATCH_INTERVAL_MS: 5000,
    /** Minimum time between GPS readings (ms) */
    MIN_UPDATE_INTERVAL_MS: 1000,
    /** Maximum points per batch send */
    MAX_BATCH_SIZE: 100,
    /** Minimum accuracy to accept a GPS point (meters) */
    MAX_ACCURACY_METERS: 200,
    /** Maximum segment distance to count (meters) - filter GPS jumps */
    MAX_SEGMENT_DISTANCE_METERS: 5000,
    /** Background task name */
    BACKGROUND_TASK_NAME: 'SAILRACE_BACKGROUND_TRACKING',
    /** Foreground service notification title */
    NOTIFICATION_TITLE: 'SailRaceManager GPS Tracking',
    /** Foreground service notification body */
    NOTIFICATION_BODY: 'Recording your sailing route...',
  },

  // Storage keys
  STORAGE_KEYS: {
    SESSION_COOKIE: 'session_cookie',
    USER_DATA: 'user_data',
    PENDING_POINTS: 'pending_gps_points',
    ACTIVE_SESSION: 'active_tracking_session',
    TRACKING_HISTORY: 'tracking_history',
  },

  // Cookie name (must match backend - from shared/const.ts)
  COOKIE_NAME: 'app_session_id',
} as const;

/** Meters per second to knots conversion factor */
export const MS_TO_KNOTS = 1.94384;

/** Meters to nautical miles */
export const METERS_TO_NM = 0.000539957;
