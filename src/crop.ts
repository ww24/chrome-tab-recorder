import { CropRegion } from './configuration'

export class Crop {
    public region: CropRegion = { x: 0, y: 0, width: 1, height: 1 }

    getCroppedStream(originalStream: MediaStream, cropRegion: CropRegion): MediaStream {
        const videoTrack = originalStream.getVideoTracks()[0]
        if (!videoTrack) return originalStream

        this.region = cropRegion
        const processor = new MediaStreamTrackProcessor({ track: videoTrack as MediaStreamVideoTrack })
        const generator = new MediaStreamTrackGenerator({ kind: 'video' })

        const transformer = new TransformStream<VideoFrame, VideoFrame>({
            transform: (frame, controller) => {
                const croppedFrame = new VideoFrame(frame, {
                    visibleRect: alignRegion(frame, this.region),
                })
                frame.close()
                controller.enqueue(croppedFrame)
            }
        })

        processor.readable
            .pipeThrough(transformer)
            .pipeTo(generator.writable)
            .catch((e) => {
                // Pipeline errors are expected when the stream is stopped
                // (e.g., recording ends, track is stopped)
                if (e instanceof TypeError && e.message.includes('aborted')) {
                    return
                }
                console.error('Crop pipeline error:', e)
            })

        return new MediaStream([
            generator,
            ...originalStream.getAudioTracks()
        ])
    }
}

export function alignRegion(frame: VideoFrame, region: CropRegion): CropRegion {
    const x = Math.max(0, Math.min(region.x, frame.codedWidth - 1))
    const y = Math.max(0, Math.min(region.y, frame.codedHeight - 1))
    return {
        x, y,
        width: Math.min(region.width, frame.codedWidth - x),
        height: Math.min(region.height, frame.codedHeight - y),
    }
}
