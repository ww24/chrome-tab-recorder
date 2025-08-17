import * as ebml from 'ts-ebml'
import { Buffer } from 'buffer'
window.Buffer = Buffer

export class MediaRecorderWebMDurationWorkaround {
    private decoder?: ebml.Decoder
    private reader?: ebml.Reader

    public constructor() {
        this.decoder = new ebml.Decoder()
        this.reader = new ebml.Reader()
    }

    /**
     * decode data and read
     * @param chunk {Blob} 'dataavailable' event.data
     */
    public async write(chunk: Blob) {
        const buff = await chunk.arrayBuffer()
        this.decoder?.decode(buff).forEach(detail => {
            this.reader?.read(detail)
        })
    }

    /**
     * free decoder and stop reader
     */
    public close() {
        this.decoder = undefined
        this.reader?.stop()
    }

    /**
     * get WebM duration
     * @return {number} duration [ms]
     */
    public duration(): number {
        return (this.reader?.duration ?? 0) * (this.reader?.timestampScale ?? 0) / 1000 / 1000
    }

    /**
     * fix WebM metadata
     * @param recorded {Blob} recorded WebM data
     * @returns {Blob} fixed WebM data
     */
    public fixMetadata(recorded: Blob): Blob {
        if (this.reader == null) throw new Error('reader is not initialized')
        const refinedMetadataBuf = ebml.tools.makeMetadataSeekable(
            this.reader.metadatas,
            this.reader.duration,
            this.reader.cues
        )
        const body = recorded.slice(this.reader.metadataSize)
        const fixed = new Blob([refinedMetadataBuf, body], { type: recorded.type })
        this.reader = undefined
        return fixed
    }
}

export async function fixWebmDuration(blob: Blob) {
    const decoder = new ebml.Decoder()
    const reader = new ebml.Reader()

    const r = blob.stream().getReader()
    while (true) {
        const { done, value } = await r.read()
        if (done) break
        const details = decoder.decode(value as unknown as ArrayBuffer) // workaround: `decoder.decode(value.buffer)` is not work
        for (const detail of details) {
            reader.read(detail)
        }
    }
    reader.stop()
    const nanosec = reader.duration * reader.timestampScale
    const sec = nanosec / 1000 / 1000 / 1000
    console.log('Duration:', sec)

    const refinedMetadataBuf = ebml.tools.makeMetadataSeekable(
        reader.metadatas,
        reader.duration,
        reader.cues
    )
    const body = blob.slice(reader.metadataSize)
    return new Blob([refinedMetadataBuf, body], { type: blob.type })
};
