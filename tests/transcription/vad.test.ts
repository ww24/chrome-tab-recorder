import { describe, it, expect, vi } from 'vitest'
import {
    mergeFloat32Arrays,
    FixedChunkSegmenter,
    SileroVADSegmenter,
    StreamingLoudnessNormalizer,
    type AudioSegment,
} from '../../src/transcription/vad'

describe('mergeFloat32Arrays', () => {
    it('merges multiple chunks accurately', () => {
        const c1 = new Float32Array([1, 2])
        const c2 = new Float32Array([3, 4, 5])
        const result = mergeFloat32Arrays([c1, c2])
        expect(Array.from(result)).toEqual([1, 2, 3, 4, 5])
    })

    it('truncates to maxSamples when specified', () => {
        const c1 = new Float32Array([1, 2])
        const c2 = new Float32Array([3, 4, 5])
        const result = mergeFloat32Arrays([c1, c2], 3)
        expect(Array.from(result)).toEqual([1, 2, 3])
    })

    it('handles empty chunks array', () => {
        const result = mergeFloat32Arrays([])
        expect(result.length).toBe(0)
    })
})

describe('StreamingLoudnessNormalizer', () => {
    it('boosts quiet audio towards target LUFS with limiter safety', () => {
        const normalizer = new StreamingLoudnessNormalizer({
            targetLufs: -20.0,
            maxGainDb: 18.0,
            minLufs: -60.0,
            maxPeak: 0.95,
        })

        // Generate a quiet 440Hz sine wave (peak ~0.05)
        const sampleRate = 16000
        const quietChunk = new Float32Array(sampleRate)
        for (let i = 0; i < quietChunk.length; i++) {
            quietChunk[i] = 0.05 * Math.sin((2 * Math.PI * 440 * i) / sampleRate)
        }

        const out = normalizer.process(quietChunk)
        expect(out.length).toBe(quietChunk.length)

        // Peak should be significantly boosted
        let outPeak = 0
        for (let i = 0; i < out.length; i++) {
            const abs = Math.abs(out[i])
            if (abs > outPeak) outPeak = abs
        }

        expect(outPeak).toBeGreaterThan(0.05)
        expect(outPeak).toBeLessThanOrEqual(0.95)
    })

    it('returns empty array for empty input', () => {
        const normalizer = new StreamingLoudnessNormalizer()
        const out = normalizer.process(new Float32Array(0))
        expect(out.length).toBe(0)
    })
})

describe('FixedChunkSegmenter', () => {
    it('emits segment after reaching max chunk samples (25 seconds)', async () => {
        const emitted: AudioSegment[] = []
        const segmenter = new FixedChunkSegmenter(seg => emitted.push(seg))

        const SAMPLE_RATE = 16000
        const chunk10s = new Float32Array(10 * SAMPLE_RATE)
        const chunk20s = new Float32Array(20 * SAMPLE_RATE)

        await segmenter.feed(chunk10s)
        expect(emitted.length).toBe(0)

        await segmenter.feed(chunk20s)
        // 10s + 20s = 30s -> 1 segment of 25s emitted, 5s remaining
        expect(emitted.length).toBe(1)
        expect(emitted[0].start).toBe(0)
        expect(emitted[0].end).toBe(25)
        expect(emitted[0].pcm.length).toBe(25 * SAMPLE_RATE)

        await segmenter.finish()
        // remaining 5s emitted
        expect(emitted.length).toBe(2)
        expect(emitted[1].start).toBe(25)
        expect(emitted[1].end).toBe(30)
        expect(emitted[1].pcm.length).toBe(5 * SAMPLE_RATE)

        const stats = segmenter.getStats()
        expect(stats.totalDuration).toBe(30)
        expect(stats.speechDuration).toBe(30)
        expect(stats.skippedSilenceDuration).toBe(0)
        expect(stats.speechSegmentCount).toBe(2)
    })
})

