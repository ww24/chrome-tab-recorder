
import { Crop } from '../src/crop'

const createMockFrame = (codedWidth: number, codedHeight: number): VideoFrame => ({
    codedWidth,
    codedHeight,
}) as unknown as VideoFrame

describe('getCroppedStream', () => {
    let pipePromiseReject: (e: unknown) => void
    let transformFn: ((frame: VideoFrame, controller: TransformStreamDefaultController<VideoFrame>) => void) | undefined

    const mockWritable = {} as WritableStream
    const mockReadable = {
        pipeThrough: vi.fn(),
    }
    const mockPipeTo = vi.fn()

    beforeEach(() => {
        transformFn = undefined
        mockReadable.pipeThrough.mockReturnValue({ pipeTo: mockPipeTo })
        mockPipeTo.mockReturnValue(new Promise<void>((resolve, reject) => {
            pipePromiseReject = reject
        }))

        vi.stubGlobal('MediaStreamTrackProcessor', class {
            readable = mockReadable
        })
        vi.stubGlobal('MediaStreamTrackGenerator', class {
            kind: string
            writable = mockWritable
            constructor({ kind }: { kind: string }) {
                this.kind = kind
            }
        })
        vi.stubGlobal('TransformStream', class {
            constructor(transformer: { transform: typeof transformFn }) {
                transformFn = transformer.transform
            }
        })
        vi.stubGlobal('MediaStream', class {
            tracks: unknown[]
            constructor(tracks: unknown[]) {
                this.tracks = tracks
            }
        })
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
    })

    it('should return original stream when no video track exists', () => {
        const originalStream = {
            getVideoTracks: () => [],
            getAudioTracks: () => [],
        } as unknown as MediaStream
        const crop = new Crop()
        const region = { x: 0, y: 0, width: 100, height: 100 }

        const result = crop.getCroppedStream(originalStream, region)

        expect(result).toBe(originalStream)
    })

    it('should set this.region to the provided cropRegion', () => {
        const videoTrack = { kind: 'video' }
        const audioTrack = { kind: 'audio' }
        const originalStream = {
            getVideoTracks: () => [videoTrack],
            getAudioTracks: () => [audioTrack],
        } as unknown as MediaStream
        const crop = new Crop()
        const region = { x: 10, y: 20, width: 300, height: 400 }

        crop.getCroppedStream(originalStream, region)

        expect(crop.region).toEqual(region)
    })

    it('should set up the pipeline: readable -> transformer -> writable', () => {
        const videoTrack = { kind: 'video' }
        const originalStream = {
            getVideoTracks: () => [videoTrack],
            getAudioTracks: () => [],
        } as unknown as MediaStream
        const crop = new Crop()

        mockReadable.pipeThrough.mockClear()
        mockPipeTo.mockClear()

        crop.getCroppedStream(originalStream, { x: 0, y: 0, width: 100, height: 100 })

        expect(mockReadable.pipeThrough).toHaveBeenCalledOnce()
        expect(mockPipeTo).toHaveBeenCalledWith(mockWritable)
    })

    it('should return a new MediaStream with generator and audio tracks', () => {
        const videoTrack = { kind: 'video' }
        const audioTrack1 = { kind: 'audio', id: '1' }
        const audioTrack2 = { kind: 'audio', id: '2' }
        const originalStream = {
            getVideoTracks: () => [videoTrack],
            getAudioTracks: () => [audioTrack1, audioTrack2],
        } as unknown as MediaStream
        const crop = new Crop()

        const result = crop.getCroppedStream(originalStream, { x: 0, y: 0, width: 100, height: 100 })

        const tracks = (result as unknown as { tracks: unknown[] }).tracks
        expect(tracks).toHaveLength(3)
        expect(tracks[1]).toBe(audioTrack1)
        expect(tracks[2]).toBe(audioTrack2)
    })

    it('should create cropped VideoFrame and close original in transform', () => {
        const videoTrack = { kind: 'video' }
        const originalStream = {
            getVideoTracks: () => [videoTrack],
            getAudioTracks: () => [],
        } as unknown as MediaStream
        const crop = new Crop()
        const region = { x: 10, y: 20, width: 300, height: 400 }

        const closeFn = vi.fn()
        const mockFrame = { codedWidth: 1920, codedHeight: 1080, close: closeFn } as unknown as VideoFrame
        const mockCroppedFrame = { isCropped: true }
        vi.stubGlobal('VideoFrame', class {
            constructor() {
                return mockCroppedFrame
            }
        })

        const enqueueFn = vi.fn()
        const controller = { enqueue: enqueueFn } as unknown as TransformStreamDefaultController<VideoFrame>

        crop.getCroppedStream(originalStream, region)

        expect(transformFn).toBeDefined()
        transformFn!(mockFrame, controller)

        expect(closeFn).toHaveBeenCalledOnce()
        expect(enqueueFn).toHaveBeenCalledWith(mockCroppedFrame)
    })

    it('should silently ignore TypeError with aborted message in pipeline', async () => {
        const videoTrack = { kind: 'video' }
        const originalStream = {
            getVideoTracks: () => [videoTrack],
            getAudioTracks: () => [],
        } as unknown as MediaStream
        const crop = new Crop()
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })

        crop.getCroppedStream(originalStream, { x: 0, y: 0, width: 100, height: 100 })
        pipePromiseReject(new TypeError('The stream was aborted'))

        // Flush the microtask queue so the .catch handler executes
        await new Promise(resolve => setTimeout(resolve, 0))

        expect(consoleErrorSpy).not.toHaveBeenCalled()
    })

    it('should log non-abort errors in pipeline', async () => {
        const videoTrack = { kind: 'video' }
        const originalStream = {
            getVideoTracks: () => [videoTrack],
            getAudioTracks: () => [],
        } as unknown as MediaStream
        const crop = new Crop()
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => { })
        const error = new Error('unexpected error')

        crop.getCroppedStream(originalStream, { x: 0, y: 0, width: 100, height: 100 })
        pipePromiseReject(error)

        await vi.waitFor(() => {
            expect(consoleErrorSpy).toHaveBeenCalledWith('Crop pipeline error:', error)
        })
    })
})

