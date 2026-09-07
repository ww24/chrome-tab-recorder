import { describe, it, expect } from 'vitest'
import { cleanTranscriptionText, formatSeconds, wavToFloat32Array } from '../src/transcription/utils'

describe('cleanTranscriptionText', () => {
    it('removes unicode replacement character \uFFFD', () => {
        const input = 'Hello\uFFFD world\uFFFD!'
        expect(cleanTranscriptionText(input)).toBe('Hello world!')
    })

    it('removes non-printable control characters while preserving valid text', () => {
        const input = 'Test\x00\x07string\x1Fhere'
        expect(cleanTranscriptionText(input)).toBe('Teststringhere')
    })

    it('normalizes multiple spaces and tabs to single spaces', () => {
        const input = '  Multiple   spaces \t and \t\t tabs  '
        expect(cleanTranscriptionText(input)).toBe('Multiple spaces and tabs')
    })

    it('handles empty or null-ish inputs gracefully', () => {
        expect(cleanTranscriptionText('')).toBe('')
    })
})

describe('formatSeconds', () => {
    it('formats seconds to mm:ss without milliseconds', () => {
        expect(formatSeconds(0)).toBe('00:00')
        expect(formatSeconds(65)).toBe('01:05')
        expect(formatSeconds(3661)).toBe('61:01')
    })

    it('formats seconds to mm:ss.ms when includeMs is true', () => {
        expect(formatSeconds(65.42, true)).toBe('01:05.42')
        expect(formatSeconds(0, true)).toBe('00:00.00')
    })

    it('handles negative or NaN values', () => {
        expect(formatSeconds(-10)).toBe('00:00')
        expect(formatSeconds(NaN)).toBe('00:00')
        expect(formatSeconds(-10, true)).toBe('00:00.00')
    })
})

