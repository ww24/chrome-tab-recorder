import type { TranscriptionSegment } from './types'

/**
 * Format seconds to WebVTT timestamp (HH:MM:SS.mmm)
 */
export function formatVttTimestamp(seconds: number): string {
    const { h, m, s, ms } = formatTimestamp(seconds)
    return `${h}:${m}:${s}.${ms}`
}

/**
 * Format seconds to SRT timestamp (HH:MM:SS,mmm)
 */
export function formatSrtTimestamp(seconds: number): string {
    const { h, m, s, ms } = formatTimestamp(seconds)
    return `${h}:${m}:${s},${ms}`
}

function formatTimestamp(seconds: number) {
    if (isNaN(seconds) || seconds < 0) seconds = 0
    const totalMillis = Math.round(seconds * 1000)
    const hours = Math.floor(totalMillis / 3_600_000)
    const minutes = Math.floor((totalMillis % 3_600_000) / 60_000)
    const secs = Math.floor((totalMillis % 60_000) / 1000)
    const millis = totalMillis % 1000

    const h = hours.toString().padStart(2, '0')
    const m = minutes.toString().padStart(2, '0')
    const s = secs.toString().padStart(2, '0')
    const ms = millis.toString().padStart(3, '0')

    return { h, m, s, ms }
}

/**
 * Normalizes line endings to \n and collapses blank lines in cue text.
 */
export function normalizeCueText(text: string): string {
    return text
        .replace(/\r\n|\r/g, '\n')
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n')
}

/**
 * Converts transcription segments into a WebVTT formatted string.
 */
export function segmentsToVTT(segments: TranscriptionSegment[]): string {
    const lines = ['WEBVTT', '']
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        const start = formatVttTimestamp(seg.startSec)
        const end = formatVttTimestamp(seg.endSec)
        lines.push((i + 1).toString())
        lines.push(`${start} --> ${end}`)
        lines.push(normalizeCueText(seg.text))
        lines.push('')
    }
    return lines.join('\n')
}

/**
 * Converts transcription segments into a SubRip (SRT) formatted string.
 */
export function segmentsToSRT(segments: TranscriptionSegment[]): string {
    const blocks: string[] = []
    for (let i = 0; i < segments.length; i++) {
        const seg = segments[i]
        const start = formatSrtTimestamp(seg.startSec)
        const end = formatSrtTimestamp(seg.endSec)
        const block = [(i + 1).toString(), `${start} --> ${end}`, normalizeCueText(seg.text)].join('\n')
        blocks.push(block)
    }
    return blocks.join('\n\n') + (blocks.length > 0 ? '\n' : '')
}
