# SailRaceManager GPS Tracking App

Native Android app for real-time GPS tracking during sailing races. Built with React Native and Expo, this app supplements the web-based tracking at [sailracemanager.com/tracking](https://sailracemanager.com/tracking) with reliable **background GPS tracking** that works even when the phone screen is off.

## Key Features

- **Background GPS Tracking**: Uses Android Foreground Service to maintain GPS tracking when the screen is off or the app is minimized. Essential for 1-4 hour sailing races.
- **Offline Batching**: GPS points are stored locally when offline and automatically synced when connectivity returns.
- **Live Map**: Real-time map showing your sailing route with position marker and accuracy circle.
- **Speed & Distance**: Live speed display in knots with distance calculation using Haversine formula.
- **tRPC Backend Integration**: Type-safe communication with the SailRaceManager backend using the same API as the web app.
- **Automatic Activity Creation**: When you stop tracking, the backend automatically creates a sailing activity with route, stats, and achievements.
- **Session Recovery**: If the app is killed during tracking, it recovers the active session on restart.

## Architecture

```
sailracemanager-app/
├── App.tsx                          # Main app component with tRPC + auth providers
├── index.ts                         # Entry point (registers background task first)
├── app.json                         # Expo config with Android permissions
├── package.json                     # Dependencies
├── tsconfig.json                    # TypeScript config
├── src/
│   ├── config/
│   │   └── index.ts                 # App configuration (API URLs, GPS settings)
│   ├── types/
│   │   └── tracking.ts              # TypeScript types matching backend API
│   ├── services/
│   │   ├── auth.ts                  # Session cookie management (SecureStore)
│   │   ├── trpc.ts                  # tRPC client with cookie auth headers
│   │   ├── backgroundTracking.ts    # expo-location + TaskManager background GPS
│   │   └── offlineStorage.ts        # AsyncStorage for offline GPS point batching
│   ├── hooks/
│   │   ├── useTracking.ts           # Main tracking hook (GPS + tRPC + offline)
│   │   └── useAuth.ts               # Authentication state hook
│   ├── screens/
│   │   ├── LoginScreen.tsx          # OAuth login via WebView
│   │   ├── EventSelectScreen.tsx    # Choose event or free sailing
│   │   ├── ActiveTrackingScreen.tsx # Live tracking with map + stats
│   │   ├── HistoryScreen.tsx        # Past tracking sessions
│   │   └── ProfileScreen.tsx        # User profile + settings
│   ├── navigation/
│   │   └── AppNavigator.tsx         # Stack + tab navigation
│   └── utils/
│       └── geo.ts                   # Haversine distance, speed conversion
└── assets/                          # App icons and splash screen
```

## How It Works

### GPS Tracking Flow

1. **User starts tracking** → `tracking.start` tRPC mutation creates a session on the backend
2. **expo-location starts** → Background location updates via Android Foreground Service
3. **Points are buffered** → GPS points collected in memory, flushed every 5 seconds
4. **Batch send to server** → `tracking.sendPoints` tRPC mutation sends up to 100 points per batch
5. **Offline fallback** → If server is unreachable, points are stored in AsyncStorage
6. **User stops tracking** → Remaining points flushed, `tracking.stop` calculates stats and creates activity
7. **Auto-sync** → When app returns to foreground, pending offline batches are synced

### Background Tracking (Android)

The app uses `expo-location` with `expo-task-manager` to create an Android **Foreground Service**. This is the only reliable way to maintain GPS tracking on modern Android (8+) when the screen is off.

The Foreground Service shows a persistent notification: "SailRaceManager GPS Tracking - Recording your sailing route..."

Key Android permissions:
- `ACCESS_FINE_LOCATION` - High-accuracy GPS
- `ACCESS_BACKGROUND_LOCATION` - GPS when app is in background
- `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION` - Foreground Service for persistent tracking
- `WAKE_LOCK` - Prevent CPU sleep during tracking

### Authentication

The app authenticates with the SailRaceManager backend using the same OAuth flow as the web app:

1. User opens OAuth login in system browser
2. Authenticates via Manus OAuth (Google, email, etc.)
3. Backend sets session cookie (`app_session_id`)
4. App stores cookie in SecureStore
5. All tRPC requests include the cookie in the `Cookie` header

## Setup & Development

### Prerequisites

- Node.js 18+
- Android Studio (for emulator) or a physical Android device
- Expo CLI: `npm install -g @expo/cli`
- EAS CLI (for building APK): `npm install -g eas-cli`

### Install Dependencies

```bash
cd sailracemanager-app
npx expo install
```

### Configure

Edit `src/config/index.ts` to set:

```typescript
export const CONFIG = {
  API_BASE_URL: 'https://sailracemanager.com', // Your backend URL
  APP_ID: 'your-manus-app-id',                 // From Manus OAuth settings
  OAUTH_PORTAL_URL: 'https://auth.manus.im',   // Manus OAuth portal
  // ...
};
```

The `APP_ID` must match the `VITE_APP_ID` environment variable used by the web app.

### Run in Development

```bash
# Start Expo dev server
npx expo start

# Run on Android emulator
npx expo start --android

# Run on physical device (scan QR code with Expo Go)
npx expo start
```

**Note**: Background location tracking does NOT work in Expo Go. You must build a development build or production APK to test background GPS.

### Build Development Build

```bash
# Create a development build for Android
npx expo run:android

# Or use EAS Build for cloud builds
eas build --platform android --profile development
```

### Build Production APK

```bash
# Configure EAS (first time only)
eas build:configure

# Build APK for internal distribution
eas build --platform android --profile preview

# Build AAB for Google Play Store
eas build --platform android --profile production
```

### EAS Build Configuration

Create `eas.json` in the project root:

```json
{
  "cli": {
    "version": ">= 3.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      }
    },
    "production": {}
  }
}
```

## Backend API Endpoints Used

The app communicates with the SailRaceManager backend via tRPC:

| Endpoint | Type | Description |
|----------|------|-------------|
| `auth.me` | Query | Get current user profile |
| `auth.logout` | Mutation | End session |
| `tracking.start` | Mutation | Create tracking session (eventId, raceId, deviceInfo) |
| `tracking.sendPoints` | Mutation | Send batched GPS points (max 100 per batch) |
| `tracking.stop` | Mutation | End session, calculate stats, create activity |
| `tracking.getActive` | Query | Check for active session (recovery) |
| `tracking.myHistory` | Query | Get past tracking sessions |
| `events.list` | Query | List available events |

## GPS Point Format

Each GPS point sent to the backend:

```typescript
{
  latitude: number,      // -90 to 90
  longitude: number,     // -180 to 180
  accuracy?: number,     // meters
  altitude?: number,     // meters above sea level
  altitudeAccuracy?: number,
  speed?: number,        // meters/second
  heading?: number,      // degrees (0 = north)
  timestamp: number,     // Unix milliseconds
}
```

## Battery Optimization

The app is designed for 1-4 hour sailing races with these battery-saving measures:

- GPS updates every ~1 second (configurable)
- Points are batched and sent every 5 seconds (not individually)
- Offline storage prevents retries when no connection
- No continuous map rendering when screen is off

Typical battery usage: ~5-8% per hour of tracking (varies by device).

## Troubleshooting

### GPS not working in background
- Ensure "Allow all the time" location permission is granted
- Check that battery optimization is disabled for the app
- On some devices (Xiaomi, Huawei), you need to manually allow background activity in device settings

### Points not syncing
- Check internet connectivity
- The app will automatically sync pending points when connectivity returns
- Check the "collected vs sent" counter on the tracking screen

### Login issues
- Ensure the `APP_ID` in config matches your Manus OAuth app
- The OAuth callback URL must be `https://sailracemanager.com/api/oauth/callback`

## Technology Stack

- **React Native** 0.83 with **Expo** SDK 55
- **expo-location** for GPS with background support
- **expo-task-manager** for Android Foreground Service
- **@trpc/client** + **@trpc/react-query** for type-safe API calls
- **react-native-maps** for map display
- **expo-secure-store** for encrypted session storage
- **@react-native-async-storage/async-storage** for offline GPS point storage
- **@react-navigation/native** for screen navigation
