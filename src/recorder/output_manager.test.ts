jest.mock('mediabunny', () => {
    const mockOutput = {
        addVideoTrack: jest.fn(),
        addAudioTrack: jest.fn(),
    }
    return {
        Output: jest.fn(() => mockOutput),
        StreamTarget: jest.fn(),
        MediaStreamVideoTrackSource: jest.fn(() => ({
            errorPromise: Promise.resolve(),
        })),
        MediaStreamAudioTrackSource: jest.fn(() => ({
            errorPromise: Promise.resolve(),
        })),
        canEncodeAudio: jest.fn().mockResolvedValue(true),
        WebMOutputFormat: jest.fn(),
        Mp4OutputFormat: jest.fn(),
        OggOutputFormat: jest.fn(),
        AdtsOutputFormat: jest.fn(),
        FlacOutputFormat: jest.fn(),
        QUALITY_HIGH: 'high',
        QUALITY_MEDIUM: 'medium',
        QUALITY_LOW: 'low',
    }
})
jest.mock('@mediabunny/flac-encoder', () => ({
    registerFlacEncoder: jest.fn(),
}))

import { Output, MediaStreamVideoTrackSource, MediaStreamAudioTrackSource } from 'mediabunny'
import { OutputManager } from './output_manager'
import { VideoFormat } from '../configuration'

// ---------- helpers ----------

function createMockTrack(kind: 'audio' | 'video'): MediaStreamTrack {
    return { kind, id: kind, stop: jest.fn() } as unknown as MediaStreamTrack
}

function createMockStream(audioTracks: MediaStreamTrack[] = [], videoTracks: MediaStreamTrack[] = []): MediaStream {
    return {
        getAudioTracks: jest.fn(() => audioTracks),
        getVideoTracks: jest.fn(() => videoTracks),
        getTracks: jest.fn(() => [...audioTracks, ...videoTracks]),
    } as unknown as MediaStream
}

function createVideoFormat(overrides: Partial<VideoFormat> = {}): VideoFormat {
    return new VideoFormat(
        overrides.recordingMode ?? 'video-and-audio',
        overrides.container ?? 'webm',
        overrides.audioCodec ?? 'opus',
        overrides.audioBitratePreset ?? 'high',
        overrides.audioBitrate ?? 256000,
        overrides.audioSampleRate ?? 44100,
        overrides.videoCodec ?? 'vp9',
        overrides.videoBitratePreset ?? 'high',
        overrides.videoBitrate ?? 8000000,
        overrides.frameRate ?? 30,
    )
}

// ---------- OutputManager ----------

describe('OutputManager', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    describe('createOutput', () => {
        test('creates an Output for webm container', () => {
            const manager = new OutputManager()
            const writable = {} as WritableStream

            const output = manager.createOutput(writable, 'webm')
            expect(output).toBeDefined()
            expect(Output).toHaveBeenCalled()
        })

        test('creates an Output for mp4 container', () => {
            const manager = new OutputManager()
            const writable = {} as WritableStream

            const output = manager.createOutput(writable, 'mp4')
            expect(output).toBeDefined()
        })
    })

    describe('addTracks', () => {
        test('adds both video and audio tracks for video-and-audio mode', () => {
            const manager = new OutputManager()
            const output = manager.createOutput({} as WritableStream, 'webm')
            const videoTrack = createMockTrack('video')
            const audioTrack = createMockTrack('audio')
            const media = createMockStream([audioTrack], [videoTrack])
            const videoFormat = createVideoFormat({ recordingMode: 'video-and-audio' })

            const errorPromises = manager.addTracks(output, media, videoFormat, true)

            expect(MediaStreamVideoTrackSource).toHaveBeenCalledWith(videoTrack, expect.objectContaining({
                codec: 'vp9',
                sizeChangeBehavior: 'passThrough',
            }))
            expect(MediaStreamAudioTrackSource).toHaveBeenCalledWith(audioTrack, expect.objectContaining({
                codec: 'opus',
            }))
            expect(output.addVideoTrack).toHaveBeenCalled()
            expect(output.addAudioTrack).toHaveBeenCalled()
            expect(errorPromises).toHaveLength(2)
        })

        test('adds only video track for video-only mode without audio', () => {
            const manager = new OutputManager()
            const output = manager.createOutput({} as WritableStream, 'webm')
            const videoTrack = createMockTrack('video')
            const media = createMockStream([], [videoTrack])
            const videoFormat = createVideoFormat({ recordingMode: 'video-only' })

            const errorPromises = manager.addTracks(output, media, videoFormat, false)

            expect(MediaStreamVideoTrackSource).toHaveBeenCalledWith(videoTrack, expect.any(Object))
            expect(output.addVideoTrack).toHaveBeenCalled()
            expect(output.addAudioTrack).not.toHaveBeenCalled()
            expect(errorPromises).toHaveLength(1)
        })

        test('adds only audio track for audio-only mode', () => {
            const manager = new OutputManager()
            const output = manager.createOutput({} as WritableStream, 'ogg')
            const audioTrack = createMockTrack('audio')
            const media = createMockStream([audioTrack])
            const videoFormat = createVideoFormat({ recordingMode: 'audio-only', container: 'ogg' })

            const errorPromises = manager.addTracks(output, media, videoFormat, true)

            expect(MediaStreamVideoTrackSource).not.toHaveBeenCalled()
            expect(output.addVideoTrack).not.toHaveBeenCalled()
            expect(MediaStreamAudioTrackSource).toHaveBeenCalledWith(audioTrack, expect.any(Object))
            expect(output.addAudioTrack).toHaveBeenCalled()
            expect(errorPromises).toHaveLength(1)
        })

        test('adds video + audio for video-only mode with mic (hasAudioTrack=true)', () => {
            const manager = new OutputManager()
            const output = manager.createOutput({} as WritableStream, 'webm')
            const videoTrack = createMockTrack('video')
            const audioTrack = createMockTrack('audio')
            const media = createMockStream([audioTrack], [videoTrack])
            const videoFormat = createVideoFormat({ recordingMode: 'video-only' })

            const errorPromises = manager.addTracks(output, media, videoFormat, true)

            expect(output.addVideoTrack).toHaveBeenCalled()
            expect(output.addAudioTrack).toHaveBeenCalled()
            expect(errorPromises).toHaveLength(2)
        })

        test('handles missing tracks gracefully', () => {
            const manager = new OutputManager()
            const output = manager.createOutput({} as WritableStream, 'webm')
            const media = createMockStream() // no tracks
            const videoFormat = createVideoFormat({ recordingMode: 'video-and-audio' })

            const errorPromises = manager.addTracks(output, media, videoFormat, true)

            expect(output.addVideoTrack).not.toHaveBeenCalled()
            expect(output.addAudioTrack).not.toHaveBeenCalled()
            expect(errorPromises).toHaveLength(0)
        })
    })

    describe('createAudioTrackOutput', () => {
        test('creates output with audio track', () => {
            const manager = new OutputManager()
            const writable = {} as WritableStream
            const audioTrack = createMockTrack('audio') as unknown as MediaStreamAudioTrack

            const handle = manager.createAudioTrackOutput(
                writable, audioTrack, 'ogg', 'opus', 'high', 256000,
            )

            expect(handle.output).toBeDefined()
            expect(handle.errorPromises).toHaveLength(1)
            expect(MediaStreamAudioTrackSource).toHaveBeenCalledWith(audioTrack, expect.objectContaining({
                codec: 'opus',
            }))
        })
    })
})
