import type { Configuration, RecordingInfo, Resolution, CropRegion } from './configuration'
import type {
    Message,
    StartRecording,
    StartRecordingResponse,
    StartTrigger,
    Trigger,
    TimerExpiredMessage,
    TimerUpdatedMessage,
} from './message'
import type { RecordingConfig, RecordingResult } from './recorder'
import type { Event, ExceptionMetadata } from './sentry_event'

// ---------- dependency interfaces ----------

export interface OffscreenSession {
    start(request: StartRecording, config: RecordingConfig): Promise<StartRecordingResponse>
    stop(): Promise<RecordingResult | null>
    cancel(): Promise<number>
    pause(): void
    resume(): void
    readonly isPaused: boolean
    readonly elapsedPausedMs: number
    startPreview(): void
    stopPreview(): void
    updateCropRegion(region: CropRegion): void
}

export interface OffscreenDeps {
    getRecordingInfo(tabSize: Resolution): RecordingInfo
    getConfiguration(): Configuration
    mergeRemoteConfiguration(remote: Configuration): void
    session: OffscreenSession
    checkStoragePersisted(): Promise<boolean>
    sendEvent(e: Event): void
    sendException(e: unknown, meta: ExceptionMetadata): void
    flush(): Promise<void>
    sendRuntimeMessage(msg: Message): Promise<unknown>
    getLocationHash(): string
    setLocationHash(hash: string): void
}

// ---------- result type ----------

export interface HandleOffscreenMessageResult {
    response?: StartRecordingResponse
}

// ---------- handler ----------

export class OffscreenHandler {
    private timerTimeoutId: ReturnType<typeof setTimeout> | null = null
    private timerStopAtMs: number | null = null
    private timerRemainingMs: number | null = null

    constructor(private readonly deps: OffscreenDeps) { }

    handleMessage(message: Message): Promise<HandleOffscreenMessageResult> | null {
        switch (message.type) {
            case 'start-recording':
                return this.handleStartRecording(message.data, message.trigger)
            case 'stop-recording':
                return this.handleStopRecording(message.trigger)
            case 'pause-recording':
                return this.handlePauseRecording()
            case 'resume-recording':
                return this.handleResumeRecording()
            case 'cancel-recording':
                return this.handleCancelRecording()
            case 'save-config-local':
                return this.handleSaveConfigLocal(message.data)
            case 'update-recording-timer':
                return this.handleUpdateRecordingTimer(message.enabled, message.durationMinutes)
            case 'exception':
                return Promise.reject(message.data)
            case 'preview-control':
                return this.handlePreviewControl(message.action)
            case 'update-crop-region':
                return this.handleUpdateCropRegion(message.region)
        }
        return null
    }

    private async handleStartRecording(
        data: StartRecording,
        trigger: StartTrigger,
    ): Promise<HandleOffscreenMessageResult> {
        const { videoFormat, recordingSize } = this.deps.getRecordingInfo(data.tabSize)
        const config = this.deps.getConfiguration()

        const opfsPersisted = await this.deps.checkStoragePersisted()
        if (!opfsPersisted) {
            console.warn('OPFS persist: permission denied')
        }
        this.deps.sendEvent({
            type: 'start_recording',
            tags: {
                trigger,
                state: { opfsPersisted },
            },
        })

        const response = await this.deps.session.start(data, {
            videoFormat,
            recordingSize,
            microphone: config.microphone,
            cropping: config.cropping,
            muteRecordingTab: config.muteRecordingTab,
            audioSeparation: config.audioSeparation,
        })

        if (config.recordingTimer.enabled && config.recordingTimer.durationMinutes > 0) {
            this.setRecordingTimer(config.recordingTimer.durationMinutes)
            response.stopAtMs = this.timerStopAtMs ?? undefined
        }

        this.deps.setLocationHash('recording')
        return { response }
    }

    private async handleStopRecording(trigger: Trigger): Promise<HandleOffscreenMessageResult> {
        try {
            const result = await this.deps.session.stop()
            if (result) {
                this.deps.sendEvent({
                    type: 'stop_recording',
                    metrics: {
                        trigger,
                        recording: {
                            durationSec: result.durationMs / 1000,
                            filesize: result.fileSize,
                        },
                    },
                })
            }
        } catch (e) {
            console.error(e)
            this.deps.sendException(e, { exceptionSource: 'offscreen.stopRecording' })
        } finally {
            this.clearRecordingTimer()
            this.deps.setLocationHash('')
        }
        await this.deps.flush()
        return {}
    }

