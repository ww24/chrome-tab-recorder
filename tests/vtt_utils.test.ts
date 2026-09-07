import { describe, it, expect } from 'vitest'
import {
    formatVttTimestamp,
    formatSrtTimestamp,
    segmentsToVTT,
    segmentsToSRT,
    normalizeCueText,
} from '../src/transcription/vtt'
import type { TranscriptionSegment } from '../src/transcription/types'

describe('vtt_utils', () => {
    describe('formatVttTimestamp', () => {
        it('formats zero seconds', () => {
            expect(formatVttTimestamp(0)).toBe('00:00:00.000')
        })

        it('formats seconds with milliseconds', () => {
            expect(formatVttTimestamp(65.123)).toBe('00:01:05.123')
        })

        it('formats hours properly', () => {
            expect(formatVttTimestamp(3661.5)).toBe('01:01:01.500')
        })
    })

    describe('formatSrtTimestamp', () => {
        it('formats zero seconds with comma', () => {
            expect(formatSrtTimestamp(0)).toBe('00:00:00,000')
        })

        it('formats seconds with comma', () => {
            expect(formatSrtTimestamp(65.123)).toBe('00:01:05,123')
        })
    })

    describe('normalizeCueText', () => {
        it('normalizes CRLF and CR line endings to LF', () => {
            expect(normalizeCueText('Line 1\r\nLine 2\rLine 3')).toBe('Line 1\nLine 2\nLine 3')
        })

        it('collapses consecutive blank lines into single line breaks', () => {
            expect(normalizeCueText('Line 1\n\nLine 2\n\n\nLine 3')).toBe('Line 1\nLine 2\nLine 3')
        })

        it('collapses lines containing only whitespace', () => {
            expect(normalizeCueText('Line 1\n   \nLine 2\n\t\nLine 3')).toBe('Line 1\nLine 2\nLine 3')
        })

        it('trims leading and trailing blank lines and whitespace', () => {
            expect(normalizeCueText('\n\n  Line 1  \n\n')).toBe('Line 1')
        })

        it('handles empty or whitespace-only text', () => {
            expect(normalizeCueText('')).toBe('')
            expect(normalizeCueText('   \n\n \t \n  ')).toBe('')
        })
    })

    describe('segmentsToVTT', () => {
        it('converts segments to WebVTT format', () => {
            const segments: TranscriptionSegment[] = [
                { startSec: 1.0, endSec: 3.5, text: 'Hello world' },
                { startSec: 4.0, endSec: 6.2, text: 'This is a test.' },
            ]

            const expected = [
                'WEBVTT',
                '',
                '1',
                '00:00:01.000 --> 00:00:03.500',
                'Hello world',
                '',
                '2',
                '00:00:04.000 --> 00:00:06.200',
                'This is a test.',
                '',
            ].join('\n')

            expect(segmentsToVTT(segments)).toBe(expected)
        })

        it('normalizes line endings and collapses blank lines in cue text', () => {
            const segments: TranscriptionSegment[] = [
                {
                    startSec: 1.0,
                    endSec: 3.5,
                    text: 'First line\r\n\r\nSecond line\n  \nThird line',
                },
                {
                    startSec: 4.0,
                    endSec: 6.2,
                    text: '\n\nSingle line\n\n',
                },
            ]

            const expected = [
                'WEBVTT',
                '',
                '1',
                '00:00:01.000 --> 00:00:03.500',
                'First line\nSecond line\nThird line',
                '',
                '2',
                '00:00:04.000 --> 00:00:06.200',
                'Single line',
                '',
            ].join('\n')

            expect(segmentsToVTT(segments)).toBe(expected)
        })
    })

    describe('segmentsToSRT', () => {
        it('converts segments to SRT format', () => {
            const segments: TranscriptionSegment[] = [
                { startSec: 1.0, endSec: 3.5, text: 'Hello world' },
                { startSec: 4.0, endSec: 6.2, text: 'This is a test.' },
            ]

            const expected = [
                '1',
                '00:00:01,000 --> 00:00:03,500',
                'Hello world',
                '',
                '2',
                '00:00:04,000 --> 00:00:06,200',
                'This is a test.',
                '',
            ].join('\n')

            expect(segmentsToSRT(segments)).toBe(expected)
        })

        it('normalizes line endings and collapses blank lines in cue text', () => {
            const segments: TranscriptionSegment[] = [
                {
                    startSec: 1.0,
                    endSec: 3.5,
                    text: 'First line\r\n\r\nSecond line\n  \nThird line',
                },
                {
                    startSec: 4.0,
                    endSec: 6.2,
                    text: '\n\nSingle line\n\n',
                },
            ]

            const expected = [
                '1',
                '00:00:01,000 --> 00:00:03,500',
                'First line\nSecond line\nThird line',
                '',
                '2',
                '00:00:04,000 --> 00:00:06,200',
                'Single line',
                '',
            ].join('\n')

            expect(segmentsToSRT(segments)).toBe(expected)
        })
    })
})
