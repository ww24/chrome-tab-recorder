import { html, css, LitElement } from 'lit'
import { live } from 'lit/directives/live.js'
import { customElement, property } from 'lit/decorators.js'
import '@material/web/icon/icon'
import '@material/web/button/filled-tonal-button'
import '@material/web/switch/switch'
import { MdFilledTextField } from '@material/web/textfield/filled-text-field'
import { MdSwitch } from '@material/web/switch/switch'
import type { BackgroundWindowSizeMessage, BackgroundSyncConfigMessage } from '../message'
import { Configuration, Resolution, VideoFormat } from '../configuration'
import { WebLocalStorage } from '../storage'
import type { Message, BackgroundFetchConfigMessage } from '../message'
import { sendException } from '../sentry'
import { deepMerge } from './util'

@customElement('extension-settings')
export class Settings extends LitElement {
    private static readonly storage = new WebLocalStorage()

    private static getConfiguration(): Configuration {
        const defaultConfig = new Configuration()
        const config = Settings.storage.get(Configuration.key) as Configuration
        return deepMerge(defaultConfig, config)
    }

    public static setConfiguration(config: Configuration) {
        config.updatedAt = Date.now()
        Settings.storage.set(Configuration.key, config)
    }

    private static async syncConfiguration(config: Configuration) {
        const msg: BackgroundSyncConfigMessage = {
            type: 'sync-config',
            target: 'background',
            data: config,
        }
        await chrome.runtime.sendMessage(msg)
    }

    public static getScreenRecordingSize(base: Resolution): Resolution {
        const config = Settings.getConfiguration()
        return Configuration.screenRecordingSize(config, base)
    }

    public static getVideoFormat(): VideoFormat {
        const config = Settings.getConfiguration()
        return Configuration.videoFormat(config)
    }

    public static getEnableBugTracking(): boolean {
        return Settings.getConfiguration().enableBugTracking
    }

    public static getUserId(): string {
        return Settings.getConfiguration().userId
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
    .mime-type-input {
        width: 564px;
    }
    `

    @property({ noAccessor: true })
    private config: Configuration

    public constructor() {
        super()
        this.config = Settings.getConfiguration()

        chrome.runtime.onMessage.addListener(async (message: Message) => {
            try {
                if (message.target !== 'option') return
                switch (message.type) {
                    case 'sync-config':
                        const oldVal = this.config
                        this.config = deepMerge(oldVal, message.data)
                        this.requestUpdate('config', oldVal)
                        Settings.setConfiguration(this.config)
                        return
                }
            } catch (e) {
                sendException(e)
                console.error(e)
            }
        })
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
                <md-switch ?selected=${live(this.config.screenRecordingSize.auto)} @input=${this.updateProp('screenRecordingSize', 'auto')}></md-switch>
            </label>
        </div>
        <md-filled-text-field label="width" type="number" suffix-text="px" ?disabled=${live(this.config.screenRecordingSize.auto)} .value=${live(this.config.screenRecordingSize.width)} @input=${this.updateProp('screenRecordingSize', 'width')}></md-filled-text-field>
        <md-filled-text-field label="height" type="number" suffix-text="px" ?disabled=${live(this.config.screenRecordingSize.auto)} .value=${live(this.config.screenRecordingSize.height)} @input=${this.updateProp('screenRecordingSize', 'height')}></md-filled-text-field>
        <md-filled-text-field label="recording scale" type="number" min="1" suffix-text="x" ?disabled=${live(!this.config.screenRecordingSize.auto)} .value=${live(this.config.screenRecordingSize.scale)} @input=${this.updateProp('screenRecordingSize', 'scale')}></md-filled-text-field>
        <h2>Video Format</h2>
        <md-filled-text-field class="video-format-input" label="audio bitrate" type="number" min="1" suffix-text="Kbps" .value=${live(this.config.videoFormat.audioBitrate / 1024)} @input=${this.updateProp('videoFormat', 'audioBitrate')}></md-filled-text-field>
        <md-filled-text-field class="video-format-input" label="video bitrate" type="number" min="0" step="0.1" supporting-text="0 means auto (number of pixels * 8 bps)" suffix-text="Mbps" .value=${live(this.config.videoFormat.videoBitrate / 1024 / 1024)} @input=${this.updateProp('videoFormat', 'videoBitrate')}></md-filled-text-field>
        <md-filled-text-field class="mime-type-input" label="MIME type" type="text" .value=${live(this.config.videoFormat.mimeType)} @input=${this.updateProp('videoFormat', 'mimeType')}></md-filled-text-field>
        <h2>Privacy</h2>
        <label style="line-height: 32px; font-size: 1.5em">
            Bug Tracking
            <md-switch ?selected=${live(this.config.enableBugTracking)} @input=${this.updateProp('enableBugTracking')}></md-switch>
        </label>
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
        const msg: BackgroundWindowSizeMessage = {
            type: 'resize-window',
            target: 'background',
            data: { width, height },
        }
        await chrome.runtime.sendMessage(msg)
    }
    private updateProp(key1: 'windowSize' | 'screenRecordingSize' | 'videoFormat' | 'enableBugTracking', key2?: string) {
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
                    if (!(e.target instanceof MdFilledTextField) || key2 == null) return
                    switch (key2) {
                        case 'audioBitrate':
                            this.config[key1][key2] = Number.parseInt(e.target.value, 10) * 1024
                            break
                        case 'videoBitrate':
                            this.config[key1][key2] = Number.parseFloat(e.target.value) * 1024 * 1024
                            break
                        case 'mimeType':
                            if (!MediaRecorder.isTypeSupported(e.target.value)) {
                                e.target.setCustomValidity('unsupported mimeType')
                                e.target.reportValidity()
                                console.debug('unsupported mimeType:', e.target.value)
                                return
                            }
                            e.target.setCustomValidity('')
                            e.target.reportValidity()
                            this.config[key1][key2] = e.target.value
                            break
                    }
                    break
                case 'enableBugTracking':
                    if (!(e.target instanceof MdSwitch)) return
                    this.config[key1] = e.target.selected
                    break
            }

            this.requestUpdate('config', oldVal)
            Settings.setConfiguration(this.config)
            await Settings.syncConfiguration(this.config)
        }
    }
    private async sync() {
        const msg: BackgroundFetchConfigMessage = {
            target: 'background',
            type: 'fetch-config',
        }
        await chrome.runtime.sendMessage(msg)
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
};

export default Settings

declare global {
    interface HTMLElementTagNameMap {
        'extension-settings': Settings;
    }
}
