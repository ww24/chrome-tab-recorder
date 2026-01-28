import { CropRegion } from './configuration'

export class Crop {
    region: CropRegion = { x: 0, y: 0, width: 1, height: 1 }
    #processor: MediaStreamTrackProcessor<VideoFrame> | null = null
    #generator: MediaStreamTrackGenerator<VideoFrame> | null = null

    getCroppedStream(originalStream: MediaStream, cropRegion: CropRegion): MediaStream {
        const videoTrack = originalStream.getVideoTracks()[0]
        if (!videoTrack) return originalStream

        this.region = cropRegion
        this.#processor = new MediaStreamTrackProcessor({ track: videoTrack as MediaStreamVideoTrack })
        this.#generator = new MediaStreamTrackGenerator({ kind: 'video' })

        const transformer = new TransformStream<VideoFrame, VideoFrame>({
            transform: (frame, controller) => {
                const croppedFrame = new VideoFrame(frame, {
                    visibleRect: alignRegion(frame, cropRegion),
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

export function alignRegion(frame: VideoFrame, region: CropRegion): CropRegion {
    const x = Math.min(region.x, frame.codedWidth - 1)
    const y = Math.min(region.y, frame.codedHeight - 1)
    return {
        x, y,
        width: Math.min(region.width, frame.codedWidth - x),
        height: Math.min(region.height, frame.codedHeight - y),
    }
}
