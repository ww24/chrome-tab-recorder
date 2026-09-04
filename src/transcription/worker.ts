/* oxlint-disable unicorn/require-post-message-target-origin, no-control-regex */
import './worker_shim'
import { pipeline, env } from '@huggingface/transformers'
import { OPFSCache, downloadWhisperModel } from './opfs_cache'
import { ModelLoadProgressTracker } from './progress_tracker'
import { normalizeLoudness } from './loudness'
import {
    SileroVADManager,
    SileroVADSegmenter,
    FixedChunkSegmenter,
    type AudioSegment,
    type AudioSegmenter,
} from './vad'
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'
import type {
    WorkerInMessage,
    WorkerOutMessage,
    TranscriptionSegment,
    TranscriptionResult,
    DownloadProgress,
} from './types'

// Configure environment
env.allowLocalModels = true
env.useWasmCache = false

// Initialize OPFS cache for permanent model file caching (avoids re-downloads & memory heap bloat)
const opfsCache = new OPFSCache()
env.useCustomCache = true
env.customCache = opfsCache as any
env.useBrowserCache = false
env.useFSCache = false

// Wrap env.fetch to supply Content-Length for local extension assets (e.g. Silero VAD)
// where browser fetch does not provide Content-Length header, preventing buffer reallocation warnings.
const baseFetch = env.fetch
env.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await baseFetch(input, init)
    if (response && response.headers && !response.headers.get('content-length')) {
        try {
            const cloned = response.clone()
            const blob = await cloned.blob()
            const sizeStr = String(blob.size)
            const originalGet = response.headers.get.bind(response.headers)
            response.headers.get = (name: string) => {
                if (name.toLowerCase() === 'content-length') {
                    return sizeStr
                }
                return originalGet(name)
            }
        } catch {
            // Ignore cloning failure and keep original response
        }
    }
    return response
}

// Request persistent storage so browser does not evict OPFS files
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
    navigator.storage.persist().catch(() => {})
}

// Configure ONNX Runtime Web WASM path via Vite bundled asset
if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.wasmPaths = {
        wasm: ortWasmUrl,
    }
    env.backends.onnx.wasm.numThreads = 1
}

const pad = (n: number) => n.toString().padStart(2, '0')

function formatSeconds(seconds: number): string {
    if (isNaN(seconds) || seconds < 0) return '00:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 100)
    return `${pad(mins)}:${pad(secs)}.${pad(ms)}`
}

/**
 * Whisper の Byte-level BPE トークナイザーに起因する
 * 不正な UTF-8 バイト列（\uFFFD 置換文字）や不要な制御コードを除去して正規化する
 */
function cleanTranscriptionText(rawText: string): string {
    if (!rawText) return ''
    return rawText
        .replace(/\uFFFD/g, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
        .replace(/[ \t]+/g, ' ')
        .trim()
}

const WHISPER_MODEL_ID = 'onnx-community/whisper-large-v3-turbo'

function assertWebGpuSupported(): void {
    if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
        throw new Error(
            'WebGPU is not supported on this browser or device. Please ensure hardware acceleration is enabled in Chrome settings.',
        )
    }
}

/**
 * Whisper パイプラインのライフサイクル管理を担当するクラス
 */
class PipelineManager {
    private static instance: any = null
    private static currentCacheKey: string | null = null

    static async getInstance(modelId: string = WHISPER_MODEL_ID, onProgress?: (data: DownloadProgress) => void) {
        assertWebGpuSupported()

        const dtype = {
            encoder_model: 'fp16',
            decoder_model_merged: 'q4',
        }
        const cacheKey = `${modelId}::${JSON.stringify(dtype)}::webgpu`

        if (this.instance) {
            if (this.currentCacheKey === cacheKey) {
                return { transcriber: this.instance, device: 'webgpu' as const }
            }

            // Dispose previous model instance
            try {
                if (this.instance.model?.dispose) {
                    await this.instance.model.dispose()
                } else if (typeof this.instance.dispose === 'function') {
                    await this.instance.dispose()
                }
            } catch (e) {
                console.warn('Error disposing previous model:', e)
            }
            this.instance = null
            this.currentCacheKey = null
            await new Promise(resolve => setTimeout(resolve, 50))
        }

        this.instance = await pipeline('automatic-speech-recognition', modelId, {
            device: 'webgpu',
            dtype,
            local_files_only: true,
            use_external_data_format: {
                'encoder_model.onnx': true,
            },
            progress_callback: (info: any) => {
                if (onProgress) {
                    onProgress(info as DownloadProgress)
                }
            },
        })
        this.currentCacheKey = cacheKey

        return { transcriber: this.instance, device: 'webgpu' as const }
    }
}

