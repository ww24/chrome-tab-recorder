import { describe, it, expect } from 'vitest'
import { measureLoudness, normalizeLoudness } from '../src/transcription/loudness'

describe('loudness', () => {
    it('returns -Infinity for silence', () => {
        const silence = new Float32Array(16000)
        expect(measureLoudness(silence)).toBe(-Infinity)
    })

    it('measures loudness of a generated sine wave', () => {
        // 1 second of 1kHz sine wave at amplitude 0.5
        const sampleRate = 16000
        const signal = new Float32Array(sampleRate)
        for (let i = 0; i < sampleRate; i++) {
            signal[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate)
        }

        const lufs = measureLoudness(signal, sampleRate)
        expect(isFinite(lufs)).toBe(true)
        expect(lufs).toBeGreaterThan(-30)
        expect(lufs).toBeLessThan(-5)
    })

    it('normalizes audio toward target LUFS without clipping', () => {
        const sampleRate = 16000
        // Low volume signal: amplitude 0.05
        const signal = new Float32Array(sampleRate)
        for (let i = 0; i < sampleRate; i++) {
            signal[i] = 0.05 * Math.sin((2 * Math.PI * 1000 * i) / sampleRate)
        }

        const initialLufs = measureLoudness(signal, sampleRate)
        const normalized = normalizeLoudness(signal, {
            targetLufs: -20,
            sampleRate,
            maxGainDb: 24,
        })

        const normalizedLufs = measureLoudness(normalized, sampleRate)
        expect(normalizedLufs).toBeGreaterThan(initialLufs)

        // Ensure no clipping beyond maxPeak (0.95)
        for (let i = 0; i < normalized.length; i++) {
            expect(Math.abs(normalized[i])).toBeLessThanOrEqual(0.96)
        }
    })
})
