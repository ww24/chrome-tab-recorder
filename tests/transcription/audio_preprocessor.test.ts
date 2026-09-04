import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { streamPcmFromOpfsFile, cleanupOpfsTempAudio } from '../../src/transcription/audio_preprocessor'

describe('audio_preprocessor', () => {
    let mockRoot: any
    let mockGetDirectory: any

    beforeEach(() => {
        mockRoot = {
            getFileHandle: vi.fn(),
            removeEntry: vi.fn(),
        }
        mockGetDirectory = vi.fn().mockResolvedValue(mockRoot)
        vi.stubGlobal('navigator', {
            storage: {
                getDirectory: mockGetDirectory,
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    describe('streamPcmFromOpfsFile', () => {
        it('skips 44-byte WAV header and yields 16kHz Float32 chunks normalized to [-1.0, 1.0]', async () => {
            // Create a fake 16-bit PCM WAV: 44 bytes header + 4 samples (8 bytes)
            const numSamples = 4
            const wavBytes = new Uint8Array(44 + numSamples * 2)
            const int16View = new Int16Array(wavBytes.buffer, 44, numSamples)
            int16View[0] = 0 // 0.0
            int16View[1] = 16384 // 0.5
            int16View[2] = -16384 // -0.5
            int16View[3] = 32767 // ~1.0

            const fakeFile = {
                size: wavBytes.byteLength,
                slice: (start: number, end: number) => ({
                    arrayBuffer: async () =>
                        wavBytes
                            .subarray(start, end)
                            .buffer.slice(wavBytes.byteOffset + start, wavBytes.byteOffset + end),
                }),
            }

            const mockHandle = {
                getFile: vi.fn().mockResolvedValue(fakeFile),
            }
            mockRoot.getFileHandle.mockResolvedValue(mockHandle)

            const chunks: Float32Array[] = []
            for await (const chunk of streamPcmFromOpfsFile('test-audio.wav', 2)) {
                chunks.push(chunk)
            }

            expect(mockRoot.getFileHandle).toHaveBeenCalledWith('test-audio.wav')
            // With chunkSizeSamples = 2, 4 samples will yield 2 chunks
            expect(chunks.length).toBe(2)
            expect(chunks[0].length).toBe(2)
            expect(chunks[0][0]).toBeCloseTo(0.0, 2)
            expect(chunks[0][1]).toBeCloseTo(0.5, 2)
            expect(chunks[1].length).toBe(2)
            expect(chunks[1][0]).toBeCloseTo(-0.5, 2)
            expect(chunks[1][1]).toBeCloseTo(1.0, 2)
        })
    })

    describe('cleanupOpfsTempAudio', () => {
        it('removes file from OPFS storage', async () => {
            mockRoot.removeEntry.mockResolvedValue(undefined)

            await cleanupOpfsTempAudio('temp-to-clean.wav')
            expect(mockRoot.removeEntry).toHaveBeenCalledWith('temp-to-clean.wav')
        })

        it('ignores errors silently when file does not exist', async () => {
            mockRoot.removeEntry.mockRejectedValue(new Error('File not found'))

            await expect(cleanupOpfsTempAudio('nonexistent.wav')).resolves.toBeUndefined()
        })
    })
})
