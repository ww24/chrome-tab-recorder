import { Input, Output, ALL_FORMATS, BlobSource, WavOutputFormat, StreamTarget, Conversion } from 'mediabunny'

/**
 * Checks if a media file has at least one audio track using Mediabunny.
 */
export async function checkMediaHasAudio(file: Blob): Promise<boolean> {
    const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(file),
    })

    const readable = await input.canRead()
    if (!readable) return false

    const audioTracks = await input.getAudioTracks()
    return audioTracks.length > 0
}

/**
 * Streaming linear interpolation audio resampler.
 * Accurately handles chunk boundaries with continuous fractional phase.
 */
export class StreamResampler {
    private phase = 0 // Position in source samples relative to the start of current input chunk
    private hasPrev = false
    private prevSample = 0
    private readonly ratio: number

    constructor(
        private readonly sourceRate: number,
        private readonly targetRate = 16000,
    ) {
        this.ratio = sourceRate / targetRate
    }

    process(input: Float32Array): Float32Array {
        if (this.sourceRate === this.targetRate) {
            return input
        }
        if (input.length === 0) {
            return new Float32Array(0)
        }

        const out: number[] = []
        let pos = this.phase

        while (pos < input.length) {
            const idx = Math.floor(pos)
            const frac = pos - idx
            let s0: number
            let s1: number

            if (idx < 0) {
                s0 = this.hasPrev ? this.prevSample : input[0]
                s1 = input[0]
            } else if (idx < input.length - 1) {
                s0 = input[idx]
                s1 = input[idx + 1]
            } else {
                // idx === input.length - 1: s1 is in the next chunk
                break
            }

            out.push(s0 + frac * (s1 - s0))
            pos += this.ratio
        }

        this.hasPrev = true
        this.prevSample = input[input.length - 1]
        this.phase = pos - input.length

        return new Float32Array(out)
    }

    flush(): Float32Array {
        if (this.sourceRate === this.targetRate || !this.hasPrev) {
            return new Float32Array(0)
        }
        const out: number[] = []
        let pos = this.phase
        while (pos <= 0) {
            out.push(this.prevSample)
            pos += this.ratio
        }
        this.hasPrev = false
        this.phase = 0
        return new Float32Array(out)
    }
}

export interface ExtractAudioStreamOptions {
    /** Target chunk size in samples (at 16kHz). Default is 16000 (1.0s). */
    chunkSize?: number
    onProgress?: (progress: number) => void
}

/**
 * Streams 16kHz mono Float32Array PCM chunks from a media file using Mediabunny's Conversion and StreamTarget.
 * Memory consumption is bounded to O(1) regardless of video duration.
 * @yields {Float32Array} 16kHz mono PCM chunk
 */
export async function* extractAudioStream(
    file: Blob,
    options: ExtractAudioStreamOptions = {},
): AsyncGenerator<Float32Array, void, unknown> {
    const queue: Float32Array[] = []
    let notifyResolver: (() => void) | null = null
    let isClosed = false
    let streamErr: unknown = null

    let headerSkipped = false
    let byteRemainder = new Uint8Array(0)

    function pushPcmBytes(bytes: Uint8Array) {
        let combined: Uint8Array
        if (byteRemainder.length > 0) {
            combined = new Uint8Array(byteRemainder.length + bytes.byteLength)
            combined.set(byteRemainder, 0)
            combined.set(bytes, byteRemainder.length)
            byteRemainder = new Uint8Array(0)
        } else {
            combined = bytes
        }

        const rem = combined.byteLength % 4
        if (rem > 0) {
            byteRemainder = combined.slice(combined.byteLength - rem)
            combined = combined.subarray(0, combined.byteLength - rem)
        }

        if (combined.byteLength > 0) {
            const f32 = new Float32Array(combined.buffer, combined.byteOffset, combined.byteLength / 4)
            queue.push(new Float32Array(f32))
            if (notifyResolver) {
                const r = notifyResolver
                notifyResolver = null
                r()
            }
        }
    }

    const writable = new WritableStream({
        write(chunk: { type: string; data: Uint8Array; position: number }) {
            if (chunk.position < 44) {
                if (!headerSkipped && chunk.position === 0 && chunk.data.byteLength > 44) {
                    headerSkipped = true
                    pushPcmBytes(chunk.data.subarray(44))
                }
                return
            }
            pushPcmBytes(chunk.data)
        },
        close() {
            isClosed = true
            if (notifyResolver) {
                const r = notifyResolver
                notifyResolver = null
                r()
            }
        },
        abort(err) {
            streamErr = err
            if (notifyResolver) {
                const r = notifyResolver
                notifyResolver = null
                r()
            }
        },
    })

    const input = new Input({
        formats: ALL_FORMATS,
        source: new BlobSource(file),
    })

    const readable = await input.canRead()
    if (!readable) {
        throw new Error('Unsupported or corrupted media file.')
    }

    const audioTracks = await input.getAudioTracks()
    if (audioTracks.length === 0) {
        throw new Error('No audio track found in media file.')
    }

    const output = new Output({
        format: new WavOutputFormat(),
        target: new StreamTarget(writable),
    })

    const chunkSize = options.chunkSize ?? 16000

    const convPromise = (async () => {
        try {
            const conversion = await Conversion.init({
                input,
                output,
                video: { discard: true },
                audio: {
                    codec: 'pcm-f32',
                    numberOfChannels: 1,
                    sampleRate: 16000,
                },
                showWarnings: false,
            })

            if (!conversion.isValid) {
                const reasons = conversion.discardedTracks.map(t => t.reason).join(', ')
                throw new Error(`Audio extraction conversion failed: ${reasons}`)
            }

            if (options.onProgress) {
                conversion.onProgress = progress => {
                    options.onProgress?.(Math.min(Math.max(progress, 0), 1))
                }
            }

            await conversion.execute()
        } catch (e) {
            streamErr = e
            if (notifyResolver) {
                const r = notifyResolver
                notifyResolver = null
                r()
            }
        }
    })()

    let acc = new Float32Array(chunkSize * 2)
    let accLen = 0

    try {
        while (true) {
            if (streamErr) throw streamErr
            if (queue.length === 0) {
                if (isClosed) break
                await new Promise<void>(res => {
                    notifyResolver = res
                })
                continue
            }

            const item = queue.shift()!
            if (accLen + item.length > acc.length) {
                const newBuf = new Float32Array(Math.max(acc.length * 2, accLen + item.length + chunkSize))
                newBuf.set(acc.subarray(0, accLen))
                acc = newBuf
            }
            acc.set(item, accLen)
            accLen += item.length

            while (accLen >= chunkSize) {
                const chunk = acc.slice(0, chunkSize)
                acc.copyWithin(0, chunkSize, accLen)
                accLen -= chunkSize
                yield chunk
            }
        }

        if (accLen > 0) {
            yield acc.slice(0, accLen)
        }
    } finally {
        await convPromise
    }

    if (options.onProgress) {
        options.onProgress(1)
    }
}

