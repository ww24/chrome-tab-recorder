import { html, css, LitElement } from 'lit'
import { live } from 'lit/directives/live.js'
import { customElement, property } from 'lit/decorators.js'
import '@material/web/icon/icon'
import '@material/web/button/filled-tonal-button'
import '@material/web/switch/switch'
import '@material/web/select/filled-select'
import '@material/web/select/select-option'
import '@material/web/slider/slider'
import { MdFilledSelect } from '@material/web/select/filled-select'
import { MdFilledTextField } from '@material/web/textfield/filled-text-field'
import { MdSwitch } from '@material/web/switch/switch'
import { MdSlider } from '@material/web/slider/slider'
import { MdDialog } from '@material/web/dialog/dialog'
import type { ResizeWindowMessage, SaveConfigSyncMessage } from '../message'
import { Configuration, Resolution, RecordingInfo, isVideoRecordingMode, isContainerFormat, isVideoCodec, isAudioCodec, containerCodecs, migrateFromMimeType, ALL_VIDEO_CODECS, ALL_AUDIO_CODECS } from '../configuration'
import type { ContainerFormat, VideoCodecType, AudioCodecType } from '../configuration'
import { WebLocalStorage } from '../storage'
import type { FetchConfigMessage } from '../message'
import { deepMerge, formatNum } from './util'
import Alert from './alert'

@customElement('extension-settings')
export class Settings extends LitElement {
    private static readonly storage = new WebLocalStorage()

    public static getConfiguration(): Configuration {
        const defaultConfig = new Configuration()
        const stored = Settings.storage.get(Configuration.key) as Configuration & { videoFormat?: { mimeType?: string } }
        const config = deepMerge(defaultConfig, stored)
        // Migrate legacy mimeType string to container/codec fields
        if (stored?.videoFormat && 'mimeType' in stored.videoFormat && stored.videoFormat.mimeType && !stored.videoFormat.container) {
            const migrated = migrateFromMimeType(stored.videoFormat.mimeType as string)
            config.videoFormat.container = migrated.container
            config.videoFormat.videoCodec = migrated.videoCodec
            config.videoFormat.audioCodec = migrated.audioCodec
            // Remove legacy field and persist
            delete (config.videoFormat as unknown as Record<string, unknown>)['mimeType']
            Settings.setConfiguration(config)
        }
        return config
    }

    public static readonly CONFIG_CHANGED_EVENT = 'extension-config-changed'

    public static setConfiguration(config: Configuration) {
        config.updatedAt = Date.now()
        Settings.storage.set(Configuration.key, config)
        // Dispatch custom event to notify other components about configuration change
        window.dispatchEvent(new CustomEvent(Settings.CONFIG_CHANGED_EVENT, { detail: config }))
    }

    public static mergeRemoteConfiguration(remote: Configuration) {
        const local = Settings.getConfiguration()
        // deepMerge preserves local.cropping since filterForSync excludes it from remote
        const config = deepMerge(local, Configuration.filterForSync(remote))
        Settings.setConfiguration(config)
    }

    public static async syncConfiguration(config: Configuration) {
        const msg: SaveConfigSyncMessage = {
            type: 'save-config-sync',
            data: Configuration.filterForSync(config),
        }
        await chrome.runtime.sendMessage(msg)
    }

    public static getRecordingInfo(base: Resolution): RecordingInfo {
        const config = Settings.getConfiguration()
        const recordingSize = Configuration.screenRecordingSize(config.screenRecordingSize, base)
        const videoFormat = Configuration.videoFormat(config.videoFormat, recordingSize)
        return { videoFormat, recordingSize }
    }

    static readonly styles = css`
    md-filled-tonal-button {
        height: 56px;
    }
    md-filled-tonal-button, md-filled-text-field, md-switch {
        margin-bottom: 1em;
    }
    .video-format-input {
        width: 280px;
    }
    .codec-select {
        width: 280px;
        margin-bottom: 1em;
    }
    `

    @property({ noAccessor: true })
    private config: Configuration

    @property()
    private microphonePermissionGranted: boolean = false

    @property()
    private availableMicrophones: MediaDeviceInfo[] = []

    public constructor() {
        super()
        this.config = Settings.getConfiguration()
        this.updateMicPermission()
    }

