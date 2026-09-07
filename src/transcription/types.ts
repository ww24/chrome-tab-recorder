export interface TranscriptionSegment {
    /** Start time in seconds (precision up to 3 decimal places) */
    startSec: number
    /** End time in seconds */
    endSec: number
    /** Sanitized transcription text */
    text: string
}

export interface WorkerTimings {
    loudnessNormMs: number
    vadMs: number
    inferenceMs: number
}

export interface TranscriptionResult {
    /** Array of transcription segments */
    segments: TranscriptionSegment[]
    /** Transcription completion timestamp in milliseconds */
    transcribedAt: number
    /** Model identifier used for transcription */
    modelId: string
    /** Language used for transcription */
    language: string
}

export function isTranscriptionSegment(v: unknown): v is TranscriptionSegment {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return false
    }
    const s = v as Record<string, unknown>
    return (
        typeof s.startSec === 'number' &&
        Number.isFinite(s.startSec) &&
        s.startSec >= 0 &&
        typeof s.endSec === 'number' &&
        Number.isFinite(s.endSec) &&
        s.endSec >= s.startSec &&
        typeof s.text === 'string'
    )
}

export function isTranscriptionResult(v: unknown): v is TranscriptionResult {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return false
    }
    const r = v as Record<string, unknown>
    return (
        typeof r.transcribedAt === 'number' &&
        Number.isFinite(r.transcribedAt) &&
        r.transcribedAt >= 0 &&
        typeof r.modelId === 'string' &&
        r.modelId.trim().length > 0 &&
        typeof r.language === 'string' &&
        r.language.trim().length > 0 &&
        Array.isArray(r.segments) &&
        r.segments.every(isTranscriptionSegment)
    )
}

export type WorkerInMessage =
    | { type: 'init'; modelId: string; language: string }
    | { type: 'transcribe'; audio: Float32Array }
    | { type: 'dispose' }

export type WorkerErrorCode =
    | 'WEBGPU_NOT_AVAILABLE'
    | 'WEBGPU_FP16_NOT_SUPPORTED'
    | 'MODEL_LOAD_FAILED'
    | 'TRANSCRIBE_FAILED'

export type WorkerOutMessage =
    | { type: 'ready' }
    | { type: 'download_progress'; loaded: number; total: number; file: string }
    | { type: 'transcribe_progress'; stage: 'loudness' | 'vad' | 'inference'; progress: number }
    | { type: 'result'; segments: TranscriptionSegment[]; timings: WorkerTimings }
    | { type: 'error'; message: string; code: WorkerErrorCode }