describe('SileroVADSegmenter', () => {
    it('detects speech intervals and respects silence threshold and gap merge', async () => {
        const emitted: AudioSegment[] = []
        const SAMPLE_RATE = 16000

        // Mock vadModel: returns prob based on currentProb
        let currentProb = 0.0
        const mockVadModel = vi.fn().mockImplementation(async ({ state }) => {
            return {
                stateN: state,
                output: { data: [currentProb] },
            }
        })

        const segmenter = new SileroVADSegmenter(mockVadModel, seg => emitted.push(seg), 0.5)

        // 1s silence
        currentProb = 0.0
        await segmenter.feed(new Float32Array(SAMPLE_RATE))
        expect(emitted.length).toBe(0)

        // 2s speech
        currentProb = 0.9
        await segmenter.feed(new Float32Array(2 * SAMPLE_RATE))
        expect(emitted.length).toBe(0)

        // 0.4s silence (< 800ms gap merge threshold, should NOT trigger cut)
        currentProb = 0.0
        await segmenter.feed(new Float32Array(0.4 * SAMPLE_RATE))
        expect(emitted.length).toBe(0)

        // 1s speech (continuing speech)
        currentProb = 0.9
        await segmenter.feed(new Float32Array(SAMPLE_RATE))
        expect(emitted.length).toBe(0)

        // 1.0s silence (>= 800ms silence threshold, triggers cut)
        currentProb = 0.0
        await segmenter.feed(new Float32Array(SAMPLE_RATE))
        expect(emitted.length).toBe(1)

        // Check emitted segment
        const seg = emitted[0]
        // Started around 1s (with 100ms pre-padding)
        expect(seg.start).toBeCloseTo(0.9, 1)
        // Duration should cover 2s + 0.4s + 1s speech plus padding
        expect(seg.end).toBeGreaterThan(seg.start + 3.4)

        await segmenter.finish()
        const stats = segmenter.getStats()
        expect(stats.speechSegmentCount).toBe(1)
        expect(stats.totalDuration).toBeCloseTo(5.4, 1)
        expect(stats.skippedSilenceDuration).toBeGreaterThan(0)
    })

    it('ignores short noise bursts (<250ms) and prevents them from shifting speech start', async () => {
        const emitted: AudioSegment[] = []
        const SAMPLE_RATE = 16000

        let currentProb = 0.0
        const mockVadModel = vi.fn().mockImplementation(async ({ state }) => {
            return {
                stateN: state,
                output: { data: [currentProb] },
            }
        })

        const segmenter = new SileroVADSegmenter(mockVadModel, seg => emitted.push(seg), 0.5)

        // 1.0s silence
        currentProb = 0.0
        await segmenter.feed(new Float32Array(1.0 * SAMPLE_RATE))

        // 0.1s noise burst (< 250ms min speech)
        currentProb = 0.9
        await segmenter.feed(new Float32Array(0.1 * SAMPLE_RATE))

        // 0.35s pause (>= 300ms min silence -> triggers interval evaluation, noise burst is dropped)
        currentProb = 0.0
        await segmenter.feed(new Float32Array(0.35 * SAMPLE_RATE))

        // 2.0s real speech (starts at 1.45s)
        currentProb = 0.9
        await segmenter.feed(new Float32Array(2.0 * SAMPLE_RATE))

        // 1.0s silence (>= 500ms merge gap -> emits segment)
        currentProb = 0.0
        await segmenter.feed(new Float32Array(1.0 * SAMPLE_RATE))

        expect(emitted.length).toBe(1)
        const seg = emitted[0]
        // Speech started at 1.45s, with 100ms padding it should start around 1.35s ~ 1.45s
        // Crucially, it must NOT start at 0.9s or 1.0s (where the noise burst was)
        expect(seg.start).toBeGreaterThanOrEqual(1.3)
        expect(seg.start).toBeLessThanOrEqual(1.5)
        expect(seg.end).toBeGreaterThan(seg.start + 1.9)
    })

    it('splits speech intervals when silence gap is >= 500ms', async () => {
        const emitted: AudioSegment[] = []
        const SAMPLE_RATE = 16000

        let currentProb = 0.0
        const mockVadModel = vi.fn().mockImplementation(async ({ state }) => {
            return {
                stateN: state,
                output: { data: [currentProb] },
            }
        })

        const segmenter = new SileroVADSegmenter(mockVadModel, seg => emitted.push(seg), 0.5)

        // 2s speech
        currentProb = 0.9
        await segmenter.feed(new Float32Array(2 * SAMPLE_RATE))

        // 0.6s silence (>= 500ms merge gap threshold -> must NOT merge)
        currentProb = 0.0
        await segmenter.feed(new Float32Array(0.6 * SAMPLE_RATE))

        // First segment should be emitted once 500ms of silence passes
        expect(emitted.length).toBe(1)

        // Another 2s speech
        currentProb = 0.9
        await segmenter.feed(new Float32Array(2 * SAMPLE_RATE))

        // 1.0s silence
        currentProb = 0.0
        await segmenter.feed(new Float32Array(1.0 * SAMPLE_RATE))

        expect(emitted.length).toBe(2)
        expect(emitted[0].start).toBeCloseTo(0, 1)
        expect(emitted[0].end).toBeCloseTo(2.1, 1)
        expect(emitted[1].start).toBeCloseTo(2.5, 1)
        expect(emitted[1].end).toBeCloseTo(4.7, 1)
    })
})