export interface TranscribedChunk {
    start: number
    end: number
    text: string
}

/**
 * Whisper による音声推論・正規化・テキストクレンジングを担当するクラス
 */
export class WhisperTranscriber {
    constructor(private readonly transcriber: any) {}

    async transcribe(
        segment: AudioSegment,
        options?: { language?: string },
    ): Promise<{ fullText: string; chunks: TranscribedChunk[] }> {
        const transcriberOptions: any = {
            task: 'transcribe',
            return_timestamps: true,
            chunk_length_s: 30,
            stride_length_s: 5,
            condition_on_previous_text: false,
            temperature: 0.0,
            repetition_penalty: 1.2,
            no_repeat_ngram_size: 4,
        }
        if (options?.language && options.language !== 'none') {
            transcriberOptions.language = options.language
        }

        const normalizedPcm = normalizeLoudness(segment.pcm, {
            targetLufs: -20.0,
            maxGainDb: 18.0,
            minLufs: -60.0,
            sampleRate: 16000,
        })

        const sliceOutput = await this.transcriber(normalizedPcm, transcriberOptions)
        const resultChunks: TranscribedChunk[] = []
        let fullText = ''

        if (sliceOutput && typeof sliceOutput === 'object') {
            const sliceText = cleanTranscriptionText(sliceOutput.text || '')
            if (sliceText) {
                fullText = sliceText
                if (Array.isArray(sliceOutput.chunks) && sliceOutput.chunks.length > 0) {
                    for (const chunk of sliceOutput.chunks) {
                        const relStart = chunk.timestamp?.[0] ?? 0
                        const relEnd = chunk.timestamp?.[1] ?? segment.end - segment.start
                        const chunkText = cleanTranscriptionText(chunk.text || '')
                        if (chunkText) {
                            resultChunks.push({
                                start: segment.start + relStart,
                                end: segment.start + relEnd,
                                text: chunkText,
                            })
                        }
                    }
                } else {
                    resultChunks.push({
                        start: segment.start,
                        end: segment.end,
                        text: sliceText,
                    })
                }
            }
        }

        return { fullText, chunks: resultChunks }
    }
}

/**
 * ストリーミング文字起こしセッションのオーケストレーションを担当するクラス
 */
class StreamingTranscriptionSession {
    private transcriber: WhisperTranscriber | null = null
    private segmenter: AudioSegmenter | null = null

    private queue: AudioSegment[] = []
    private isProcessingQueue = false
    private audioEnded = false
    private segments: TranscriptionSegment[] = []
    private segmentIdCounter = 1
    private fullText = ''
    private pureInferenceTimeMs = 0
    private startTime = 0
    private pendingAckNeeded = false

    private lastProcessedSec = 0
    private lastCompletedJobEndSec = 0
    private currentlyProcessingJob: AudioSegment | null = null
    private lastReportedPercent = -1

    constructor(
        private readonly modelId: string,
        private readonly language?: string,
        private readonly vadEnabled = true,
        private readonly vadThreshold = 0.5,
        private readonly totalDurationSec = 0,
    ) {}

