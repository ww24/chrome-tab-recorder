export { AudioMixer, SingletonAudioContextFactory } from './audio_mixer'
export type { AudioContextFactory } from './audio_mixer'
export { MediaCapture } from './media_capture'
export type { MediaDevicesProvider } from './media_capture'
export { OutputManager } from './output_manager'
export type { OutputHandle, PausableSource } from './output_manager'
export { AudioSeparationManager } from './audio_separation'
export type { AudioSeparationOutputs } from './audio_separation'
export { FileManager } from './file_manager'
export { RecordingSession } from './recorder'
export type { RecorderState, RecordingConfig, RecordingResult, RecorderCallbacks } from './recorder'

import { AudioMixer, SingletonAudioContextFactory } from './audio_mixer'
import { MediaCapture } from './media_capture'
import { OutputManager } from './output_manager'
import { AudioSeparationManager } from './audio_separation'
import { FileManager } from './file_manager'
import { RecordingSession } from './recorder'
import type { RecorderCallbacks } from './recorder'
import type { Preview } from '../preview'
import type { Crop } from '../crop'

/**
 * Wire up all real implementations and create a RecordingSession.
 */
export function createRecordingSession(preview: Preview, crop: Crop, callbacks: RecorderCallbacks): RecordingSession {
    const audioContextFactory = new SingletonAudioContextFactory()
    const audioMixer = new AudioMixer(audioContextFactory)
    const mediaCapture = new MediaCapture(navigator.mediaDevices)
    const outputManager = new OutputManager()
    const fileManager = new FileManager()
    const audioSeparation = new AudioSeparationManager(fileManager, outputManager)

    return new RecordingSession(
        mediaCapture,
        audioMixer,
        outputManager,
        audioSeparation,
        fileManager,
        preview,
        crop,
        callbacks,
    )
}
