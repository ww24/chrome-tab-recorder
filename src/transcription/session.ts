/* eslint-disable unicorn/require-post-message-target-origin */
import { ALL_FORMATS, BlobSource, Input, Conversion, BufferTarget, WavOutputFormat, Output } from 'mediabunny'
import type { TranscriptionResult, WorkerInMessage, WorkerOutMessage } from './types'
import { wavToFloat32Array } from './utils'
import { WHISPER_MODEL_REPO } from './model_files'
import type { Event } from '../sentry_event'
import type { Message } from '../message'

export interface TranscriptionSessionDeps {
    getVideoFile(path: string): Promise<Blob>
    saveTranscription(path: string, result: TranscriptionResult): Promise<void>
    sendEvent(event: Event): void
    broadcastMessage(message: Message): Promise<unknown>
    createWorker(): Worker
    getLanguage?(): Promise<string>
}

/**
 * Manages audio extraction and transcription execution in the background.
 */
export class TranscriptionSession {
    private readonly activeTasks = new Set<string>()

    constructor(private readonly deps: TranscriptionSessionDeps) {}

    isTranscribing(path: string): boolean {
        return this.activeTasks.has(path)
    }

    hasActiveTasks(): boolean {
        return this.activeTasks.size > 0
    }

    async transcribe(path: string, options?: { language?: string }): Promise<void> {
        if (this.activeTasks.has(path)) {
            console.warn(`Transcription already in progress for: ${path}`)
            return
        }

        this.activeTasks.add(path)
        const totalStart = performance.now()
        let worker: Worker | null = null

        try {
            // 1. Audio extraction via Mediabunny
            const tAudioStart = performance.now()
            const videoBlob = await this.deps.getVideoFile(path)

            using input = new Input({
                formats: ALL_FORMATS,
                source: new BlobSource(videoBlob),
            })

            const readable = await input.canRead()
            if (!readable) {
                throw new Error('Video format is unsupported or file is corrupted')
            }

            const target = new BufferTarget()
            const output = new Output({
                format: new WavOutputFormat(),
                target,
            })

            const conversion = await Conversion.init({
                input,
                output,
                tracks: 'primary',
                video: { discard: true },
                audio: {
                    numberOfChannels: 1,
                    sampleRate: 16000,
                    codec: 'pcm-f32',
                },
                showWarnings: false,
            })

            if (!conversion.isValid) {
                const reasons = conversion.discardedTracks.map(t => t.reason).join(', ')
                throw new Error(`Failed to initialize audio conversion: ${reasons}`)
            }

            await conversion.execute()

            const buffer = target.buffer
            if (!buffer) {
                throw new Error('Failed to extract audio buffer')
            }

            const float32Audio = wavToFloat32Array(buffer)
            const audioConversionMs = Math.round(performance.now() - tAudioStart)
            const videoDurationSec = float32Audio.length / 16000

            // 2. Initialize Worker
            const tModelStart = performance.now()
            worker = this.deps.createWorker()

            const language = options?.language ?? (await this.deps.getLanguage?.()) ?? 'english'
            const modelId = WHISPER_MODEL_REPO

            await new Promise<void>((resolve, reject) => {
                if (!worker) return reject(new Error('Worker not created'))

                const handleInit = (e: MessageEvent<WorkerOutMessage>) => {
                    const data = e.data
                    if (data.type === 'ready') {
                        worker?.removeEventListener('message', handleInit)
                        resolve()
                    } else if (data.type === 'download_progress') {
                        this.deps
                            .broadcastMessage({
                                type: 'transcription-progress',
                                path,
                                stage: 'model_load',
                                loaded: data.loaded,
                                total: data.total,
                            })
                            .catch(() => {})
                    } else if (data.type === 'error') {
                        worker?.removeEventListener('message', handleInit)
                        reject(new Error(data.message))
                    }
                }

                worker.addEventListener('message', handleInit)
                worker.addEventListener(
                    'error',
                    err => {
                        reject(new Error(err.message || 'Transcription worker initialization failed'))
                    },
                    { once: true },
                )

                const initMsg: WorkerInMessage = {
                    type: 'init',
                    modelId,
                    language,
                }
                worker.postMessage(initMsg)
            })

            const modelLoadMs = Math.round(performance.now() - tModelStart)

            // 3. Execute transcription
            const resultMsg = await new Promise<Extract<WorkerOutMessage, { type: 'result' }>>((resolve, reject) => {
                if (!worker) return reject(new Error('Worker not created'))

                const handleMessage = (e: MessageEvent<WorkerOutMessage>) => {
                    const data = e.data
                    if (data.type === 'transcribe_progress') {
                        this.deps
                            .broadcastMessage({
                                type: 'transcription-progress',
                                path,
                                stage: data.stage,
                                loaded: Math.round(data.progress * 100),
                                total: 100,
                            })
                            .catch(() => {})
                    } else if (data.type === 'result') {
                        worker?.removeEventListener('message', handleMessage)
                        resolve(data)
                    } else if (data.type === 'error') {
                        worker?.removeEventListener('message', handleMessage)
                        reject(new Error(data.message))
                    }
                }

                worker.addEventListener('message', handleMessage)
                worker.addEventListener(
                    'error',
                    err => {
                        reject(err)
                    },
                    { once: true },
                )

                const transcribeMsg: WorkerInMessage = {
                    type: 'transcribe',
                    audio: float32Audio,
                }
                // Transfer the audio buffer to worker
                worker.postMessage(transcribeMsg, [float32Audio.buffer])
            })

            // 4. Save result to IndexedDB
            const transcriptionResult: TranscriptionResult = {
                segments: resultMsg.segments,
                transcribedAt: Date.now(),
                modelId,
                language,
            }

            await this.deps.saveTranscription(path, transcriptionResult)
            const totalMs = Math.round(performance.now() - totalStart)

            // 5. Send Sentry metrics
            this.deps.sendEvent({
                type: 'transcription_complete',
                metrics: {
                    videoDurationSec,
                    audioConversionMs,
                    modelLoadMs,
                    loudnessNormMs: resultMsg.timings.loudnessNormMs,
                    vadMs: resultMsg.timings.vadMs,
                    inferenceMs: resultMsg.timings.inferenceMs,
                    totalMs,
                    modelId,
                    language,
                    segmentCount: resultMsg.segments.length,
                },
            })

            // 6. Broadcast completion notification
            await this.deps.broadcastMessage({
                type: 'transcription-complete',
                path,
            })
        } catch (e) {
            const errorMsg = e instanceof Error ? e.message : String(e)
            console.error(`Transcription failed for ${path}:`, e)
            await this.deps.broadcastMessage({
                type: 'transcription-error',
                path,
                error: errorMsg,
            })
            throw e
        } finally {
            this.activeTasks.delete(path)
            // Immediately terminate worker to free all GPU and RAM memory
            if (worker) {
                try {
                    worker.terminate()
                } catch (termErr) {
                    console.warn('Error terminating worker:', termErr)
                }
            }
        }
    }
}
