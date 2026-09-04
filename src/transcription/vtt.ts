import type { TranscriptionSegment } from './types'

const pad = (n: number, z = 2) => n.toString().padStart(z, '0')

/**
 * Formats seconds into WebVTT timestamp: HH:MM:SS.mmm
 */
export function formatVttTimestamp(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '00:00:00.000'
    const totalMs = Math.round(seconds * 1000)
    const ms = totalMs % 1000
    const totalSecs = Math.floor(totalMs / 1000)
    const secs = totalSecs % 60
    const mins = Math.floor(totalSecs / 60) % 60
    const hours = Math.floor(totalSecs / 3600)

    return `${pad(hours)}:${pad(mins)}:${pad(secs)}.${pad(ms, 3)}`
}

/**
 * Formats seconds into SRT timestamp: HH:MM:SS,mmm
 */
export function formatSrtTimestamp(seconds: number): string {
    return formatVttTimestamp(seconds).replace('.', ',')
}

/**
 * Generates WebVTT string from transcription segments
 */
export function segmentsToVtt(segments: TranscriptionSegment[]): string {
    let vtt = 'WEBVTT\n\n'
    for (const seg of segments) {
        vtt += `${seg.id}\n`
        vtt += `${formatVttTimestamp(seg.start)} --> ${formatVttTimestamp(seg.end)}\n`
        vtt += `${seg.text.trim()}\n\n`
    }
    return vtt
}

/**
 * Converts WebVTT string to SubRip (SRT) format
 */
export function vttToSrt(vtt: string): string {
    const lines = vtt.split(/\r?\n/)
    const srtLines: string[] = []

    let inHeader = true
    for (const line of lines) {
        if (inHeader) {
            if (line.trim() === '' || line.startsWith('WEBVTT') || line.startsWith('NOTE')) {
                if (line.trim() === '' && srtLines.length === 0) {
                    inHeader = false
                }
                continue
            }
            inHeader = false
        }

        // Replace timestamps from 00:00:00.000 to 00:00:00,000
        if (line.includes('-->')) {
            const converted = line.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, '$1,$2')
            srtLines.push(converted)
        } else {
            srtLines.push(line)
        }
    }

    return srtLines.join('\n').trim() + '\n'
}

/**
 * Generates SRT string directly from transcription segments
 */
export function segmentsToSrt(segments: TranscriptionSegment[]): string {
    let srt = ''
    for (const seg of segments) {
        srt += `${seg.id}\n`
        srt += `${formatSrtTimestamp(seg.start)} --> ${formatSrtTimestamp(seg.end)}\n`
        srt += `${seg.text.trim()}\n\n`
    }
    return srt
}

export interface ParsedCue {
    id: string
    start: number
    end: number
    text: string
    timeText: string
}

export function parseVttTime(timeStr: string): number {
    const parts = timeStr.trim().split(':')
    if (parts.length === 3) {
        const [hh, mm, ss] = parts
        return Number.parseFloat(hh) * 3600 + Number.parseFloat(mm) * 60 + Number.parseFloat(ss)
    } else if (parts.length === 2) {
        const [mm, ss] = parts
        return Number.parseFloat(mm) * 60 + Number.parseFloat(ss)
    }
    return 0
}

export function parseWebVTT(vttText: string): ParsedCue[] {
    const cues: ParsedCue[] = []
    const lines = vttText.split(/\r?\n/)

    let currentId = ''
    let currentTimeLine = ''
    let currentTextLines: string[] = []

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim()
        if (line === 'WEBVTT' || line.startsWith('NOTE')) continue

        if (line.includes('-->')) {
            currentTimeLine = line
        } else if (currentTimeLine && line !== '') {
            currentTextLines.push(line)
        } else if (line === '' && currentTimeLine) {
            const [startStr, endStr] = currentTimeLine.split('-->').map(s => s.trim())
            cues.push({
                id: currentId || String(cues.length + 1),
                start: parseVttTime(startStr),
                end: parseVttTime(endStr),
                text: currentTextLines.join('\n'),
                timeText: startStr.split('.')[0],
            })
            currentId = ''
            currentTimeLine = ''
            currentTextLines = []
        } else if (!currentTimeLine && line !== '') {
            currentId = line
        }
    }

    if (currentTimeLine && currentTextLines.length > 0) {
        const [startStr, endStr] = currentTimeLine.split('-->').map(s => s.trim())
        cues.push({
            id: currentId || String(cues.length + 1),
            start: parseVttTime(startStr),
            end: parseVttTime(endStr),
            text: currentTextLines.join('\n'),
            timeText: startStr.split('.')[0],
        })
    }

    return cues
}

export function findActiveCue(cues: ParsedCue[], currentTime: number): ParsedCue | undefined {
    return cues.find(c => currentTime >= c.start && currentTime < c.end)
}