    public render() {
        return html`
        <h2>Window Size</h2>
        <md-filled-text-field label="width" type="number" suffix-text="px" .value=${live(this.config.windowSize.width)} @input=${this.updateProp('windowSize', 'width')}></md-filled-text-field>
        <md-filled-text-field label="height" type="number" suffix-text="px" .value=${live(this.config.windowSize.height)} @input=${this.updateProp('windowSize', 'height')}></md-filled-text-field>
        <md-filled-tonal-button @click=${this.resizeWindow}>
            Resize
            <md-icon slot="icon">resize</md-icon>
        </md-filled-tonal-button>
        <h2>Screen Recording Size</h2>
        <div>
            <label style="line-height: 32px; font-size: 1.5em">
                Auto (Use tab size if available)
                <md-switch ?disabled=${live(this.config.videoFormat.recordingMode === 'audio-only')} ?selected=${live(this.config.screenRecordingSize.auto)} @input=${this.updateProp('screenRecordingSize', 'auto')}></md-switch>
            </label>
        </div>
        <md-filled-text-field label="width" type="number" suffix-text="px" ?disabled=${live(this.config.screenRecordingSize.auto || this.config.videoFormat.recordingMode === 'audio-only')} .value=${live(this.config.screenRecordingSize.width)} @input=${this.updateProp('screenRecordingSize', 'width')}></md-filled-text-field>
        <md-filled-text-field label="height" type="number" suffix-text="px" ?disabled=${live(this.config.screenRecordingSize.auto || this.config.videoFormat.recordingMode === 'audio-only')} .value=${live(this.config.screenRecordingSize.height)} @input=${this.updateProp('screenRecordingSize', 'height')}></md-filled-text-field>
        <md-filled-text-field label="recording scale" type="number" min="1" suffix-text="x" ?disabled=${live(!this.config.screenRecordingSize.auto || this.config.videoFormat.recordingMode === 'audio-only')} .value=${live(this.config.screenRecordingSize.scale)} @input=${this.updateProp('screenRecordingSize', 'scale')}></md-filled-text-field>
        <h2>Video Format</h2>
        <md-filled-text-field class="video-format-input" label="audio bitrate" type="number" min="1" suffix-text="Kbps" ?disabled=${live(this.config.videoFormat.recordingMode === 'video-only')} .value=${live(this.config.videoFormat.audioBitrate / 1024)} @input=${this.updateProp('videoFormat', 'audioBitrate')}></md-filled-text-field>
        <md-filled-text-field class="video-format-input" label="video bitrate" type="number" min="0" step="0.1" supporting-text="0 means auto (number of pixels * 8 bps)" suffix-text="Mbps" ?disabled=${live(this.config.videoFormat.recordingMode === 'audio-only')} .value=${live(this.config.videoFormat.videoBitrate / 1024 / 1024)} @input=${this.updateProp('videoFormat', 'videoBitrate')}></md-filled-text-field>
        <md-filled-text-field class="video-format-input" label="frame rate" type="number" min="1" step="0.001" supporting-text="(experimental parameter)" suffix-text="fps" ?disabled=${live(this.config.videoFormat.recordingMode === 'audio-only')} .value=${live(this.config.videoFormat.frameRate)} @input=${this.updateProp('videoFormat', 'frameRate')}></md-filled-text-field>
        <md-filled-select class="codec-select" label="container" .value=${live(this.config.videoFormat.container)} @input=${this.updateProp('videoFormat', 'container')}>
            <md-select-option value="webm">
                <div slot="headline">WebM</div>
            </md-select-option>
            <md-select-option value="mp4">
                <div slot="headline">MP4</div>
            </md-select-option>
        </md-filled-select>
        <md-filled-select class="codec-select" label="video codec" .value=${live(this.config.videoFormat.videoCodec)} ?disabled=${live(this.config.videoFormat.recordingMode === 'audio-only')} @input=${this.updateProp('videoFormat', 'videoCodec')}>
            ${ALL_VIDEO_CODECS.map(c => html`
                <md-select-option value=${c} ?disabled=${!this.availableVideoCodecs.includes(c)}>
                    <div slot="headline">${this.codecDisplayName(c)}</div>
                </md-select-option>
            `)}
        </md-filled-select>
        <md-filled-select class="codec-select" label="audio codec" .value=${live(this.config.videoFormat.audioCodec)} ?disabled=${live(this.config.videoFormat.recordingMode === 'video-only')} @input=${this.updateProp('videoFormat', 'audioCodec')}>
            ${ALL_AUDIO_CODECS.map(c => html`
                <md-select-option value=${c} ?disabled=${!this.availableAudioCodecs.includes(c)}>
                    <div slot="headline">${this.codecDisplayName(c)}</div>
                </md-select-option>
            `)}
        </md-filled-select>
        <md-filled-select label="recording mode" .value=${live(this.config.videoFormat.recordingMode)} @input=${this.updateProp('videoFormat', 'recordingMode')}>
            <md-select-option value="video-and-audio">
                <div slot="headline">Video and Audio</div>
            </md-select-option>
            <md-select-option value="video-only">
                <div slot="headline">Video only</div>
            </md-select-option>
            <md-select-option value="audio-only">
                <div slot="headline">Audio only</div>
            </md-select-option>
        </md-filled-select>
        <h2>Microphone</h2>
        <div>
            <label style="line-height: 32px; font-size: 1.5em">
                Enable microphone recording
                <md-switch ?selected=${live(this.config.microphone.enabled ?? false)} @input=${this.updateProp('microphone', 'enabled')}></md-switch>
            </label>
        </div>
        ${this.config.microphone.enabled ? html`
        <div style="margin-bottom: 8px; font-size: 1.2em; color: ${this.microphonePermissionGranted ? '#4caf50' : '#f44336'};">
            Status: ${this.microphonePermissionGranted ? 'Permission granted' : 'Permission required'}
        </div>
        ${this.availableMicrophones.length > 0 ? html`
        <div>
            <label for="mic-device" style="font-size: 1.2em; display: block; margin-bottom: 8px;">
                Microphone device:
            </label>
            <md-filled-select 
                id="mic-device"
                .value=${this.config.microphone.deviceId ?? 'default'}
                @input=${this.updateProp('microphone', 'deviceId')}>
                <md-select-option value="default">
                    <div slot="headline">Default device</div>
                </md-select-option>
                ${this.availableMicrophones.map(device => html`
                    <md-select-option value=${device.deviceId}>
                        <div slot="headline">${device.label ?? `Microphone ${device.deviceId.slice(0, 8)}...`}</div>
                    </md-select-option>
                `)}
            </md-filled-select>
        </div>
        ` : ''}
        <div>
            <label for="mic-gain" style="font-size: 1.2em; display: block; margin-bottom: 8px;">
                Microphone volume: x${formatNum(this.config.microphone.gain, 1)}
            </label>
            <md-slider id="mic-gain" min="0" max="10" step="0.1" .value=${live(this.config.microphone.gain)} @input=${this.updateProp('microphone', 'gain')}></md-slider>
        </div>
        ` : ''}
        <h2>Option</h2>
        <div>
            <label style="line-height: 32px; font-size: 1.5em">
                Open the option page after recording
                <md-switch ?selected=${live(this.config.openOptionPage)} @input=${this.updateProp('openOptionPage')}></md-switch>
            </label>
        </div>
        <div>
            <label style="line-height: 32px; font-size: 1.5em" title="If you want to focus on another task while recording.">
                Mute recording Tab
                <md-switch ?selected=${live(this.config.muteRecordingTab)} @input=${this.updateProp('muteRecordingTab')}></md-switch>
            </label>
        </div>
        <h2>Sync</h2>
        <md-filled-tonal-button @click=${this.sync}>
            Fetch Synced Settings
            <md-icon slot="icon">sync</md-icon>
        </md-filled-tonal-button>
        <md-filled-tonal-button @click=${this.restore}>
            Restore Default Settings
            <md-icon slot="icon">restore</md-icon>
        </md-filled-tonal-button>
        `
    }