    private async handleCancelRecording(): Promise<HandleOffscreenMessageResult> {
        try {
            const durationMs = await this.deps.session.cancel()
            this.deps.sendEvent({
                type: 'unexpected_stop',
                metrics: {
                    recording: {
                        durationSec: durationMs / 1000,
                    },
                },
            })
        } catch (e) {
            console.error(e)
            this.deps.sendException(e, { exceptionSource: 'offscreen.cancelRecording' })
        } finally {
            this.clearRecordingTimer()
            this.deps.setLocationHash('')
        }
        await this.deps.flush()
        return {}
    }

    private async handlePreviewControl(action: 'start' | 'stop'): Promise<HandleOffscreenMessageResult> {
        if (action === 'start') {
            this.deps.session.startPreview()
        } else {
            this.deps.session.stopPreview()
        }
        return {}
    }

    private async handleUpdateCropRegion(region: CropRegion): Promise<HandleOffscreenMessageResult> {
        this.deps.session.updateCropRegion(region)
        return {}
    }

    private async handlePauseRecording(): Promise<HandleOffscreenMessageResult> {
        this.deps.session.pause()
        this.pauseRecordingTimer()
        return {}
    }

    private async handleResumeRecording(): Promise<HandleOffscreenMessageResult> {
        this.deps.session.resume()
        await this.resumeRecordingTimer()
        return {}
    }

    private async handleSaveConfigLocal(data: Configuration): Promise<HandleOffscreenMessageResult> {
        this.deps.mergeRemoteConfiguration(data)
        await this.deps.flush()
        return {}
    }

    private async handleUpdateRecordingTimer(
        enabled: boolean,
        durationMinutes: number,
    ): Promise<HandleOffscreenMessageResult> {
        if (this.deps.getLocationHash() !== '#recording') return {}
        if (enabled && durationMinutes > 0) {
            this.setRecordingTimer(durationMinutes)
        } else {
            this.clearRecordingTimer()
        }
        await this.sendTimerUpdated()
        return {}
    }

    // ---------- timer helpers ----------

    private setRecordingTimer(durationMinutes: number): void {
        this.clearRecordingTimer()
        const durationMs = durationMinutes * 60 * 1000
        this.timerStopAtMs = Date.now() + durationMs
        this.timerTimeoutId = setTimeout(async () => {
            this.timerTimeoutId = null
            this.timerStopAtMs = null
            try {
                const msg: TimerExpiredMessage = { type: 'timer-expired' }
                await this.deps.sendRuntimeMessage(msg)
            } catch (e) {
                console.error('Failed to send timer-expired message:', e)
            }
        }, durationMs)
    }

    private clearRecordingTimer(): void {
        if (this.timerTimeoutId != null) {
            clearTimeout(this.timerTimeoutId)
            this.timerTimeoutId = null
        }
        this.timerStopAtMs = null
        this.timerRemainingMs = null
    }

    private pauseRecordingTimer(): void {
        if (this.timerTimeoutId == null || this.timerStopAtMs == null) return
        this.timerRemainingMs = Math.max(0, this.timerStopAtMs - Date.now())
        clearTimeout(this.timerTimeoutId)
        this.timerTimeoutId = null
        this.timerStopAtMs = null
        // Don't send timer-updated here: the stale stopAtMs in the service worker state
        // is used to display "timer paused" with remaining time while recording is paused.
        // On resume, resumeRecordingTimer() sends the updated stopAtMs.
    }

    private async resumeRecordingTimer(): Promise<void> {
        if (this.timerRemainingMs == null) return
        const remainingMs = this.timerRemainingMs
        this.timerRemainingMs = null
        this.timerStopAtMs = Date.now() + remainingMs
        this.timerTimeoutId = setTimeout(async () => {
            this.timerTimeoutId = null
            this.timerStopAtMs = null
            try {
                const msg: TimerExpiredMessage = { type: 'timer-expired' }
                await this.deps.sendRuntimeMessage(msg)
            } catch (e) {
                console.error('Failed to send timer-expired message:', e)
            }
        }, remainingMs)
        await this.sendTimerUpdated()
    }

    private async sendTimerUpdated(): Promise<void> {
        const msg: TimerUpdatedMessage = { type: 'timer-updated', stopAtMs: this.timerStopAtMs }
        try {
            await this.deps.sendRuntimeMessage(msg)
        } catch (e) {
            console.error('Failed to send timer-updated message:', e)
        }
    }
}