describe('Crop.alignRegion', () => {
    it('should return the region as-is when it fits within the frame', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 100, y: 100, width: 800, height: 600 }

        const result = Crop.alignRegion(frame, region)

        expect(result).toEqual({
            x: 100,
            y: 100,
            width: 800,
            height: 600,
        })
    })

    it('should clamp x to frame.codedWidth - 1 when x exceeds bounds', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 2000, y: 100, width: 800, height: 600 }

        const result = Crop.alignRegion(frame, region)

        expect(result).toEqual({
            x: 1919,
            y: 100,
            width: 1, // 1920 - 1919 = 1
            height: 600,
        })
    })

    it('should clamp y to frame.codedHeight - 1 when y exceeds bounds', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 100, y: 1200, width: 800, height: 600 }

        const result = Crop.alignRegion(frame, region)

        expect(result).toEqual({
            x: 100,
            y: 1079,
            width: 800,
            height: 1, // 1080 - 1079 = 1
        })
    })

    it('should handle region at origin (0, 0) with full frame size', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 0, y: 0, width: 1920, height: 1080 }

        const result = Crop.alignRegion(frame, region)

        expect(result).toEqual({
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        })
    })

    it('should handle small frame dimensions', () => {
        const frame = createMockFrame(100, 100)
        const region = { x: 50, y: 50, width: 30, height: 30 }

        const result = Crop.alignRegion(frame, region)

        expect(result).toEqual({
            x: 50,
            y: 50,
            width: 30,
            height: 30,
        })
    })

    it('should clamp width when region extends beyond frame width', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 1800, y: 100, width: 200, height: 600 }

        const result = Crop.alignRegion(frame, region)

        expect(result).toEqual({
            x: 1800,
            y: 100,
            width: 120, // 1920 - 1800 = 120
            height: 600,
        })
    })

    it('should clamp height when region extends beyond frame height', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 100, y: 900, width: 800, height: 300 }

        const result = Crop.alignRegion(frame, region)

        expect(result).toEqual({
            x: 100,
            y: 900,
            width: 800,
            height: 180, // 1080 - 900 = 180
        })
    })

    it('should handle x at exact boundary (codedWidth - 1)', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 1919, y: 100, width: 100, height: 600 }

        const result = Crop.alignRegion(frame, region)

        expect(result).toEqual({
            x: 1919,
            y: 100,
            width: 1,
            height: 600,
        })
    })

    it('should handle y at exact boundary (codedHeight - 1)', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 100, y: 1079, width: 800, height: 100 }

        const result = Crop.alignRegion(frame, region)

        expect(result).toEqual({
            x: 100,
            y: 1079,
            width: 800,
            height: 1,
        })
    })

    it('should clamp negative x to 0', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: -100, y: 100, width: 800, height: 600 }

        const result = Crop.alignRegion(frame, region)

        expect(result).toEqual({
            x: 0,
            y: 100,
            width: 800,
            height: 600,
        })
    })

    it('should clamp negative y to 0', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 100, y: -50, width: 800, height: 600 }

        const result = Crop.alignRegion(frame, region)

        expect(result).toEqual({
            x: 100,
            y: 0,
            width: 800,
            height: 600,
        })
    })

    it('should clamp both negative x and y to 0', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: -200, y: -150, width: 800, height: 600 }

        const result = Crop.alignRegion(frame, region)

        expect(result).toEqual({
            x: 0,
            y: 0,
            width: 800,
            height: 600,
        })
    })
})
