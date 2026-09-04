import { PreTrainedModel, Tensor } from '@huggingface/transformers'
import type { DownloadProgress, VadStats } from './types'
import { measureLoudness } from './loudness'

export interface AudioSegment {
    start: number
    end: number
    pcm: Float32Array
}

export type AudioSegmentCallback = (segment: AudioSegment) => void

export interface AudioSegmenter {
    feed(chunk: Float32Array): Promise<void>
    finish(): Promise<void>
    getStats(): VadStats
    getCurrentEvaluatedSec(): number
}

export function mergeFloat32Arrays(chunks: Float32Array[], maxSamples?: number): Float32Array {
    let total = 0
    for (const c of chunks) total += c.length
    const limit = maxSamples !== undefined ? Math.min(total, maxSamples) : total
    const res = new Float32Array(limit)
    let offset = 0
    for (const c of chunks) {
        if (offset >= limit) break
        const copyLen = Math.min(c.length, limit - offset)
        res.set(c.subarray(0, copyLen), offset)
        offset += copyLen
    }
    return res
}

/**
 * ストリーミング音声チャンクを目標 LUFS（-20.0 LUFS）に適応正規化するクラス。
 * VAD 判定前および Whisper 推論前の双方に理想的な音量を供給する。
 */
export class StreamingLoudnessNormalizer {
    private currentGain = 1.0
    private hasEstimatedGain = false
    private readonly targetLufs: number
    private readonly maxGainLinear: number
    private readonly minLufs: number
    private readonly maxPeak: number

    constructor(options?: { targetLufs?: number; maxGainDb?: number; minLufs?: number; maxPeak?: number }) {
        this.targetLufs = options?.targetLufs ?? -20.0
        const maxGainDb = options?.maxGainDb ?? 18.0
        this.maxGainLinear = Math.pow(10, maxGainDb / 20)
        this.minLufs = options?.minLufs ?? -60.0
        this.maxPeak = options?.maxPeak ?? 0.95
    }

    process(chunk: Float32Array): Float32Array {
        if (chunk.length === 0) return chunk

        let peak = 0
        for (let i = 0; i < chunk.length; i++) {
            const abs = Math.abs(chunk[i])
            if (abs > peak) peak = abs
        }

        // 純粋な無音やノイズフロア以下でなければラウドネスを測定してゲインを更新
        if (peak > 0.005) {
            const lufs = measureLoudness(chunk, 16000)
            if (isFinite(lufs) && lufs >= this.minLufs) {
                const deltaLufs = this.targetLufs - lufs
                let targetGain = Math.pow(10, deltaLufs / 20)
                if (targetGain > this.maxGainLinear) targetGain = this.maxGainLinear
                if (targetGain < 0.1) targetGain = 0.1

                if (!this.hasEstimatedGain) {
                    this.currentGain = targetGain
                    this.hasEstimatedGain = true
                } else {
                    // 指数移動平均で急激なゲイン変化を抑えて滑らかに追従
                    const alpha = 0.1
                    this.currentGain = this.currentGain * (1 - alpha) + targetGain * alpha
                }
            }
        }

        // ピークリミッター
        let effectiveGain = this.currentGain
        if (peak * effectiveGain > this.maxPeak) {
            effectiveGain = this.maxPeak / peak
        }

        if (Math.abs(effectiveGain - 1.0) < 0.01) {
            return chunk
        }

        const out = new Float32Array(chunk.length)
        for (let i = 0; i < chunk.length; i++) {
            out[i] = chunk[i] * effectiveGain
        }
        return out
    }
}

/**
 * Silero VAD モデルのライフサイクル管理を担当するクラス
 */
export class SileroVADManager {
    private static instance: any = null

    static async getInstance(onProgress?: (data: DownloadProgress) => void): Promise<any> {
        if (this.instance) return this.instance
        // Load bundled Silero VAD v6.2 model directly from extension assets (/models/silero-vad)
        this.instance = await PreTrainedModel.from_pretrained('/models/silero-vad', {
            config: {
                model_type: 'custom',
                architectures: ['BertModel'],
                sampling_rate: [8000, 16000],
                state_dim: 128,
                num_layers: 2,
            } as any,
            dtype: 'fp32',
            local_files_only: true,
            progress_callback: (info: any) => {
                if (onProgress) {
                    onProgress(info as DownloadProgress)
                }
            },
        })
        return this.instance
    }
}

/**
 * Silero VAD モデルを使用してストリーミング音声から発話区間を検出・切り出すセグメンタ。
 */
export class SileroVADSegmenter implements AudioSegmenter {
    static readonly SAMPLE_RATE = 16000
    static readonly WINDOW_SIZE = 512
    static readonly CONTEXT_SIZE = 64

