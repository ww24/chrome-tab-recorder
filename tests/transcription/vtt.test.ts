import { describe, it, expect } from 'vitest'
import {
    formatVttTimestamp,
    formatSrtTimestamp,
    segmentsToVtt,
    vttToSrt,
    segmentsToSrt,
    parseVttTime,
    parseWebVTT,
    findActiveCue,
} from '../../src/transcription/vtt'
import type { ParsedCue } from '../../src/transcription/vtt'

describe('formatVttTimestamp and formatSrtTimestamp', () => {
    it('formats seconds into HH:MM:SS.mmm for VTT', () => {
        expect(formatVttTimestamp(0)).toBe('00:00:00.000')
        expect(formatVttTimestamp(65.123)).toBe('00:01:05.123')
        expect(formatVttTimestamp(3661.004)).toBe('01:01:01.004')
        expect(formatVttTimestamp(-5)).toBe('00:00:00.000')
        expect(formatVttTimestamp(NaN)).toBe('00:00:00.000')
    })

    it('formats seconds into HH:MM:SS,mmm for SRT', () => {
        expect(formatSrtTimestamp(65.123)).toBe('00:01:05,123')
    })
})

describe('segmentsToVtt and segmentsToSrt', () => {
    const segments = [
        { id: 1, start: 0, end: 2.5, text: ' Hello world! ' },
        { id: 2, start: 3, end: 5.2, text: ' Second segment ' },
    ]

    it('generates valid WebVTT from segments', () => {
        const vtt = segmentsToVtt(segments)
        expect(vtt).toBe(
            'WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.500\nHello world!\n\n2\n00:00:03.000 --> 00:00:05.200\nSecond segment\n\n',
        )
    })

    it('generates valid SRT from segments', () => {
        const srt = segmentsToSrt(segments)
        expect(srt).toBe(
            '1\n00:00:00,000 --> 00:00:02,500\nHello world!\n\n2\n00:00:03,000 --> 00:00:05,200\nSecond segment\n\n',
        )
    })

    it('converts WebVTT to SRT', () => {
        const vtt = segmentsToVtt(segments)
        const srt = vttToSrt(vtt)
        expect(srt).toBe(
            '1\n00:00:00,000 --> 00:00:02,500\nHello world!\n\n2\n00:00:03,000 --> 00:00:05,200\nSecond segment\n',
        )
    })
})

describe('parseVttTime', () => {
    it('parses HH:MM:SS.mmm format', () => {
        expect(parseVttTime('01:02:03.456')).toBeCloseTo(3723.456)
        expect(parseVttTime('00:00:05.500')).toBeCloseTo(5.5)
    })

    it('parses MM:SS.mmm format', () => {
        expect(parseVttTime('02:30.500')).toBeCloseTo(150.5)
        expect(parseVttTime('00:10.000')).toBeCloseTo(10)
    })

    it('returns 0 for invalid time string', () => {
        expect(parseVttTime('invalid')).toBe(0)
        expect(parseVttTime('')).toBe(0)
    })
})

describe('parseWebVTT', () => {
    it('parses standard WebVTT cues properly', () => {
        const vtt = `WEBVTT

NOTE This is a comment

1
00:00:01.000 --> 00:00:04.000
First subtitle line

2
00:00:05.000 --> 00:00:08.500
Second subtitle line 1
Second subtitle line 2
`
        const cues = parseWebVTT(vtt)
        expect(cues).toHaveLength(2)

        expect(cues[0]).toEqual({
            id: '1',
            start: 1,
            end: 4,
            text: 'First subtitle line',
            timeText: '00:00:01',
        })

        expect(cues[1]).toEqual({
            id: '2',
            start: 5,
            end: 8.5,
            text: 'Second subtitle line 1\nSecond subtitle line 2',
            timeText: '00:00:05',
        })
    })

    it('handles VTT without IDs', () => {
        const vtt = `WEBVTT

00:01.000 --> 00:03.000
No ID subtitle
`
        const cues = parseWebVTT(vtt)
        expect(cues).toHaveLength(1)
        expect(cues[0].id).toBe('1')
        expect(cues[0].start).toBe(1)
        expect(cues[0].end).toBe(3)
        expect(cues[0].text).toBe('No ID subtitle')
    })

    it('handles trailing cue without empty line at the end', () => {
        const vtt = `WEBVTT

1
00:00:01.000 --> 00:00:02.000
Trailing cue`
        const cues = parseWebVTT(vtt)
        expect(cues).toHaveLength(1)
        expect(cues[0].text).toBe('Trailing cue')
    })
})

describe('findActiveCue', () => {
    const sampleCues: ParsedCue[] = [
        {
            id: '1',
            start: 1.0,
            end: 4.0,
            text: 'First line',
            timeText: '00:00:01',
        },
        {
            id: '2',
            start: 5.0,
            end: 8.0,
            text: 'Second line',
            timeText: '00:00:05',
        },
    ]

    it('returns cue when time is within start and end', () => {
        expect(findActiveCue(sampleCues, 1.0)).toEqual(sampleCues[0])
        expect(findActiveCue(sampleCues, 2.5)).toEqual(sampleCues[0])
        expect(findActiveCue(sampleCues, 3.99)).toEqual(sampleCues[0])
        expect(findActiveCue(sampleCues, 6.0)).toEqual(sampleCues[1])
    })

    it('returns undefined when in gap or out of range', () => {
        expect(findActiveCue(sampleCues, 0.5)).toBeUndefined()
        expect(findActiveCue(sampleCues, 4.0)).toBeUndefined()
        expect(findActiveCue(sampleCues, 4.5)).toBeUndefined()
        expect(findActiveCue(sampleCues, 9.0)).toBeUndefined()
    })
})
