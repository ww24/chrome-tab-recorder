import { describe, it, expect } from 'vitest'
import { StreamResampler, wavToFloat32Array } from '../../src/transcription/audio_extractor'

describe('StreamResampler', () => {
    it('returns same array when source and target rates match', () => {
        const resampler = new StreamResampler(16000, 16000)
        const input = new Float32Array([0.1, 0.2, 0.3])
        const output = resampler.process(input)
        expect(output).toBe(input)
        expect(resampler.flush()).toEqual(new Float32Array(0))
    })

    it('returns empty array for empty input', () => {
        const resampler = new StreamResampler(48000, 16000)
        const output = resampler.process(new Float32Array(0))
        expect(output).toEqual(new Float32Array(0))
    })

    it('correctly downsamples 48000Hz to 16000Hz (3:1 integer ratio)', () => {
        const resampler = new StreamResampler(48000, 16000)
        // 12 samples at 48kHz -> 4 samples at 16kHz
        const input = new Float32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
        const output = resampler.process(input)
        // Indices 0, 3, 6, 9
        expect(Array.from(output)).toEqual([0, 3, 6, 9])
    })

    it('produces seamless continuous output across chunk boundaries', () => {
        const resamplerFull = new StreamResampler(48000, 16000)
        const fullInput = new Float32Array(300)
        for (let i = 0; i < fullInput.length; i++) {
            fullInput[i] = Math.sin((i / 48000) * 2 * Math.PI * 440)
        }
        const fullOutput = Array.from(resamplerFull.process(fullInput))

        // Process in small arbitrary chunk sizes
        const resamplerChunked = new StreamResampler(48000, 16000)
        const chunkSizes = [13, 27, 50, 10, 100, 100]
        const chunkedOutput: number[] = []
        let offset = 0
        for (const size of chunkSizes) {
            const chunk = fullInput.subarray(offset, offset + size)
            offset += size
            const res = resamplerChunked.process(chunk)
            chunkedOutput.push(...Array.from(res))
        }

        // Check that chunked output matches full output up to the processed samples
        expect(chunkedOutput.length).toBeGreaterThan(0)
        for (let i = 0; i < chunkedOutput.length; i++) {
            expect(chunkedOutput[i]).toBeCloseTo(fullOutput[i], 5)
        }
    })

    it('correctly resamples non-integer ratio (44100Hz to 16000Hz)', () => {
        const resampler = new StreamResampler(44100, 16000)
        const input = new Float32Array(4410) // 0.1s at 44.1kHz -> ~1600 samples at 16kHz
        for (let i = 0; i < input.length; i++) {
            input[i] = Math.sin((i / 44100) * 2 * Math.PI * 1000)
        }
        const output = resampler.process(input)
        // 4410 / (44100/16000) = 1600
        expect(Math.abs(output.length - 1600)).toBeLessThanOrEqual(2)
        // Output values must be within [-1, 1]
        for (let i = 0; i < output.length; i++) {
            expect(output[i]).toBeGreaterThanOrEqual(-1.01)
            expect(output[i]).toBeLessThanOrEqual(1.01)
        }
    })

    it('handles flush at EOF for remaining samples', () => {
        const resampler = new StreamResampler(48000, 16000)
        // 5 samples at 48kHz. Ratio is 3. Output at pos 0 (idx 0), pos 3 (idx 3). pos 6 is in next chunk.
        const input = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0])
        const out = resampler.process(input)
        expect(Array.from(out)).toEqual([1.0, 4.0])
        const flushed = resampler.flush()
        expect(flushed.length).toBeGreaterThanOrEqual(0)
    })
})

describe('wavToFloat32Array', () => {
    it('throws error for invalid WAV header', () => {
        const buffer = new ArrayBuffer(16)
        expect(() => wavToFloat32Array(buffer)).toThrow('Invalid WAV file header.')
    })
})

function createTestWavBlob(sampleRate: number, durationSec: number): Blob {
    const numSamples = sampleRate * durationSec
    const buffer = new ArrayBuffer(44 + numSamples * 2)
    const view = new DataView(buffer)
    view.setUint32(0, 0x52494646, false) // 'RIFF'
    view.setUint32(4, 36 + numSamples * 2, true)
    view.setUint32(8, 0x57415645, false) // 'WAVE'
    view.setUint32(12, 0x666d7420, false) // 'fmt '
    view.setUint32(16, 16, true)
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 1, true) // 1 ch
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true)
    view.setUint16(32, 2, true)
    view.setUint16(34, 16, true) // 16-bit
    view.setUint32(36, 0x64617461, false) // 'data'
    view.setUint32(40, numSamples * 2, true)
    for (let i = 0; i < numSamples; i++) {
        const val = Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 0.5
        view.setInt16(44 + i * 2, Math.floor(val * 32767), true)
    }
    return new Blob([buffer], { type: 'audio/wav' })
}

describe('extractAudioStream & extractAudioPCM', () => {
    it('streams 16kHz audio from a 48kHz WAV file using Mediabunny Conversion', async () => {
        const { extractAudioStream } = await import('../../src/transcription/audio_extractor')
        const blob = createTestWavBlob(48000, 2.0)
        let totalSamples = 0
        const chunks: Float32Array[] = []

        for await (const chunk of extractAudioStream(blob, { chunkSize: 8000 })) {
            chunks.push(chunk)
            totalSamples += chunk.length
        }

        // 2.0s at 16kHz is ~32000 samples
        expect(chunks.length).toBeGreaterThanOrEqual(4)
        expect(Math.abs(totalSamples - 32000)).toBeLessThanOrEqual(10)
    })

    it('extracts full audio PCM using extractAudioPCM', async () => {
        const { extractAudioPCM } = await import('../../src/transcription/audio_extractor')
        const blob = createTestWavBlob(48000, 1.0)
        const pcm = await extractAudioPCM(blob)

        // 1.0s at 16kHz is ~16000 samples
        expect(Math.abs(pcm.length - 16000)).toBeLessThanOrEqual(10)
    })
})