    static readonly MIN_SPEECH_SAMPLES = (250 * 16000) / 1000 // 250ms
    static readonly MIN_SILENCE_SAMPLES = (300 * 16000) / 1000 // 300ms (発話区間の切断閾値)
    static readonly SPEECH_PAD_SAMPLES = (100 * 16000) / 1000 // 100ms (前後のパディング)
    static readonly MERGE_GAP_SAMPLES = (500 * 16000) / 1000 // 500ms (区間同士のマージ閾値)
    static readonly SOFT_LIMIT_DURATION_SAMPLES = 20 * 16000 // 20s (ソフトリミット)
    static readonly MAX_SPEECH_SAMPLES = 28 * 16000 // 28s (ハードリミット)

    private normalizer?: StreamingLoudnessNormalizer
    private vadState = new Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128])
    private sr = new Tensor('int64', new BigInt64Array([16000n]), [1])
    private vadContext = new Float32Array(SileroVADSegmenter.CONTEXT_SIZE)
    private vadRemainder = new Float32Array(0)

    private totalSamplesReceived = 0

    // VAD detection state
    private triggered = false
    private tempStart = 0
    private prevEnd = 0
    private currentSpeechSamples = 0

    // Ring buffer of recent audio for slicing
    private bufferHistory: Float32Array[] = []
    private bufferHistoryStartSample = 0
    private bufferHistoryLength = 0

    // Pending segment waiting for potential merge with next interval
    private pendingSegment: {
        startSample: number
        endSample: number
    } | null = null

    private speechIntervalsCount = 0
    private totalSpeechDurationSec = 0

    constructor(
        private readonly vadModel: any,
        private readonly onSegment: AudioSegmentCallback,
        private readonly threshold = 0.5,
        enableNormalizer = false,
    ) {
        if (enableNormalizer) {
            this.normalizer = new StreamingLoudnessNormalizer()
        }
    }

    async feed(rawChunk: Float32Array): Promise<void> {
        if (rawChunk.length === 0) return

        const chunk = this.normalizer ? this.normalizer.process(rawChunk) : rawChunk

        let audio: Float32Array
        if (this.vadRemainder.length > 0) {
            audio = new Float32Array(this.vadRemainder.length + chunk.length)
            audio.set(this.vadRemainder, 0)
            audio.set(chunk, this.vadRemainder.length)
            this.vadRemainder = new Float32Array(0)
        } else {
            audio = chunk
        }

        const {
            WINDOW_SIZE,
            CONTEXT_SIZE,
            MIN_SPEECH_SAMPLES,
            MIN_SILENCE_SAMPLES,
            SPEECH_PAD_SAMPLES,
            MERGE_GAP_SAMPLES,
            MAX_SPEECH_SAMPLES,
        } = SileroVADSegmenter

        let i = 0
        while (i + WINDOW_SIZE <= audio.length) {
            const windowData = audio.subarray(i, i + WINDOW_SIZE)
            const inputWithContext = new Float32Array(CONTEXT_SIZE + WINDOW_SIZE)
            inputWithContext.set(this.vadContext, 0)
            inputWithContext.set(windowData, CONTEXT_SIZE)
            this.vadContext.set(windowData.subarray(WINDOW_SIZE - CONTEXT_SIZE, WINDOW_SIZE))

            const input = new Tensor('float32', inputWithContext, [1, CONTEXT_SIZE + WINDOW_SIZE])
            const out = await this.vadModel({ input, state: this.vadState, sr: this.sr })
            this.vadState = out.stateN
            const prob: number = out.output.data[0]

            const currentSample = this.totalSamplesReceived + i + WINDOW_SIZE

            this.bufferHistory.push(windowData.slice())
            this.bufferHistoryLength += WINDOW_SIZE

            if (prob >= this.threshold) {
                if (!this.triggered) {
                    this.triggered = true
                    this.tempStart = currentSample - WINDOW_SIZE
                }
                this.currentSpeechSamples += WINDOW_SIZE
                this.prevEnd = currentSample

                // ハードリミット (28s 連続発話)
                if (currentSample - this.tempStart >= MAX_SPEECH_SAMPLES) {
                    const startIdx = Math.max(0, this.tempStart - SPEECH_PAD_SAMPLES)
                    const endIdx = currentSample
                    this.handleFinishedInterval(startIdx, endIdx)
                    this.tempStart = currentSample
                    this.currentSpeechSamples = 0
                }
            } else {
                if (this.triggered) {
                    const silenceDuration = currentSample - this.prevEnd
                    if (silenceDuration >= MIN_SILENCE_SAMPLES) {
                        if (this.currentSpeechSamples >= MIN_SPEECH_SAMPLES) {
                            const startIdx = Math.max(0, this.tempStart - SPEECH_PAD_SAMPLES)
                            const endIdx = this.prevEnd + SPEECH_PAD_SAMPLES
                            this.handleFinishedInterval(startIdx, endIdx)
                        }
                        this.triggered = false
                        this.currentSpeechSamples = 0
                    }
                }
            }

            // 保留中セグメントの確定判定 (非発話状態で MERGE_GAP 以上の無音が経過)
            if (this.pendingSegment && !this.triggered) {
                const silencePastEnd = currentSample - this.pendingSegment.endSample
                if (silencePastEnd >= MERGE_GAP_SAMPLES) {
                    this.emitPendingSegment()
                }
            }

            this.pruneBufferHistory(currentSample)

            i += WINDOW_SIZE
        }

        if (i < audio.length) {
            this.vadRemainder = audio.slice(i)
        }

        this.totalSamplesReceived += i
    }

    private handleFinishedInterval(startSample: number, endSample: number): void {
        if (!this.pendingSegment) {
            this.pendingSegment = { startSample, endSample }
        } else {
            const gap = startSample - this.pendingSegment.endSample
            const currentPendingDuration = this.pendingSegment.endSample - this.pendingSegment.startSample
            const mergedDuration = endSample - this.pendingSegment.startSample

            // gap が 500ms 未満で、かつマージ後の長さが MAX_SPEECH_SAMPLES 未満、
            // かつ現在の保留セグメントがソフトリミット（20s）未満であればマージ
            if (
                gap < SileroVADSegmenter.MERGE_GAP_SAMPLES &&
                mergedDuration < SileroVADSegmenter.MAX_SPEECH_SAMPLES &&
                currentPendingDuration < SileroVADSegmenter.SOFT_LIMIT_DURATION_SAMPLES
            ) {
                this.pendingSegment.endSample = endSample
            } else {
                this.emitPendingSegment()
                this.pendingSegment = { startSample, endSample }
            }
        }
    }

    private emitPendingSegment(): void {
        if (!this.pendingSegment) return
        const { startSample, endSample } = this.pendingSegment
        this.pendingSegment = null

        const pcm = this.extractFromBufferHistory(startSample, endSample)
        const start = startSample / SileroVADSegmenter.SAMPLE_RATE
        const end = endSample / SileroVADSegmenter.SAMPLE_RATE

        this.speechIntervalsCount++
        this.totalSpeechDurationSec += end - start
        this.onSegment({ start, end, pcm })
    }

    private extractFromBufferHistory(startSample: number, endSample: number): Float32Array {
        const len = Math.max(0, endSample - startSample)
        const res = new Float32Array(len)
        let resOffset = 0

        let curSample = this.bufferHistoryStartSample
        for (const chunk of this.bufferHistory) {
            const chunkStart = curSample
            const chunkEnd = curSample + chunk.length

            if (chunkEnd > startSample && chunkStart < endSample) {
                const copyStartInChunk = Math.max(0, startSample - chunkStart)
                const copyEndInChunk = Math.min(chunk.length, endSample - chunkStart)
                const toCopy = chunk.subarray(copyStartInChunk, copyEndInChunk)
                res.set(toCopy, resOffset)
                resOffset += toCopy.length
            }

            curSample += chunk.length
        }
        return res
    }

    private pruneBufferHistory(currentSample: number): void {
        let earliestNeeded = currentSample - SileroVADSegmenter.SPEECH_PAD_SAMPLES * 2
        if (this.pendingSegment) {
            earliestNeeded = Math.min(earliestNeeded, this.pendingSegment.startSample)
        }
        if (this.triggered) {
            earliestNeeded = Math.min(
                earliestNeeded,
                Math.max(0, this.tempStart - SileroVADSegmenter.SPEECH_PAD_SAMPLES),
            )
        }

        while (this.bufferHistory.length > 0) {
            const firstChunkLen = this.bufferHistory[0].length
            if (this.bufferHistoryStartSample + firstChunkLen < earliestNeeded) {
                this.bufferHistoryStartSample += firstChunkLen
                this.bufferHistoryLength -= firstChunkLen
                this.bufferHistory.shift()
            } else {
                break
            }
        }
    }

    async finish(): Promise<void> {
        const { MIN_SPEECH_SAMPLES, SPEECH_PAD_SAMPLES } = SileroVADSegmenter
        if (this.triggered && this.currentSpeechSamples >= MIN_SPEECH_SAMPLES) {
            const startIdx = Math.max(0, this.tempStart - SPEECH_PAD_SAMPLES)
            const endIdx = Math.min(this.totalSamplesReceived, this.prevEnd + SPEECH_PAD_SAMPLES)
            this.handleFinishedInterval(startIdx, endIdx)
        }
        this.emitPendingSegment()
        this.triggered = false
        this.currentSpeechSamples = 0
        this.bufferHistory = []
        this.bufferHistoryLength = 0
    }

    getStats(): VadStats {
        const totalDuration = this.totalSamplesReceived / SileroVADSegmenter.SAMPLE_RATE
        const skippedSilenceDuration = Math.max(0, totalDuration - this.totalSpeechDurationSec)
        return {
            totalDuration,
            speechDuration: this.totalSpeechDurationSec,
            skippedSilenceDuration,
            speechSegmentCount: this.speechIntervalsCount,
        }
    }

    getCurrentEvaluatedSec(): number {
        if (this.pendingSegment) {
            return this.pendingSegment.startSample / SileroVADSegmenter.SAMPLE_RATE
        }
        if (this.triggered) {
            return Math.max(0, this.tempStart - SileroVADSegmenter.SPEECH_PAD_SAMPLES) / SileroVADSegmenter.SAMPLE_RATE
        }
        return this.totalSamplesReceived / SileroVADSegmenter.SAMPLE_RATE
    }
}

