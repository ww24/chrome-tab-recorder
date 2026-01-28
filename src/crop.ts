import { CropRegion } from './configuration'

export class Crop {
    region: CropRegion = { x: 0, y: 0, width: 1, height: 1 }
    #processor: MediaStreamTrackProcessor<VideoFrame> | null = null
    #generator: MediaStreamTrackGenerator<VideoFrame> | null = null

    getCroppedStream(originalStream: MediaStream, cropRegion: CropRegion): MediaStream {
        const videoTrack = originalStream.getVideoTracks()[0]
        if (!videoTrack) return originalStream

        this.region = cropRegion
        this.#processor = new MediaStreamTrackProcessor({ track: videoTrack })
        this.#generator = new MediaStreamTrackGenerator({ kind: 'video' })

        const transformer = new TransformStream<VideoFrame, VideoFrame>({
            transform: (frame, controller) => {
                const { x, y, width, height } = this.region
                // VideoFrame の crop は visibleRect で指定
                const croppedFrame = new VideoFrame(frame, {
                    visibleRect: {
                        x: Math.max(x, frame.codedHeight),
                        y,
                        width,
                        height,
                    },
                })
                frame.close()
                controller.enqueue(croppedFrame)
            }
        })

        this.#processor.readable
            .pipeThrough(transformer)
            .pipeTo(this.#generator.writable)

        return new MediaStream([
            this.#generator,
            ...originalStream.getAudioTracks()
        ])
    }

    // do nothing
    public start() { }
    public stop() { }
}
