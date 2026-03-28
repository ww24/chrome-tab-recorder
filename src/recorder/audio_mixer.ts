export interface AudioContextFactory {
    create(sampleRate: number): AudioContext
}

export class SingletonAudioContextFactory implements AudioContextFactory {
    private audioCtx: AudioContext | undefined

    /**
     * Get or create an AudioContext.
     * sampleRate is only applied on the first call when the AudioContext is created.
     * Subsequent calls reuse the existing instance and the sampleRate parameter is ignored.
     */
    create(sampleRate: number): AudioContext {
        if (this.audioCtx == null) {
            this.audioCtx = sampleRate > 0 ? new AudioContext({ sampleRate }) : new AudioContext()
        } else if (sampleRate > 0 && this.audioCtx.sampleRate !== sampleRate) {
            console.warn(`AudioContext already created with sampleRate=${this.audioCtx.sampleRate}, ignoring requested sampleRate=${sampleRate}`)
        }
        return this.audioCtx
    }
}

export class AudioMixer {
    constructor(private readonly audioContextFactory: AudioContextFactory) { }

    /**
     * Mix tab audio and microphone audio streams into a single MediaStream.
     * - If no micStream: returns tabStream (with optional AudioContext resampling).
     * - If micStream provided: mixes tab audio + mic audio (with gain) into a single audio track.
     * Video tracks from tabStream are always preserved.
     */
    mix(tabStream: MediaStream, micStream: MediaStream | null, micGain: number, audioSampleRate: number): MediaStream {
        const audioCtx = this.audioContextFactory.create(audioSampleRate)

        if (!micStream) {
            // No microphone — if custom sample rate is requested, resample via AudioContext
            if (audioSampleRate > 0 && tabStream.getAudioTracks().length > 0) {
                const dest = audioCtx.createMediaStreamDestination()
                const src = audioCtx.createMediaStreamSource(new MediaStream(tabStream.getAudioTracks()))
                src.connect(dest)

                const [tabTrack] = tabStream.getTracks()
                tabTrack?.addEventListener('ended', () => {
                    dest.stream.getAudioTracks().forEach(track => track.stop())
                })

                return new MediaStream([
                    ...dest.stream.getAudioTracks(),
                    ...tabStream.getVideoTracks(),
                ])
            }
            return tabStream
        }

        const mixedOutput = audioCtx.createMediaStreamDestination()

        // Tab audio (if exists)
        const tabAudioTracks = tabStream.getAudioTracks()
        if (tabAudioTracks.length > 0) {
            const tabAudioSource = audioCtx.createMediaStreamSource(new MediaStream(tabAudioTracks))
            tabAudioSource.connect(mixedOutput)
        }

        // Handle source ended event
        const [tabTrack] = tabStream.getTracks()
        tabTrack?.addEventListener('ended', () => {
            mixedOutput.stream.getAudioTracks().forEach(track => track.stop())
        })

        // Microphone audio
        const micAudioSource = audioCtx.createMediaStreamSource(micStream)
        const micGainNode = audioCtx.createGain()
        micGainNode.gain.value = micGain
        micAudioSource.connect(micGainNode)
        micGainNode.connect(mixedOutput)

        // Combine mixed audio with video tracks
        return new MediaStream([
            ...mixedOutput.stream.getAudioTracks(),
            ...tabStream.getVideoTracks(),
        ])
    }

    /**
     * Set up audio playback for the captured tab (non-muted case).
     * Routes the tab audio through the AudioContext to the speakers.
     */
    setupPlayback(tabMedia: MediaStream, audioSampleRate: number): void {
        const playbackCtx = this.audioContextFactory.create(audioSampleRate)
        const source = playbackCtx.createMediaStreamSource(tabMedia)
        source.connect(playbackCtx.destination)
    }
}
