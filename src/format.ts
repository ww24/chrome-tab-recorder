import type { RecordingState } from './handler'

/**
 * Format elapsed milliseconds as hh:mm for tooltip display.
 * Clamps at 23:59 and appends '+' if exceeded.
 */
export function formatElapsedHHMM(elapsedMs: number): string {
    const MAX_MINUTES = 24 * 60 - 1 // 23:59
    const rawMinutes = Math.max(0, Math.floor(elapsedMs / 60000))
    const totalMinutes = Math.min(rawMinutes, MAX_MINUTES)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    const suffix = rawMinutes > MAX_MINUTES ? '+' : ''
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}${suffix}`
}

/**
 * Build the recording tooltip title string.
 * Uses a fixed timestamp so the caller controls the current time.
 */
export function buildRecordingTitle(appName: string, state: RecordingState, now: number = Date.now()): string {
    const elapsed = state.startAtMs != null ? formatElapsedHHMM(now - state.startAtMs) : '00:00'
    const video = state.recordingMode !== 'audio-only' ? 'on' : 'off'
    const audio = state.recordingMode !== 'video-only' ? 'on' : 'off'
    const mic = state.micEnabled ? 'on' : 'off'
    return [
        appName,
        `Recording (${elapsed})`,
        `video: ${video} / audio: ${audio} / mic: ${mic}`,
        'Click to stop recording.',
    ].join('\n')
}

/**
 * Format elapsed milliseconds as hh:mm:ss for record list display.
 * Clamps at 23:59:59 and appends '+' if exceeded.
 */
export function formatElapsedTime(elapsedMs: number): string {
    const MAX_SECONDS = 24 * 3600 - 1 // 23:59:59
    const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
    const clamped = Math.min(totalSeconds, MAX_SECONDS)
    const hours = Math.floor(clamped / 3600)
    const minutes = Math.floor((clamped % 3600) / 60)
    const seconds = clamped % 60
    const suffix = totalSeconds > MAX_SECONDS ? '+' : ''
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}${suffix}`
}
