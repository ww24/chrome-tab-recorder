import type { Output } from 'mediabunny'
import type { VideoFormat } from '../configuration'
import { audioSeparationContainer, containerExtension, Configuration } from '../configuration'
import type { FileManager } from './file_manager'
import type { OutputManager, PausableSource } from './output_manager'

export interface AudioSeparationOutputs {
    tabOutput?: Output
    micOutput?: Output
    /** All pausable sources across separation outputs */
    sources: PausableSource[]
    /** Cloned media tracks that must be stopped on cleanup */
    clonedTracks: MediaStreamTrack[]
    /** Error promises from audio track sources (for logging, non-fatal) */
    errorPromises: Promise<void>[]
}

export class AudioSeparationManager {
    constructor(
        private readonly fileManager: FileManager,
        private readonly outputManager: OutputManager,
    ) { }

    /**
     * Create separated audio output files for tab and/or microphone streams.
     * Returns outputs that need to be started, finalized, and cancelled independently.
     */
    async createOutputs(
        startAtMs: number,
        tabMedia: MediaStream,
        micStream: MediaStream | null,
        { recordingMode, audioCodec, audioBitratePreset, audioBitrate }: VideoFormat,
    ): Promise<AudioSeparationOutputs> {
        const result: AudioSeparationOutputs = {
            sources: [],
            clonedTracks: [],
            errorPromises: [],
        }

        const sepContainer = audioSeparationContainer(audioCodec)
        const sepExt = containerExtension(sepContainer)

        // Tab audio separation: when recordingMode is video-and-audio or audio-only with mic
        if (recordingMode === 'video-and-audio' || (recordingMode === 'audio-only' && micStream)) {
            const tabAudioTrack = tabMedia.getAudioTracks()[0]?.clone() as MediaStreamAudioTrack | undefined
            if (tabAudioTrack) {
                const tabFileName = Configuration.audioFilename(startAtMs, 'tab', sepExt)
                const tabFileHandle = await this.fileManager.createAudioFile(tabFileName)
                const writableStream = await tabFileHandle.createWritable()
                const handle = this.outputManager.createAudioTrackOutput(
                    writableStream,
                    tabAudioTrack,
                    sepContainer,
                    audioCodec,
                    audioBitratePreset,
                    audioBitrate,
                )
                result.tabOutput = handle.output
                result.sources.push(...handle.sources)
                result.clonedTracks.push(tabAudioTrack)
                result.errorPromises.push(...handle.errorPromises)
            }
        }

        // Mic audio separation: when mic stream is available
        if (micStream) {
            const micAudioTrack = micStream.getAudioTracks()[0]?.clone() as MediaStreamAudioTrack | undefined
            if (micAudioTrack) {
                const micFileName = Configuration.audioFilename(startAtMs, 'mic', sepExt)
                const micFileHandle = await this.fileManager.createAudioFile(micFileName)
                const writableStream = await micFileHandle.createWritable()
                const handle = this.outputManager.createAudioTrackOutput(
                    writableStream,
                    micAudioTrack,
                    sepContainer,
                    audioCodec,
                    audioBitratePreset,
                    audioBitrate,
                )
                result.micOutput = handle.output
                result.sources.push(...handle.sources)
                result.clonedTracks.push(micAudioTrack)
                result.errorPromises.push(...handle.errorPromises)
            }
        }

        return result
    }

    /**
     * Finalize all separation outputs.
     * All outputs are attempted even if one fails. Throws if any fail.
     */
    async finalizeAll(outputs: AudioSeparationOutputs): Promise<void> {
        const results = await Promise.allSettled([
            outputs.tabOutput?.finalize(),
            outputs.micOutput?.finalize(),
        ])
        const errors = results
            .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
            .map(r => r.reason instanceof Error ? r.reason : new Error(String(r.reason)))
        if (errors.length > 0) {
            throw new AggregateError(errors, 'Failed to finalize audio separation')
        }
    }

    /**
     * Cancel all separation outputs.
     * All outputs are attempted even if one fails. Throws if any fail.
     */
    async cancelAll(outputs: AudioSeparationOutputs): Promise<void> {
        const results = await Promise.allSettled([
            outputs.tabOutput?.cancel(),
            outputs.micOutput?.cancel(),
        ])
        const errors = results
            .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
            .map(r => r.reason instanceof Error ? r.reason : new Error(String(r.reason)))
        if (errors.length > 0) {
            throw new AggregateError(errors, 'Failed to cancel audio separation')
        }
    }
}