    async init() {
        this.startTime = performance.now()

        self.postMessage({
            type: 'status',
            message: 'Loading Whisper model...',
        } satisfies WorkerOutMessage)

        const tracker = new ModelLoadProgressTracker(this.vadEnabled)

        const { transcriber, device } = await PipelineManager.getInstance(this.modelId, progress => {
            const overall = tracker.track('whisper', progress)
            self.postMessage({
                type: 'download-progress',
                data: overall,
            } satisfies WorkerOutMessage)
        })
        this.transcriber = new WhisperTranscriber(transcriber)
        tracker.markModelComplete('whisper')

        if (this.vadEnabled) {
            self.postMessage({
                type: 'status',
                message: 'Loading Silero VAD model...',
            } satisfies WorkerOutMessage)

            const vadModel = await SileroVADManager.getInstance(progress => {
                const overall = tracker.track('vad', progress)
                self.postMessage({
                    type: 'download-progress',
                    data: overall,
                } satisfies WorkerOutMessage)
            })
            tracker.markModelComplete('vad')

            this.segmenter = new SileroVADSegmenter(vadModel, seg => this.enqueueJob(seg), this.vadThreshold)
        } else {
            this.segmenter = new FixedChunkSegmenter(seg => this.enqueueJob(seg))
        }

        self.postMessage({
            type: 'model-ready',
            modelId: this.modelId,
            device,
        } satisfies WorkerOutMessage)

        self.postMessage({
            type: 'transcribe-start',
        } satisfies WorkerOutMessage)
    }

    async processChunk(chunk: Float32Array) {
        if (!this.segmenter) {
            throw new Error('Session not initialized')
        }
        await this.segmenter.feed(chunk)
        this.handleBackpressureAck()
        this.notifyProgress()
    }

    async finishAudio() {
        this.audioEnded = true
        if (this.segmenter) {
            await this.segmenter.finish()
        }
        if (this.queue.length === 0 && !this.isProcessingQueue) {
            this.notifyProgress()
            this.finalizeResult()
        }
    }

    private enqueueJob(job: AudioSegment) {
        this.queue.push(job)
        this.processQueue().catch(err => {
            self.postMessage({
                type: 'error',
                error: err?.message ?? String(err),
            } satisfies WorkerOutMessage)
        })
    }

    private handleBackpressureAck() {
        if (this.queue.length <= 2) {
            self.postMessage({ type: 'chunk-ack' } satisfies WorkerOutMessage)
        } else {
            this.pendingAckNeeded = true
        }
    }

    private notifyProgress() {
        let currentProcessedSec = this.lastCompletedJobEndSec

        if (this.currentlyProcessingJob) {
            currentProcessedSec = Math.max(currentProcessedSec, this.currentlyProcessingJob.start)
        } else if (this.queue.length > 0) {
            currentProcessedSec = Math.max(currentProcessedSec, this.queue[0].start)
        } else if (this.segmenter) {
            currentProcessedSec = Math.max(currentProcessedSec, this.segmenter.getCurrentEvaluatedSec())
        }

        this.lastProcessedSec = Math.max(this.lastProcessedSec, currentProcessedSec)

        let percent = 0
        if (this.totalDurationSec > 0) {
            percent = Math.min(99, Math.floor((this.lastProcessedSec / this.totalDurationSec) * 100))
        }

        if (percent !== this.lastReportedPercent) {
            this.lastReportedPercent = percent
            self.postMessage({
                type: 'transcribe-progress',
                processedSec: this.lastProcessedSec,
                percent,
            } satisfies WorkerOutMessage)
        }
    }

    private async processQueue() {
        if (this.isProcessingQueue) return
        this.isProcessingQueue = true

        while (this.queue.length > 0) {
            const job = this.queue.shift()!
            this.currentlyProcessingJob = job
            try {
                const t0 = performance.now()
                const { fullText, chunks } = await this.transcriber!.transcribe(job, {
                    language: this.language,
                })
                this.pureInferenceTimeMs += performance.now() - t0

                for (const chunk of chunks) {
                    const seg: TranscriptionSegment = {
                        id: this.segmentIdCounter++,
                        start: chunk.start,
                        end: chunk.end,
                        formattedStart: formatSeconds(chunk.start),
                        formattedEnd: formatSeconds(chunk.end),
                        text: chunk.text,
                    }
                    this.segments.push(seg)
                    self.postMessage({
                        type: 'transcribe-segment',
                        segment: seg,
                    } satisfies WorkerOutMessage)
                }
                if (fullText) {
                    this.fullText += (this.fullText ? '\n' : '') + fullText
                }
            } finally {
                this.currentlyProcessingJob = null
            }
            this.lastCompletedJobEndSec = Math.max(this.lastCompletedJobEndSec, job.end)
            this.notifyProgress()

            if (this.pendingAckNeeded && this.queue.length <= 2) {
                this.pendingAckNeeded = false
                self.postMessage({ type: 'chunk-ack' } satisfies WorkerOutMessage)
            }
        }

        this.isProcessingQueue = false
        if (this.audioEnded && this.queue.length === 0) {
            this.notifyProgress()
            this.finalizeResult()
        }
    }

