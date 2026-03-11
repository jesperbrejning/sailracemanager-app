/**
 * Geo Utilities
 * 
 * Geographic calculation helpers for distance, speed, etc.
 */

import { MS_TO_KNOTS, METERS_TO_NM } from '../config';

/**
 * Calculate the Haversine distance between two GPS coordinates.
 * @returns Distance in meters
 */
export function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371000; // Earth's radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Convert meters/second to knots */
export function msToKnots(metersPerSecond: number): number {
  return metersPerSecond * MS_TO_KNOTS;
}

/** Convert meters to nautical miles */
export function metersToNm(meters: number): number {
  return meters * METERS_TO_NM;
}

/** Format duration in seconds to HH:MM:SS */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/** Format speed in knots with 1 decimal */
export function formatSpeed(knots: number | null): string {
  if (knots === null || knots === undefined) return '0.0';
  return knots.toFixed(1);
}

/** Format distance in meters to a human-readable string */
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const nm = metersToNm(meters);
  return `${nm.toFixed(2)} nm`;
}

/** Calculate bearing between two points (degrees, 0 = north) */
export function calculateBearing(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const toDeg = (rad: number) => (rad * 180) / Math.PI;
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  const bearing = toDeg(Math.atan2(y, x));
  return (bearing + 360) % 360;
}
