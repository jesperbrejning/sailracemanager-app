/**
 * Magnetometer Debug Logger
 *
 * Logs raw magnetometer values, tilt angles and computed HDG to a CSV file
 * on the device's document directory. The file can be shared/exported from
 * within the app so the developer can analyse the raw sensor data.
 *
 * Usage:
 *   MagDebugLogger.start()   - begin logging
 *   MagDebugLogger.log(...)  - append a row
 *   MagDebugLogger.stop()    - stop logging
 *   MagDebugLogger.share()   - open share sheet to send the file
 */

import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';

const LOG_FILENAME = 'srm_mag_debug.csv';
const LOG_PATH = `${FileSystem.documentDirectory}${LOG_FILENAME}`;

let isLogging = false;
let rowCount = 0;

const CSV_HEADER =
  'timestamp_ms,magX,magY,magZ,heel_deg,pitch_deg,Xh,Yh,hdg_deg\n';

export const MagDebugLogger = {
  /** Start a new log session - overwrites any previous log */
  async start(): Promise<void> {
    try {
      await FileSystem.writeAsStringAsync(LOG_PATH, CSV_HEADER, {
        encoding: FileSystem.EncodingType.UTF8,
      });
      isLogging = true;
      rowCount = 0;
      console.log(`[MagDebug] Logging started → ${LOG_PATH}`);
    } catch (e) {
      console.error('[MagDebug] Failed to start log:', e);
    }
  },

  /** Append one row of sensor data to the log */
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
    if (!isLogging) return;

    // Limit log to 10 000 rows to avoid huge files (~600 KB)
    if (rowCount >= 10000) return;

    const row =
      `${Date.now()},` +
      `${magX.toFixed(2)},${magY.toFixed(2)},${magZ.toFixed(2)},` +
      `${heel.toFixed(2)},${pitch.toFixed(2)},` +
      `${Xh.toFixed(4)},${Yh.toFixed(4)},` +
      `${hdg.toFixed(1)}\n`;

    try {
      await FileSystem.writeAsStringAsync(LOG_PATH, row, {
        encoding: FileSystem.EncodingType.UTF8,
        // Append mode
        ...(({ append: true } as unknown) as object),
      });
      rowCount++;
    } catch {
      // Silently ignore write errors during logging
    }
  },

  /** Stop logging */
  stop(): void {
    isLogging = false;
    console.log(`[MagDebug] Logging stopped. ${rowCount} rows written.`);
  },

  /** Open the system share sheet so the user can email/AirDrop/etc. the file */
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