/**
 * VAD が無効な場合に、固定長（25秒）で音声を切り出すセグメンタ
 */
export class FixedChunkSegmenter implements AudioSegmenter {
    private static readonly SAMPLE_RATE = 16000
    private static readonly MAX_CHUNK_SAMPLES = 25 * 16000 // 25s

    private normalizer?: StreamingLoudnessNormalizer
    private currentChunks: Float32Array[] = []
    private currentSampleCount = 0
    private currentStartSample = 0
    private totalSamplesReceived = 0
    private speechIntervalsCount = 0
    private totalSpeechDurationSec = 0

    constructor(
        private readonly onSegment: AudioSegmentCallback,
        enableNormalizer = false,
    ) {
        if (enableNormalizer) {
            this.normalizer = new StreamingLoudnessNormalizer()
        }
    }

    async feed(rawChunk: Float32Array): Promise<void> {
        if (rawChunk.length === 0) return

        const chunk = this.normalizer ? this.normalizer.process(rawChunk) : rawChunk
        this.currentChunks.push(chunk)
        this.currentSampleCount += chunk.length
        this.totalSamplesReceived += chunk.length

        while (this.currentSampleCount >= FixedChunkSegmenter.MAX_CHUNK_SAMPLES) {
            const merged = mergeFloat32Arrays(this.currentChunks)
            const segmentPcm = merged.slice(0, FixedChunkSegmenter.MAX_CHUNK_SAMPLES)
            const remainder = merged.slice(FixedChunkSegmenter.MAX_CHUNK_SAMPLES)

            const start = this.currentStartSample / FixedChunkSegmenter.SAMPLE_RATE
            const end =
                (this.currentStartSample + FixedChunkSegmenter.MAX_CHUNK_SAMPLES) / FixedChunkSegmenter.SAMPLE_RATE
            this.speechIntervalsCount++
            this.totalSpeechDurationSec += end - start
            this.onSegment({ start, end, pcm: segmentPcm })

            this.currentStartSample += FixedChunkSegmenter.MAX_CHUNK_SAMPLES
            this.currentChunks = remainder.length > 0 ? [remainder] : []
            this.currentSampleCount = remainder.length
        }
    }

    async finish(): Promise<void> {
        if (this.currentSampleCount > 0) {
            const pcm = mergeFloat32Arrays(this.currentChunks, this.currentSampleCount)
            const start = this.currentStartSample / FixedChunkSegmenter.SAMPLE_RATE
            const end = (this.currentStartSample + this.currentSampleCount) / FixedChunkSegmenter.SAMPLE_RATE
            this.speechIntervalsCount++
            this.totalSpeechDurationSec += end - start
            this.onSegment({ start, end, pcm })
            this.currentChunks = []
            this.currentSampleCount = 0
        }
    }

    getStats(): VadStats {
        const totalDuration = this.totalSamplesReceived / FixedChunkSegmenter.SAMPLE_RATE
        return {
            totalDuration,
            speechDuration: this.totalSpeechDurationSec,
            skippedSilenceDuration: 0,
            speechSegmentCount: this.speechIntervalsCount,
        }
    }

    getCurrentEvaluatedSec(): number {
        return this.totalSamplesReceived / FixedChunkSegmenter.SAMPLE_RATE
    }
}
