import type { Mock } from 'vitest'

vi.mock('mediabunny', () => ({
    canEncodeAudio: vi.fn().mockResolvedValue(true),
}))
vi.mock('@mediabunny/flac-encoder', () => ({
    registerFlacEncoder: vi.fn(),
}))

import { MediaCapture } from './media_capture'
import type { MediaDevicesProvider } from './media_capture'

// ---------- mocks ----------

function createMockDevices(): MediaDevicesProvider & { getUserMedia: Mock } {
    return {
        getUserMedia: vi.fn().mockResolvedValue({
            getTracks: () => [],
            getAudioTracks: () => [],
            getVideoTracks: () => [],
        } as unknown as MediaStream),
    }
}

// ---------- captureTab ----------

describe('MediaCapture', () => {
    describe('captureTab', () => {
        test('passes video-and-audio constraints', async () => {
            const devices = createMockDevices()
            const capture = new MediaCapture(devices)

            await capture.captureTab('stream-1', { width: 1920, height: 1080 }, 30, 'video-and-audio', 44100)

            expect(devices.getUserMedia).toHaveBeenCalledWith({
                audio: {
                    mandatory: {
                        chromeMediaSource: 'tab',
                        chromeMediaSourceId: 'stream-1',
                        maxSampleRate: 44100,
                    },
                },
                video: {
                    mandatory: {
                        chromeMediaSource: 'tab',
                        chromeMediaSourceId: 'stream-1',
                        maxWidth: 1920,
                        maxHeight: 1080,
                        maxFrameRate: 30,
                    },
                },
            })
        })

        test('passes video-only constraints (no audio)', async () => {
            const devices = createMockDevices()
            const capture = new MediaCapture(devices)

            await capture.captureTab('stream-2', { width: 1280, height: 720 }, 60, 'video-only', 48000)

            expect(devices.getUserMedia).toHaveBeenCalledWith({
                audio: undefined,
                video: {
                    mandatory: {
                        chromeMediaSource: 'tab',
                        chromeMediaSourceId: 'stream-2',
                        maxWidth: 1280,
                        maxHeight: 720,
                        maxFrameRate: 60,
                    },
                },
            })
        })

        test('passes audio-only constraints (no video)', async () => {
            const devices = createMockDevices()
            const capture = new MediaCapture(devices)

            await capture.captureTab('stream-3', { width: 1920, height: 1080 }, 30, 'audio-only', 44100)

            expect(devices.getUserMedia).toHaveBeenCalledWith({
                audio: {
                    mandatory: {
                        chromeMediaSource: 'tab',
                        chromeMediaSourceId: 'stream-3',
                        maxSampleRate: 44100,
                    },
                },
                video: undefined,
            })
        })
    })

    // ---------- captureMicrophone ----------

    describe('captureMicrophone', () => {
        test('returns null when microphone is disabled', async () => {
            const devices = createMockDevices()
            const capture = new MediaCapture(devices)

            const result = await capture.captureMicrophone(
                { enabled: false, gain: 1.0, deviceId: null },
                44100,
            )

            expect(result).toBeNull()
            expect(devices.getUserMedia).not.toHaveBeenCalled()
        })

        test('captures with default device when deviceId is null', async () => {
            const devices = createMockDevices()
            const capture = new MediaCapture(devices)

            await capture.captureMicrophone(
                { enabled: true, gain: 1.0, deviceId: null },
                48000,
            )

            expect(devices.getUserMedia).toHaveBeenCalledWith({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: false,
                    sampleRate: 48000,
                },
            })
        })

        test('captures with default device when deviceId is "default"', async () => {
            const devices = createMockDevices()
            const capture = new MediaCapture(devices)

            await capture.captureMicrophone(
                { enabled: true, gain: 0.5, deviceId: 'default' },
                44100,
            )

            expect(devices.getUserMedia).toHaveBeenCalledWith({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: false,
                    sampleRate: 44100,
                },
            })
        })

        test('captures with specific deviceId', async () => {
            const devices = createMockDevices()
            const capture = new MediaCapture(devices)

            await capture.captureMicrophone(
                { enabled: true, gain: 1.0, deviceId: 'device-abc' },
                44100,
            )

            expect(devices.getUserMedia).toHaveBeenCalledWith({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: false,
                    sampleRate: 44100,
                    deviceId: { exact: 'device-abc' },
                },
            })
        })

        test('returns null and logs warning when getUserMedia fails', async () => {
            const devices = createMockDevices()
            devices.getUserMedia.mockRejectedValue(new Error('Permission denied'))
            const capture = new MediaCapture(devices)

            const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { })
            const result = await capture.captureMicrophone(
                { enabled: true, gain: 1.0, deviceId: null },
                44100,
            )

            expect(result).toBeNull()
            expect(consoleSpy).toHaveBeenCalledWith('Microphone access denied:', expect.any(Error))
            consoleSpy.mockRestore()
        })
    })
})