/**
 * Converts a 16-bit / 32-bit PCM WAV buffer to a Float32Array (-1.0 to 1.0).
 */
export function wavToFloat32Array(buffer: ArrayBuffer): Float32Array {
    const dataView = new DataView(buffer)
    const riff = String.fromCharCode(
        dataView.getUint8(0),
        dataView.getUint8(1),
        dataView.getUint8(2),
        dataView.getUint8(3),
    )
    if (riff !== 'RIFF') {
        throw new Error('Invalid WAV file header.')
    }

    let offset = 12
    let audioFormat = 1
    let bitsPerSample = 16
    let dataOffset = 0
    let dataLength = 0

    while (offset + 8 <= buffer.byteLength) {
        const chunkId = String.fromCharCode(
            dataView.getUint8(offset),
            dataView.getUint8(offset + 1),
            dataView.getUint8(offset + 2),
            dataView.getUint8(offset + 3),
        )
        const chunkSize = dataView.getUint32(offset + 4, true)

        if (chunkId === 'fmt ') {
            audioFormat = dataView.getUint16(offset + 8, true)
            bitsPerSample = dataView.getUint16(offset + 22, true)
        } else if (chunkId === 'data') {
            dataOffset = offset + 8
            dataLength = chunkSize
            break
        }
        offset += 8 + chunkSize
    }

    if (dataOffset === 0 || dataOffset + dataLength > buffer.byteLength) {
        dataLength = buffer.byteLength - dataOffset
    }

    if (audioFormat === 3) {
        // 32-bit IEEE float
        return new Float32Array(buffer.slice(dataOffset, dataOffset + dataLength))
    } else if (audioFormat === 1) {
        // 16-bit PCM integer
        if (bitsPerSample === 16) {
            const int16 = new Int16Array(buffer, dataOffset, Math.floor(dataLength / 2))
            const float32 = new Float32Array(int16.length)
            for (let i = 0; i < int16.length; i++) {
                float32[i] = int16[i] / 32768.0
            }
            return float32
        } else if (bitsPerSample === 32) {
            const int32 = new Int32Array(buffer, dataOffset, Math.floor(dataLength / 4))
            const float32 = new Float32Array(int32.length)
            for (let i = 0; i < int32.length; i++) {
                float32[i] = int32[i] / 2147483648.0
            }
            return float32
        }
    }

    throw new Error(`Unsupported WAV audio format: format=${audioFormat}, bits=${bitsPerSample}`)
}

/**
 * Extracts the audio track from a media file and resamples it to 16kHz mono Float32Array PCM.
 */
export async function extractAudioPCM(file: Blob, onProgress?: (progress: number) => void): Promise<Float32Array> {
    const chunks: Float32Array[] = []
    let totalLen = 0
    for await (const chunk of extractAudioStream(file, { onProgress })) {
        chunks.push(chunk)
        totalLen += chunk.length
    }
    const result = new Float32Array(totalLen)
    let offset = 0
    for (const chunk of chunks) {
        result.set(chunk, offset)
        offset += chunk.length
    }
    return result
}