    private async resizeWindow() {
        const width = this.config.windowSize.width + (window.outerWidth - window.innerWidth)
        const height = this.config.windowSize.height + (window.outerHeight - window.innerHeight)
        const msg: ResizeWindowMessage = {
            type: 'resize-window',
            data: { width, height },
        }
        await chrome.runtime.sendMessage(msg)
    }
    private updateProp(key1: keyof Configuration, key2?: string) {
        return async (e: Event) => {
            const oldVal = { ...this.config }

            switch (key1) {
                case 'windowSize':
                    if (!(e.target instanceof MdFilledTextField) || key2 == null || (key2 != 'width' && key2 != 'height')) return
                    this.config[key1][key2] = Number.parseInt(e.target.value, 10)
                    break
                case 'screenRecordingSize':
                    if (key2 == null) return
                    switch (key2) {
                        case 'width':
                        case 'height':
                        case 'scale':
                            if (!(e.target instanceof MdFilledTextField)) return
                            this.config[key1][key2] = Number.parseInt(e.target.value, 10)
                            break
                        case 'auto':
                            if (!(e.target instanceof MdSwitch)) return
                            this.config[key1][key2] = e.target.selected
                            break
                    }
                    break
                case 'videoFormat':
                    if (!(e.target instanceof MdFilledTextField || e.target instanceof MdFilledSelect) || key2 == null) return
                    switch (key2) {
                        case 'audioBitrate':
                            this.config[key1][key2] = Number.parseInt(e.target.value, 10) * 1024
                            break
                        case 'videoBitrate':
                            this.config[key1][key2] = Number.parseFloat(e.target.value) * 1024 * 1024
                            break
                        case 'frameRate':
                            this.config[key1][key2] = Number.parseFloat(e.target.value)
                            break
                        case 'container':
                            if (!isContainerFormat(e.target.value)) return
                            this.config[key1][key2] = e.target.value
                            // Ensure current codecs are valid for the new container
                            this.ensureValidCodecs(e.target.value)
                            break
                        case 'videoCodec':
                            if (!isVideoCodec(e.target.value)) return
                            this.config[key1][key2] = e.target.value
                            break
                        case 'audioCodec':
                            if (!isAudioCodec(e.target.value)) return
                            this.config[key1][key2] = e.target.value
                            break
                        case 'recordingMode':
                            if (!isVideoRecordingMode(e.target.value)) return
                            this.config[key1][key2] = e.target.value
                            break
                    }
                    break
                case 'microphone':
                    if (key2 == null) return
                    switch (key2) {
                        case 'enabled':
                            if (!(e.target instanceof MdSwitch)) return
                            this.config[key1][key2] = e.target.selected
                            // Auto-test microphone permission when enabled
                            if (e.target.selected) {
                                this.testMicrophonePermission()
                            }
                            break
                        case 'gain':
                            if (!(e.target instanceof MdSlider)) return
                            this.config[key1][key2] = e.target.value ?? 0
                            break
                        case 'deviceId':
                            if (!(e.target instanceof MdFilledSelect)) return
                            this.config[key1][key2] = e.target.value === 'default' ? null : e.target.value
                            break
                    }
                    break
                case 'enableBugTracking':
                case 'openOptionPage':
                case 'muteRecordingTab':
                    if (!(e.target instanceof MdSwitch)) return
                    this.config[key1] = e.target.selected
                    break
            }

            this.requestUpdate('config', oldVal)
            Settings.setConfiguration(this.config)
            await Settings.syncConfiguration(this.config)
        }
    }

