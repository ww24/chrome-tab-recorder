import { describe, it, expect } from 'vitest'
import { isTranscriptionSegment, isTranscriptionResult } from '../src/transcription/types'
import type { TranscriptionResult, TranscriptionSegment } from '../src/transcription/types'

describe('isTranscriptionSegment', () => {
    const validSegment: TranscriptionSegment = {
        startSec: 1.25,
        endSec: 3.5,
        text: 'Valid segment text',
    }

    it('returns true for a valid segment', () => {
        expect(isTranscriptionSegment(validSegment)).toBe(true)
    })

    it('returns true when startSec equals endSec', () => {
        expect(isTranscriptionSegment({ startSec: 2.0, endSec: 2.0, text: '' })).toBe(true)
    })

    it('returns true when text is empty string', () => {
        expect(isTranscriptionSegment({ startSec: 0, endSec: 1.0, text: '' })).toBe(true)
    })

    it('returns false for non-objects or null/arrays', () => {
        expect(isTranscriptionSegment(null)).toBe(false)
        expect(isTranscriptionSegment(undefined)).toBe(false)
        expect(isTranscriptionSegment(123)).toBe(false)
        expect(isTranscriptionSegment('string')).toBe(false)
        expect(isTranscriptionSegment([])).toBe(false)
        expect(isTranscriptionSegment(true)).toBe(false)
    })

    it('returns false when startSec is missing or invalid', () => {
        expect(isTranscriptionSegment({ endSec: 2.0, text: 'hi' })).toBe(false)
        expect(isTranscriptionSegment({ startSec: '0', endSec: 2.0, text: 'hi' })).toBe(false)
        expect(isTranscriptionSegment({ startSec: Number.NaN, endSec: 2.0, text: 'hi' })).toBe(false)
        expect(isTranscriptionSegment({ startSec: Number.POSITIVE_INFINITY, endSec: 2.0, text: 'hi' })).toBe(false)
        expect(isTranscriptionSegment({ startSec: -0.1, endSec: 2.0, text: 'hi' })).toBe(false)
    })

    it('returns false when endSec is missing or invalid', () => {
        expect(isTranscriptionSegment({ startSec: 1.0, text: 'hi' })).toBe(false)
        expect(isTranscriptionSegment({ startSec: 1.0, endSec: '2.0', text: 'hi' })).toBe(false)
        expect(isTranscriptionSegment({ startSec: 1.0, endSec: Number.NaN, text: 'hi' })).toBe(false)
        expect(isTranscriptionSegment({ startSec: 1.0, endSec: Number.POSITIVE_INFINITY, text: 'hi' })).toBe(false)
        expect(isTranscriptionSegment({ startSec: 2.0, endSec: 1.9, text: 'hi' })).toBe(false)
    })

    it('returns false when text is missing or invalid', () => {
        expect(isTranscriptionSegment({ startSec: 1.0, endSec: 2.0 })).toBe(false)
        expect(isTranscriptionSegment({ startSec: 1.0, endSec: 2.0, text: 123 })).toBe(false)
        expect(isTranscriptionSegment({ startSec: 1.0, endSec: 2.0, text: null })).toBe(false)
    })
})

describe('isTranscriptionResult', () => {
    const validResult: TranscriptionResult = {
        segments: [
            { startSec: 0.0, endSec: 1.5, text: 'Hello' },
            { startSec: 1.5, endSec: 3.0, text: 'World' },
        ],
        transcribedAt: 1700000000000,
        modelId: 'onnx-community/whisper-tiny',
        language: 'japanese',
    }

    it('returns true for a valid transcription result', () => {
        expect(isTranscriptionResult(validResult)).toBe(true)
    })

    it('returns true when segments array is empty', () => {
        expect(
            isTranscriptionResult({
                ...validResult,
                segments: [],
            }),
        ).toBe(true)
    })

    it('returns false for non-objects or null/arrays', () => {
        expect(isTranscriptionResult(null)).toBe(false)
        expect(isTranscriptionResult(undefined)).toBe(false)
        expect(isTranscriptionResult(123)).toBe(false)
        expect(isTranscriptionResult('payload')).toBe(false)
        expect(isTranscriptionResult([])).toBe(false)
        expect(isTranscriptionResult(false)).toBe(false)
    })

    it('returns false when transcribedAt is invalid or missing', () => {
        expect(isTranscriptionResult({ ...validResult, transcribedAt: undefined })).toBe(false)
        expect(isTranscriptionResult({ ...validResult, transcribedAt: '1700000000000' })).toBe(false)
        expect(isTranscriptionResult({ ...validResult, transcribedAt: Number.NaN })).toBe(false)
        expect(isTranscriptionResult({ ...validResult, transcribedAt: Number.NEGATIVE_INFINITY })).toBe(false)
        expect(isTranscriptionResult({ ...validResult, transcribedAt: -1 })).toBe(false)
    })

    it('returns false when modelId is invalid or empty', () => {
        expect(isTranscriptionResult({ ...validResult, modelId: undefined })).toBe(false)
        expect(isTranscriptionResult({ ...validResult, modelId: 123 })).toBe(false)
        expect(isTranscriptionResult({ ...validResult, modelId: '' })).toBe(false)
        expect(isTranscriptionResult({ ...validResult, modelId: '   ' })).toBe(false)
    })

    it('returns false when language is invalid or empty', () => {
        expect(isTranscriptionResult({ ...validResult, language: undefined })).toBe(false)
        expect(isTranscriptionResult({ ...validResult, language: 123 })).toBe(false)
        expect(isTranscriptionResult({ ...validResult, language: '' })).toBe(false)
        expect(isTranscriptionResult({ ...validResult, language: '   ' })).toBe(false)
    })

    it('returns false when segments is not an array', () => {
        expect(isTranscriptionResult({ ...validResult, segments: null })).toBe(false)
        expect(isTranscriptionResult({ ...validResult, segments: undefined })).toBe(false)
        expect(isTranscriptionResult({ ...validResult, segments: {} })).toBe(false)
        expect(isTranscriptionResult({ ...validResult, segments: 'not-array' })).toBe(false)
    })

    it('returns false when segments contains an invalid segment', () => {
        expect(
            isTranscriptionResult({
                ...validResult,
                segments: [{ startSec: 2.0, endSec: 1.0, text: 'reversed times' }],
            }),
        ).toBe(false)
        expect(
            isTranscriptionResult({
                ...validResult,
                segments: [{ startSec: 0, endSec: 1.0, text: null }],
            }),
        ).toBe(false)
        expect(
            isTranscriptionResult({
                ...validResult,
                segments: ['string-instead-of-segment'],
            }),
        ).toBe(false)
    })
})