describe('wavToFloat32Array', () => {
    it('throws on invalid buffer size', () => {
        const buf = new ArrayBuffer(8)
        expect(() => wavToFloat32Array(buf)).toThrow('Invalid WAV file: buffer too small')
    })

    it('throws on missing RIFF header', () => {
        const buf = new ArrayBuffer(20)
        expect(() => wavToFloat32Array(buf)).toThrow('Invalid WAV file: missing RIFF header')
    })

    it('throws on missing WAVE header', () => {
        const buf = new ArrayBuffer(20)
        const view = new DataView(buf)
        // "RIFF"
        view.setUint32(0, 0x52494646, false)
        // not "WAVE"
        view.setUint32(8, 0x4e4f5045, false)
        expect(() => wavToFloat32Array(buf)).toThrow('Invalid WAV file: missing WAVE header')
    })

    it('throws on missing fmt chunk', () => {
        const buf = new ArrayBuffer(28)
        const view = new DataView(buf)
        view.setUint32(0, 0x52494646, false) // RIFF
        view.setUint32(4, 20, true)
        view.setUint32(8, 0x57415645, false) // WAVE
        view.setUint32(12, 0x64617461, false) // data
        view.setUint32(16, 0, true)
        expect(() => wavToFloat32Array(buf)).toThrow('Invalid WAV file: missing fmt chunk')
    })

    it('throws on non-float32 WAV (e.g. 16-bit PCM)', () => {
        // Construct a minimal 16-bit PCM mono WAV (44 bytes header + 4 bytes data = 2 samples)
        const buffer = new ArrayBuffer(48)
        const view = new DataView(buffer)

        // "RIFF"
        view.setUint32(0, 0x52494646, false)
        view.setUint32(4, 40, true)
        // "WAVE"
        view.setUint32(8, 0x57415645, false)

        // "fmt "
        view.setUint32(12, 0x666d7420, false)
        view.setUint32(16, 16, true)
        view.setUint16(20, 1, true) // audioFormat: 1 (PCM)
        view.setUint16(22, 1, true) // channels: 1
        view.setUint32(24, 16000, true) // sampleRate: 16000
        view.setUint32(28, 32000, true) // byteRate
        view.setUint16(32, 2, true) // blockAlign: 2
        view.setUint16(34, 16, true) // bitsPerSample: 16

        // "data"
        view.setUint32(36, 0x64617461, false)
        view.setUint32(40, 4, true)

        expect(() => wavToFloat32Array(buffer)).toThrow(
            'Unsupported WAV format: expected 32-bit IEEE float (format=3), but got format=1',
        )
    })

    it('throws on non-32-bit float WAV (e.g. 64-bit float)', () => {
        const buffer = new ArrayBuffer(56)
        const view = new DataView(buffer)

        view.setUint32(0, 0x52494646, false)
        view.setUint32(4, 48, true)
        view.setUint32(8, 0x57415645, false)

        // "fmt "
        view.setUint32(12, 0x666d7420, false)
        view.setUint32(16, 16, true)
        view.setUint16(20, 3, true) // audioFormat: 3 (IEEE float)
        view.setUint16(22, 1, true)
        view.setUint32(24, 16000, true)
        view.setUint32(28, 128000, true)
        view.setUint16(32, 8, true)
        view.setUint16(34, 64, true) // bitsPerSample: 64

        // "data"
        view.setUint32(36, 0x64617461, false)
        view.setUint32(40, 8, true)

        expect(() => wavToFloat32Array(buffer)).toThrow('Unsupported WAV bit depth: expected 32-bit, but got 64-bit')
    })

    it('throws on unaligned data length', () => {
        const buffer = new ArrayBuffer(47)
        const view = new DataView(buffer)

        view.setUint32(0, 0x52494646, false)
        view.setUint32(4, 39, true)
        view.setUint32(8, 0x57415645, false)

        // "fmt "
        view.setUint32(12, 0x666d7420, false)
        view.setUint32(16, 16, true)
        view.setUint16(20, 3, true)
        view.setUint16(22, 1, true)
        view.setUint32(24, 16000, true)
        view.setUint32(28, 64000, true)
        view.setUint16(32, 4, true)
        view.setUint16(34, 32, true)

        // "data"
        view.setUint32(36, 0x64617461, false)
        view.setUint32(40, 3, true) // 3 bytes is not a multiple of 4

        expect(() => wavToFloat32Array(buffer)).toThrow('Invalid WAV file: data length is not a multiple of 4 bytes')
    })

    it('parses 32-bit IEEE float WAV', () => {
        // Construct a minimal 32-bit float mono WAV (44 bytes header + 8 bytes data = 2 samples)
        const buffer = new ArrayBuffer(52)
        const view = new DataView(buffer)

        // "RIFF"
        view.setUint32(0, 0x52494646, false)
        view.setUint32(4, 44, true) // file length - 8
        // "WAVE"
        view.setUint32(8, 0x57415645, false)

        // "fmt "
        view.setUint32(12, 0x666d7420, false)
        view.setUint32(16, 16, true) // fmt chunk size
        view.setUint16(20, 3, true) // audioFormat: 3 (IEEE float)
        view.setUint16(22, 1, true) // channels: 1
        view.setUint32(24, 16000, true) // sampleRate: 16000
        view.setUint32(28, 64000, true) // byteRate
        view.setUint16(32, 4, true) // blockAlign: 4
        view.setUint16(34, 32, true) // bitsPerSample: 32

        // "data"
        view.setUint32(36, 0x64617461, false)
        view.setUint32(40, 8, true) // data length: 8 bytes (2 samples)

        // Samples: 0.5 and -0.75
        view.setFloat32(44, 0.5, true)
        view.setFloat32(48, -0.75, true)

        const float32 = wavToFloat32Array(buffer)
        expect(float32.length).toBe(2)
        expect(float32[0]).toBeCloseTo(0.5, 6)
        expect(float32[1]).toBeCloseTo(-0.75, 6)
    })
})
