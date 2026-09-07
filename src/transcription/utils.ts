/**
 * Whisper Byte-level BPE tokenizer post-processing:
 * Removes replacement character (\uFFFD), non-printable control codes,
 * and normalizes whitespace.
 */
export function cleanTranscriptionText(rawText: string): string {
    if (!rawText) return ''
    return (
        rawText
            .replace(/\uFFFD/g, '') // Remove Unicode replacement characters
            // eslint-disable-next-line no-control-regex
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '') // Remove control characters except \t, \n, \r
            .replace(/[ \t]+/g, ' ') // Normalize spaces/tabs
            .trim()
    )
}

const pad = (n: number) => n.toString().padStart(2, '0')

/**
 * Formats time in seconds to mm:ss or mm:ss.ms
 */
export function formatSeconds(seconds: number, includeMs = false): string {
    if (isNaN(seconds) || seconds < 0) return includeMs ? '00:00.00' : '00:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    if (includeMs) {
        const ms = Math.floor((seconds % 1) * 100)
        return `${pad(mins)}:${pad(secs)}.${pad(ms)}`
    }
    return `${pad(mins)}:${pad(secs)}`
}

const FOURCC_RIFF = 0x52494646
const FOURCC_WAVE = 0x57415645
const FOURCC_FMT = 0x666d7420
const FOURCC_DATA = 0x64617461

const WAVE_FORMAT_IEEE_FLOAT = 3

/**
 * Parses 32-bit IEEE float PCM samples from a WAV ArrayBuffer into a Float32Array.
 * Throws an error if the WAV file is invalid or not in 32-bit float format (pcm-f32).
 */
export function wavToFloat32Array(buffer: ArrayBuffer): Float32Array {
    if (buffer.byteLength < 12) {
        throw new Error('Invalid WAV file: buffer too small')
    }

    const dataView = new DataView(buffer)
    if (dataView.getUint32(0, false) !== FOURCC_RIFF) {
        throw new Error('Invalid WAV file: missing RIFF header')
    }
    if (dataView.getUint32(8, false) !== FOURCC_WAVE) {
        throw new Error('Invalid WAV file: missing WAVE header')
    }

    let offset = 12
    let audioFormat = 0
    let bitsPerSample = 0
    let dataOffset = 0
    let dataLength = 0
    let foundFmt = false

    while (offset + 8 <= buffer.byteLength) {
        const chunkId = dataView.getUint32(offset, false)
        const chunkSize = dataView.getUint32(offset + 4, true)

        if (chunkId === FOURCC_FMT) {
            if (offset + 8 + 16 > buffer.byteLength) {
                throw new Error('Invalid WAV file: corrupted fmt chunk')
            }
            audioFormat = dataView.getUint16(offset + 8, true)
            bitsPerSample = dataView.getUint16(offset + 22, true)
            foundFmt = true
        } else if (chunkId === FOURCC_DATA) {
            dataOffset = offset + 8
            dataLength = chunkSize
            break
        }
        offset += 8 + ((chunkSize + 1) & ~1)
    }

    if (!foundFmt) {
        throw new Error('Invalid WAV file: missing fmt chunk')
    }
    if (audioFormat !== WAVE_FORMAT_IEEE_FLOAT) {
        throw new Error(`Unsupported WAV format: expected 32-bit IEEE float (format=3), but got format=${audioFormat}`)
    }
    if (bitsPerSample !== 32) {
        throw new Error(`Unsupported WAV bit depth: expected 32-bit, but got ${bitsPerSample}-bit`)
    }
    if (dataOffset === 0) {
        throw new Error('Invalid WAV file: missing data chunk')
    }

    if (dataLength === 0) {
        throw new Error('Invalid WAV file: empty data chunk')
    }
    if (dataOffset + dataLength > buffer.byteLength) {
        throw new Error('Invalid WAV file: corrupted data chunk')
    }
    if (dataLength % 4 !== 0) {
        throw new Error('Invalid WAV file: data length is not a multiple of 4 bytes')
    }

    return new Float32Array(buffer.slice(dataOffset, dataOffset + dataLength))
}
