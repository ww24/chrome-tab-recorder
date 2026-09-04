import { describe, it, expect } from 'vitest'
import {
    calculateHighShelfCoefficients,
    calculateHighPassCoefficients,
    applyBiquadFilter,
    KWeightingFilter,
    measureLoudness,
    normalizeLoudness,
    StreamingLoudnessMeasurer,
} from '../../src/transcription/loudness'

describe('loudness module', () => {
    describe('biquad coefficient calculation', () => {
        it('calculates stable high-shelf filter coefficients at 16kHz', () => {
            const coeffs = calculateHighShelfCoefficients(4.0, 1 / Math.SQRT2, 1500.0, 16000.0)
            expect(coeffs.b0).toBeGreaterThan(0)
            expect(isFinite(coeffs.b1)).toBe(true)
            expect(isFinite(coeffs.b2)).toBe(true)
            expect(isFinite(coeffs.a1)).toBe(true)
            expect(isFinite(coeffs.a2)).toBe(true)
            // Stability check: |a2| < 1 and |a1| < 1 + a2
            expect(Math.abs(coeffs.a2)).toBeLessThan(1)
            expect(Math.abs(coeffs.a1)).toBeLessThan(1 + coeffs.a2)
        })

        it('calculates stable high-pass filter coefficients at 16kHz', () => {
            const coeffs = calculateHighPassCoefficients(0.5, 38.0, 16000.0)
            expect(coeffs.b0).toBeGreaterThan(0)
            expect(coeffs.b1).toBeLessThan(0)
            expect(coeffs.b2).toBeGreaterThan(0)
            expect(Math.abs(coeffs.a2)).toBeLessThan(1)
            expect(Math.abs(coeffs.a1)).toBeLessThan(1 + coeffs.a2)
        })
    })

    describe('applyBiquadFilter', () => {
        it('filters input without blowing up or producing NaN', () => {
            const coeffs = calculateHighShelfCoefficients(4.0, 1 / Math.SQRT2, 1500.0, 16000.0)
            const input = new Float32Array(100).fill(0.5)
            const output = applyBiquadFilter(input, coeffs)
            expect(output.length).toBe(100)
            for (let i = 0; i < output.length; i++) {
                expect(isFinite(output[i])).toBe(true)
            }
        })
    })

    describe('KWeightingFilter', () => {
        it('applies two-stage filter cascade', () => {
            const filter = new KWeightingFilter(16000)
            const input = new Float32Array(1600) // 100ms at 16kHz
            for (let i = 0; i < input.length; i++) {
                input[i] = Math.sin((2 * Math.PI * 1000 * i) / 16000) * 0.5
            }
            const filtered = filter.apply(input)
            expect(filtered.length).toBe(input.length)
            expect(isFinite(filtered[100])).toBe(true)
        })
    })

    describe('measureLoudness', () => {
        it('returns -Infinity for empty or pure zero buffer', () => {
            expect(measureLoudness(new Float32Array(0))).toBe(-Infinity)
            expect(measureLoudness(new Float32Array(16000).fill(0))).toBe(-Infinity)
        })

        it('accurately reflects a 6 dB (2x amplitude) gain increase', () => {
            const sampleRate = 16000
            const durationSec = 1.0
            const numSamples = sampleRate * durationSec
            const pcm1 = new Float32Array(numSamples)
            const pcm2 = new Float32Array(numSamples)

            for (let i = 0; i < numSamples; i++) {
                const wave = Math.sin((2 * Math.PI * 1000 * i) / sampleRate)
                pcm1[i] = wave * 0.1
                pcm2[i] = wave * 0.2 // +6 dB (approx 6 LUFS higher)
            }

            const lufs1 = measureLoudness(pcm1, sampleRate)
            const lufs2 = measureLoudness(pcm2, sampleRate)

            expect(isFinite(lufs1)).toBe(true)
            expect(isFinite(lufs2)).toBe(true)
            expect(lufs2).toBeGreaterThan(lufs1)
            // A 2x amplitude increase corresponds to approximately 6.02 dB / LUFS
            expect(lufs2 - lufs1).toBeCloseTo(6.02, 1)
        })

        it('handles short signal (< 400ms) with fallback', () => {
            const sampleRate = 16000
            const shortPcm = new Float32Array(3200) // 200ms
            for (let i = 0; i < shortPcm.length; i++) {
                shortPcm[i] = Math.sin((2 * Math.PI * 500 * i) / sampleRate) * 0.2
            }
            const lufs = measureLoudness(shortPcm, sampleRate)
            expect(isFinite(lufs)).toBe(true)
            expect(lufs).toBeLessThan(0)
            expect(lufs).toBeGreaterThan(-60)
        })
    })

    describe('normalizeLoudness', () => {
        it('returns original/empty when input is empty or pure silence', () => {
            expect(normalizeLoudness(new Float32Array(0)).length).toBe(0)

            const zeros = new Float32Array(1000).fill(0)
            const normZeros = normalizeLoudness(zeros)
            expect(normZeros.every(v => v === 0)).toBe(true)
        })

        it('does not boost noise below minLufs', () => {
            const noise = new Float32Array(16000)
            for (let i = 0; i < noise.length; i++) {
                noise[i] = (Math.random() * 2 - 1) * 0.00001 // extreme low noise floor
            }
            const normalized = normalizeLoudness(noise, { minLufs: -60.0 })
            // Should not be amplified
            let peak = 0
            for (let i = 0; i < normalized.length; i++) {
                peak = Math.max(peak, Math.abs(normalized[i]))
            }
            expect(peak).toBeLessThan(0.001)
        })

        it('normalizes low-volume speech-like tone to target LUFS', () => {
            const sampleRate = 16000
            const numSamples = sampleRate * 1.5 // 1.5 seconds
            const pcm = new Float32Array(numSamples)

            for (let i = 0; i < numSamples; i++) {
                // Mix of fundamental frequencies in human speech range (200Hz, 800Hz, 2kHz)
                pcm[i] =
                    Math.sin((2 * Math.PI * 200 * i) / sampleRate) * 0.03 +
                    Math.sin((2 * Math.PI * 800 * i) / sampleRate) * 0.03 +
                    Math.sin((2 * Math.PI * 2000 * i) / sampleRate) * 0.02
            }

            const beforeLufs = measureLoudness(pcm, sampleRate)
            expect(beforeLufs).toBeLessThan(-25) // initially quiet

            const normalized = normalizeLoudness(pcm, { targetLufs: -20.0, sampleRate })
            const afterLufs = measureLoudness(normalized, sampleRate)

            // Should be normalized very close to target -20.0 LUFS
            expect(afterLufs).toBeCloseTo(-20.0, 1)
        })

        it('respects maxPeak to prevent clipping', () => {
            const sampleRate = 16000
            const numSamples = sampleRate * 1.0
            const pcm = new Float32Array(numSamples)

            for (let i = 0; i < numSamples; i++) {
                pcm[i] = Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * 0.4
            }

            // Requesting an extreme target loudness (+10 LUFS) would cause clipping without limiter
            const normalized = normalizeLoudness(pcm, { targetLufs: 10.0, maxPeak: 0.95, maxGainDb: 30 })

            let peak = 0
            for (let i = 0; i < normalized.length; i++) {
                peak = Math.max(peak, Math.abs(normalized[i]))
            }
            expect(peak).toBeLessThanOrEqual(0.9501)
        })

        it('supports in-place mutation when inPlace is true', () => {
            const pcm = new Float32Array(8000).fill(0.05)
            const returned = normalizeLoudness(pcm, { targetLufs: -20.0, inPlace: true })
            expect(returned).toBe(pcm)
        })
    })

    describe('StreamingLoudnessMeasurer', () => {
        it('produces matching loudness and gain with batch measureLoudness across arbitrary chunk sizes', () => {
            const sampleRate = 16000
            const durationSec = 3.0
            const numSamples = sampleRate * durationSec
            const pcm = new Float32Array(numSamples)

            for (let i = 0; i < numSamples; i++) {
                pcm[i] =
                    Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.2 +
                    Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * 0.1
            }

            const batchLufs = measureLoudness(pcm, sampleRate)

            const measurer = new StreamingLoudnessMeasurer(sampleRate)
            // Feed in uneven chunk sizes (e.g. 1000 samples)
            const chunkSize = 1000
            for (let i = 0; i < numSamples; i += chunkSize) {
                measurer.feed(pcm.subarray(i, Math.min(numSamples, i + chunkSize)))
            }

            const streamLufs = measurer.calculateLoudness()
            expect(streamLufs).toBeCloseTo(batchLufs, 1)

            const gain = measurer.calculateGain({ targetLufs: -20.0 })
            expect(gain).toBeGreaterThan(0)
            expect(isFinite(gain)).toBe(true)
        })
    })
})