    private finalizeResult() {
        const totalTimeMs = Math.round(performance.now() - this.startTime)
        const stats = this.segmenter?.getStats()
        const durationSeconds = stats?.totalDuration ?? this.lastProcessedSec

        this.lastProcessedSec = durationSeconds
        if (this.lastReportedPercent < 100) {
            this.lastReportedPercent = 100
            self.postMessage({
                type: 'transcribe-progress',
                processedSec: durationSeconds,
                percent: 100,
            } satisfies WorkerOutMessage)
        }

        const result: TranscriptionResult = {
            text: this.fullText,
            segments: this.segments,
            durationSeconds,
            processingTimeMs: Math.round(this.pureInferenceTimeMs),
            totalTimeMs,
            ...(this.vadEnabled && stats
                ? {
                      vadStats: {
                          totalDuration: stats.totalDuration,
                          speechDuration: stats.speechDuration,
                          skippedSilenceDuration: stats.skippedSilenceDuration,
                          speechSegmentCount: stats.speechSegmentCount,
                      },
                  }
                : {}),
        }

        self.postMessage({
            type: 'transcribe-complete',
            result,
        } satisfies WorkerOutMessage)
    }
}

let currentSession: StreamingTranscriptionSession | null = null

self.addEventListener('message', async (event: MessageEvent<WorkerInMessage>) => {
    const message = event.data

    try {
        if (message.type === 'load') {
            assertWebGpuSupported()

            self.postMessage({
                type: 'status',
                message: `Downloading model ${message.modelId}...`,
            } satisfies WorkerOutMessage)

            await downloadWhisperModel(progress => {
                self.postMessage({
                    type: 'download-progress',
                    data: progress,
                } satisfies WorkerOutMessage)
            })

            const hasAllFiles = await opfsCache.hasModel()
            if (!hasAllFiles) {
                throw new Error('Model download completed, but required files are missing in OPFS storage.')
            }

            self.postMessage({
                type: 'model-ready',
                modelId: message.modelId,
                device: 'webgpu',
            } satisfies WorkerOutMessage)
        } else if (message.type === 'transcribe-init') {
            currentSession = new StreamingTranscriptionSession(
                message.modelId,
                message.language,
                message.vadEnabled,
                message.vadThreshold ?? 0.5,
                message.totalDurationSec ?? 0,
            )
            await currentSession.init()
        } else if (message.type === 'audio-chunk') {
            if (!currentSession) {
                throw new Error('No active streaming transcription session.')
            }
            await currentSession.processChunk(message.chunk)
        } else if (message.type === 'audio-end') {
            if (!currentSession) {
                throw new Error('No active streaming transcription session.')
            }
            await currentSession.finishAudio()
            currentSession = null
        } else if (message.type === 'transcribe') {
            // Backwards-compatible batch transcribe: feeds audio chunk-by-chunk into StreamingTranscriptionSession
            currentSession = new StreamingTranscriptionSession(
                message.modelId,
                message.language,
                message.vadEnabled,
                message.vadThreshold ?? 0.5,
                message.totalDurationSec ?? message.audio.length / 16000,
            )
            await currentSession.init()
            const chunkSize = 16000
            for (let offset = 0; offset < message.audio.length; offset += chunkSize) {
                const chunk = message.audio.subarray(offset, Math.min(offset + chunkSize, message.audio.length))
                await currentSession.processChunk(chunk)
            }
            await currentSession.finishAudio()
            currentSession = null
        }
    } catch (error: any) {
        self.postMessage({
            type: 'error',
            error: error?.message ?? String(error),
        } satisfies WorkerOutMessage)
    }
})
