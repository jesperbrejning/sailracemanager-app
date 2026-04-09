/**
 * Magnetometer Debug Logger
 *
 * Logs raw magnetometer values, tilt angles and computed HDG to a CSV file
 * on the device's document directory. Uses an in-memory buffer that is
 * flushed to disk periodically to avoid the expo-file-system append issue.
 *
 * Usage:
 *   MagDebugLogger.start()   - begin logging
 *   MagDebugLogger.log(...)  - buffer a row (auto-flushes every 50 rows)
 *   MagDebugLogger.stop()    - flush remaining rows and stop logging
 *   MagDebugLogger.share()   - open share sheet to send the file
 */

import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const LOG_FILENAME = 'srm_mag_debug.csv';
const LOG_PATH = `${FileSystem.documentDirectory}${LOG_FILENAME}`;
const FLUSH_EVERY = 50; // flush buffer to disk every N rows
const MAX_ROWS = 10000;

const CSV_HEADER = 'timestamp_ms,magX,magY,magZ,heel_deg,pitch_deg,Xh,Yh,hdg_deg\n';

let isLogging = false;
let rowCount = 0;
let buffer: string[] = [];

/** Flush the in-memory buffer to disk by reading existing content and appending */
async function flush(): Promise<void> {
  if (buffer.length === 0) return;
  const chunk = buffer.join('');
  buffer = [];

  try {
    // Read existing content
    let existing = '';
    const info = await FileSystem.getInfoAsync(LOG_PATH);
    if (info.exists) {
      existing = await FileSystem.readAsStringAsync(LOG_PATH, {
        encoding: FileSystem.EncodingType.UTF8,
      });
    }
    // Write header + existing + new chunk
    await FileSystem.writeAsStringAsync(LOG_PATH, existing + chunk, {
      encoding: FileSystem.EncodingType.UTF8,
    });
  } catch (e) {
    console.error('[MagDebug] Flush failed:', e);
  }
}

export const MagDebugLogger = {
  /** Start a new log session - overwrites any previous log */
  async start(): Promise<void> {
    try {
      await FileSystem.writeAsStringAsync(LOG_PATH, CSV_HEADER, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      isLogging = true;
      rowCount = 0;
      buffer = [];
      console.log(`[MagDebug] Logging started → ${LOG_PATH}`);
    } catch (e) {
      console.error('[MagDebug] Failed to start log:', e);
    }
  },

  /** Buffer one row of sensor data; auto-flushes every FLUSH_EVERY rows */
  async log(
    magX: number,
    magY: number,
    magZ: number,
    heel: number,
    pitch: number,
    Xh: number,
    Yh: number,
    hdg: number,
  ): Promise<void> {
    if (!isLogging || rowCount >= MAX_ROWS) return;

    const row =
      `${Date.now()},` +
      `${magX.toFixed(2)},${magY.toFixed(2)},${magZ.toFixed(2)},` +
      `${heel.toFixed(2)},${pitch.toFixed(2)},` +
      `${Xh.toFixed(4)},${Yh.toFixed(4)},` +
      `${hdg.toFixed(1)}\n`;

    buffer.push(row);
    rowCount++;

    if (buffer.length >= FLUSH_EVERY) {
      await flush();
    }
  },

  /** Flush remaining rows and stop logging */
  async stop(): Promise<void> {
    isLogging = false;
    await flush();
    console.log(`[MagDebug] Logging stopped. ${rowCount} rows written to ${LOG_PATH}`);
  },

  /** Open the system share sheet so the user can email/send the CSV file */
  async share(): Promise<void> {
    try {
      const info = await FileSystem.getInfoAsync(LOG_PATH);
      if (!info.exists) {
        console.warn('[MagDebug] No log file found - start logging first');
        return;
      }

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        console.warn('[MagDebug] Sharing not available on this device');
        return;
      }

      await Sharing.shareAsync(LOG_PATH, {
        mimeType: 'text/csv',
        dialogTitle: 'Send magnetometer debug log',
        UTI: 'public.comma-separated-values-text',
      });
    } catch (e) {
      console.error('[MagDebug] Share failed:', e);
    }
  },

  get isActive(): boolean {
    return isLogging;
  },

  get rowCount(): number {
    return rowCount;
  },
};
