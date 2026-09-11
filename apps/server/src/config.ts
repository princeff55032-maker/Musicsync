// Audio settings
export const AUDIO_LOW = 0.15;
export const AUDIO_HIGH = 1.0;
export const VOLUME_UP_RAMP_TIME = 0.5;
export const VOLUME_DOWN_RAMP_TIME = 0.5;

// Scheduling settings
export const MIN_SCHEDULE_TIME_MS = 200; // Fast responsive scheduling
export const DEFAULT_CLIENT_RTT_MS = 0; // Default RTT when no clients or initial value
const CAP_SCHEDULE_TIME_MS = 1_500; // Maximum scheduling delay

/**
 * Calculate dynamic scheduling delay based on maximum client RTT
 * @param maxRTT Maximum RTT among all clients in milliseconds
 * @returns Scheduling delay in milliseconds
 */
export function calculateScheduleTimeMs(maxRTT: number): number {
  // Use 1.2x max RTT + 80ms buffer for tight, low-latency sync
  const dynamicDelay = Math.max(MIN_SCHEDULE_TIME_MS, maxRTT * 1.2 + 80);

  // Cap at 1500ms to prevent excessive delays
  return Math.min(dynamicDelay, CAP_SCHEDULE_TIME_MS);
}