    private get availableVideoCodecs(): VideoCodecType[] {
        return containerCodecs[this.config.videoFormat.container].video
    }

    private get availableAudioCodecs(): AudioCodecType[] {
        return containerCodecs[this.config.videoFormat.container].audio
    }

    private ensureValidCodecs(container: ContainerFormat) {
        const available = containerCodecs[container]
        if (!available.video.includes(this.config.videoFormat.videoCodec)) {
            this.config.videoFormat.videoCodec = available.video[0]
        }
        if (!available.audio.includes(this.config.videoFormat.audioCodec)) {
            this.config.videoFormat.audioCodec = available.audio[0]
        }
    }

    private codecDisplayName(codec: string): string {
        const names: Record<string, string> = {
            vp8: 'VP8',
            vp9: 'VP9',
            av1: 'AV1',
            avc: 'H.264 (AVC)',
            hevc: 'H.265 (HEVC)',
            opus: 'Opus',
            aac: 'AAC',
            vorbis: 'Vorbis',
        }
        return names[codec] ?? codec
    }

    private async updateMicPermission() {
        const permission = await navigator.permissions.query({ name: 'microphone' })
        const update = async () => {
            if (permission.state !== 'granted') {
                this.microphonePermissionGranted = false
                return
            }

            this.microphonePermissionGranted = true
            // Enumerate devices after permission is granted
            await this.enumerateMicrophones()
        }
        permission.addEventListener('change', update)
        update()
    }

    private async enumerateMicrophones() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices()
            this.availableMicrophones = devices.filter(device => device.kind === 'audioinput')
        } catch (e) {
            console.warn('Cannot enumerate microphones:', e)
            this.availableMicrophones = []
        }
    }

    private async testMicrophonePermission() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })

            // Permission granted, clean up stream
            stream.getTracks().forEach(track => track.stop())
        } catch (e) {
            console.warn('Microphone permission denied:', e)
            this.microphonePermissionGranted = false
            this.alert('Microphone permission is required for recording.\nPlease allow access when prompted.')
        }
    }

    private async sync() {
        const msg: FetchConfigMessage = {
            type: 'fetch-config',
        }
        const config = await chrome.runtime.sendMessage<FetchConfigMessage, Configuration | null>(msg)
        if (config == null) return
        const oldVal = this.config
        this.config = deepMerge(oldVal, Configuration.filterForSync(config))
        this.requestUpdate('config', oldVal)
        Settings.setConfiguration(this.config)
    }

    private async restore() {
        const oldVal = this.config
        this.config = Configuration.restoreDefault(this.config)
        this.requestUpdate('config', oldVal)
        this.resetValidityError()
        Settings.setConfiguration(this.config)
        await Settings.syncConfiguration(this.config)
    }

    private resetValidityError() {
        const elements = this.shadowRoot?.querySelectorAll('md-filled-text-field')
        if (elements == null) return
        for (const elem of elements) {
            elem.setCustomValidity('')
            elem.reportValidity()
        }
    }

    private alert(content: string) {
        const dialogWrapper = document.getElementById('alert-dialog') as Alert
        dialogWrapper.setContent('Alert', content)

        if (dialogWrapper.shadowRoot == null) return
        const dialog = dialogWrapper.shadowRoot.children[0] as MdDialog
        dialog.show()
    }
};

export default Settings

declare global {
    interface HTMLElementTagNameMap {
        'extension-settings': Settings;
    }
}
