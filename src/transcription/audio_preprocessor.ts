import { Input, Output, ALL_FORMATS, BlobSource, WavOutputFormat, StreamTarget, Conversion } from 'mediabunny'
import { StreamingLoudnessMeasurer, type LoudnessNormalizationOptions } from './loudness'

export interface PrepareAudioOptions {
    onProgress?: (progress: number) => void
    normalizationOptions?: LoudnessNormalizationOptions
}

export interface PreparedAudioResult {
    opfsFileName: string
    durationSec: number
}

/**
 * Converts a media file into 16kHz mono pcm-s16 WAV, measures integrated loudness,
 * applies loudness normalization, and writes the resulting WAV file to OPFS storage.
 *
 * Runs with O(1) memory overhead even for hours of recording.
 */
export async function prepareNormalizedAudioToOpfs(
    file: Blob,
    recordedAt: number,
    options: PrepareAudioOptions = {},
): Promise<PreparedAudioResult> {
    const rawFileName = `transcription-raw-${recordedAt}.wav`
    const normalizedFileName = `transcription-audio-${recordedAt}.wav`

    const root = await navigator.storage.getDirectory()

    // 1. Convert media to 16kHz mono pcm-s16 WAV using Mediabunny into temporary raw file
    const rawHandle = await root.getFileHandle(rawFileName, { create: true })
    const rawWritable = await rawHandle.createWritable()

    try {
        const streamTargetWritable = new WritableStream({
            async write(chunk: { type: string; data: Uint8Array; position?: number }) {
                if (chunk.position !== undefined) {
                    await rawWritable.write({ type: 'write', position: chunk.position, data: chunk.data })
                } else {
                    await rawWritable.write(chunk.data)
                }
            },
            async close() {
                await rawWritable.close()
            },
            async abort(err) {
                await rawWritable.abort(err)
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
            target: new StreamTarget(streamTargetWritable),
        })

        const conversion = await Conversion.init({
            input,
            output,
            video: { discard: true },
            audio: {
                codec: 'pcm-s16',
                numberOfChannels: 1,
                sampleRate: 16000,
                sampleFormat: 's16',
            },
            showWarnings: false,
        })

        if (!conversion.isValid) {
            const reasons = conversion.discardedTracks.map(t => t.reason).join(', ')
            throw new Error(`Audio extraction conversion failed: ${reasons}`)
        }

        if (options.onProgress) {
            conversion.onProgress = progress => {
                // First half (0.0 to 0.5) represents media decoding & extraction
                options.onProgress?.(Math.min(Math.max(progress * 0.5, 0), 0.5))
            }
        }

        await conversion.execute()
    } catch (err) {
        await root.removeEntry(rawFileName).catch(() => {})
        throw err
    }

    // 2. Measure integrated loudness from the extracted raw WAV
    const rawFile = await rawHandle.getFile()
    const rawFileSize = rawFile.size

    if (rawFileSize <= 44) {
        return { opfsFileName: rawFileName, durationSec: 0 }
    }

    const totalSamples = Math.floor((rawFileSize - 44) / 2)
    const durationSec = totalSamples / 16000

    const measurer = new StreamingLoudnessMeasurer(16000)
    const CHUNK_BYTES = 64 * 1024 // 64KB = 32768 samples
    let offset = 44

    while (offset < rawFileSize) {
        const readEnd = Math.min(rawFileSize, offset + CHUNK_BYTES)
        const blobSlice = rawFile.slice(offset, readEnd)
        const arrayBuf = await blobSlice.arrayBuffer()
        const int16View = new Int16Array(arrayBuf)
        const f32 = new Float32Array(int16View.length)
        for (let i = 0; i < int16View.length; i++) {
            f32[i] = int16View[i] / 32768.0
        }
        measurer.feed(f32)
        offset = readEnd
    }

    const gain = measurer.calculateGain(options.normalizationOptions ?? { targetLufs: -20.0 })

    // If gain is essentially 1.0 (no normalization needed), keep raw file as audio file
    if (Math.abs(gain - 1.0) < 0.01) {
        options.onProgress?.(1.0)
        return { opfsFileName: rawFileName, durationSec }
    }

    // 3. Apply normalization gain and write to final normalized WAV file
    const normHandle = await root.getFileHandle(normalizedFileName, { create: true })
    const normWritable = await normHandle.createWritable()

    try {
        // Copy 44-byte WAV header
        const headerBuf = await rawFile.slice(0, 44).arrayBuffer()
        await normWritable.write(headerBuf)

        offset = 44
        while (offset < rawFileSize) {
            const readEnd = Math.min(rawFileSize, offset + CHUNK_BYTES)
            const blobSlice = rawFile.slice(offset, readEnd)
            const arrayBuf = await blobSlice.arrayBuffer()
            const int16View = new Int16Array(arrayBuf)

            for (let i = 0; i < int16View.length; i++) {
                const scaled = int16View[i] * gain
                int16View[i] = Math.max(-32768, Math.min(32767, Math.round(scaled)))
            }

            await normWritable.write(arrayBuf)
            offset = readEnd

            if (options.onProgress) {
                const p = 0.5 + ((offset - 44) / (rawFileSize - 44)) * 0.5
                options.onProgress(Math.min(Math.max(p, 0.5), 1.0))
            }
        }

        await normWritable.close()
    } catch (err) {
        await normWritable.abort(err).catch(() => {})
        await root.removeEntry(normalizedFileName).catch(() => {})
        await root.removeEntry(rawFileName).catch(() => {})
        throw err
    }

    // Remove temporary un-normalized file
    await root.removeEntry(rawFileName).catch(() => {})

    return { opfsFileName: normalizedFileName, durationSec }
}

/**
 * Streams 16kHz mono Float32Array audio chunks from an OPFS WAV file.
 *
 * @param opfsFileName Name of WAV file in OPFS storage
 * @param chunkSizeSamples Default is 16000 (1 second per chunk)
 * @yields {Float32Array} 16kHz mono Float32 PCM chunk
 */
export async function* streamPcmFromOpfsFile(
    opfsFileName: string,
    chunkSizeSamples = 16000,
): AsyncGenerator<Float32Array, void, unknown> {
    const root = await navigator.storage.getDirectory()
    const handle = await root.getFileHandle(opfsFileName)
    const file = await handle.getFile()
    const fileSize = file.size

    const chunkBytes = chunkSizeSamples * 2 // 16-bit = 2 bytes per sample
    let offset = 44 // Skip 44-byte WAV header

    while (offset < fileSize) {
        const readEnd = Math.min(fileSize, offset + chunkBytes)
        const slice = file.slice(offset, readEnd)
        const arrayBuf = await slice.arrayBuffer()
        const int16 = new Int16Array(arrayBuf)
        const f32 = new Float32Array(int16.length)
        for (let i = 0; i < int16.length; i++) {
            f32[i] = int16[i] / 32768.0
        }
        yield f32
        offset = readEnd
    }
}

/**
 * Safely removes a temporary audio file from OPFS storage.
 */
export async function cleanupOpfsTempAudio(opfsFileName: string): Promise<void> {
    try {
        const root = await navigator.storage.getDirectory()
        await root.removeEntry(opfsFileName)
    } catch {
        // File may not exist or already removed, ignore silently
    }
}
