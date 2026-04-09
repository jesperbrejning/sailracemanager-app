/**
 * Tracking Types
 * 
 * These types mirror the backend tRPC router inputs/outputs
 * for the tracking endpoints.
 */

/** A single GPS point to send to the backend */
export interface TrackingPoint {
  latitude: number;
  longitude: number;
  accuracy?: number;
  altitude?: number;
  altitudeAccuracy?: number;
  speed?: number;
  heading?: number;
  timestamp: number; // Unix ms
  /** Heel angle in degrees at time of measurement. Positive = starboard, Negative = port. */
  heelAngle?: number;
  /** Pitch angle in degrees. Positive = bow up, Negative = bow down. */
  pitchAngle?: number;
  /** Whether GPS position was corrected for heel displacement */
  heelCorrected?: boolean;
  /** Tilt-compensated magnetic heading (HDG) in degrees (0-360, 0=North). */
  hdg?: number;
  /** Course Over Ground (COG) from GPS in degrees (0-360, 0=North). Same as GPS heading. */
  cog?: number;
}

/** Input for tracking.start */
export interface StartTrackingInput {
  eventId?: number;
  raceId?: number;
  raceNumber?: number;
  deviceInfo?: string;
}

/** Output from tracking.start */
export interface StartTrackingOutput {
  sessionId: number;
}

/** Input for tracking.sendPoints */
export interface SendPointsInput {
  sessionId: number;
  points: TrackingPoint[];
}

/** Output from tracking.sendPoints */
export interface SendPointsOutput {
  received: number;
  totalPoints: number;
}

/** Input for tracking.stop */
export interface StopTrackingInput {
  sessionId: number;
}

/** Stats returned when stopping a session */
export interface TrackingStats {
  totalPoints: number;
  totalDistanceMeters: number;
  avgSpeedKnots: string;
  maxSpeedKnots: string;
}

/** Output from tracking.stop */
export interface StopTrackingOutput {
  success: boolean;
  stats: TrackingStats;
}

/** A tracking session from myHistory */
export interface TrackingSession {
  id: number;
  userId: number;
  eventId: number | null;
  raceId: number | null;
  raceNumber: number | null;
  status: 'active' | 'completed' | 'abandoned';
  startedAt: string;
  endedAt: string | null;
  totalPoints: number | null;
  totalDistanceMeters: number | null;
  avgSpeedKnots: string | null;
  maxSpeedKnots: string | null;
  deviceInfo: string | null;
}

/** Current tracking state in the app */
export interface TrackingState {
  isTracking: boolean;
  sessionId: number | null;
  pointsCollected: number;
  pointsSent: number;
  currentPosition: TrackingPoint | null;
  accuracy: number | null;
  speedKnots: number | null;
  distanceMeters: number;
  error: string | null;
  gpsStatus: 'idle' | 'acquiring' | 'active' | 'error' | 'denied';
  duration: number; // seconds
  /** Current heel angle in degrees. Positive = starboard, Negative = port. */
  heelAngle: number;
  /** Current pitch angle in degrees. Positive = bow up, Negative = bow down. */
  pitchAngle: number;
  /** Whether heel correction is active */
  heelCorrectionActive: boolean;
  /** Tilt-compensated magnetic heading (HDG) in degrees (0-360). Null if magnetometer unavailable. */
  hdg: number | null;
  /** Course Over Ground (COG) from GPS in degrees (0-360). Null if not moving. */
  cog: number | null;
}

/** An event the user can track for */
export interface SailEvent {
  id: number;
  name: string;
  description: string | null;
  startDate: string | null;
  endDate: string | null;
  boatClass: string | null;
  organizer: string | null;
  location: string | null;
  status: string;
}

/** User profile from auth.me */
export interface UserProfile {
  id: number;
  openId: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  role: string;
  sailingClub: string | null;
}
