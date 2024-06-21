import { html, css, LitElement } from 'lit'
import { live } from 'lit/directives/live.js'
import { customElement, property } from 'lit/decorators.js'
import '@material/web/icon/icon'
import '@material/web/button/filled-tonal-button'
import '@material/web/switch/switch'
import { MdFilledTextField } from '@material/web/textfield/filled-text-field'
import { MdSwitch } from '@material/web/switch/switch'
import type { BackgroundWindowSizeMessage, BackgroundSyncConfigMessage } from '../message'
import { Configuration, Resolution } from '../configuration'
import { WebLocalStorage } from '../storage'
import type { Message, BackgroundFetchConfigMessage } from '../message'
import { sendException } from '../sentry'

@customElement('extension-settings')
export class Settings extends LitElement {
    private static readonly storage = new WebLocalStorage()

    private static getConfiguration(): Configuration {
        const config = Settings.storage.get(Configuration.key)
        const defaultConfig = new Configuration()
        if (config == null) return defaultConfig
        return { ...defaultConfig, ...config }
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

    public static getScreenRecordingSize(): Resolution {
        return Settings.getConfiguration().screenRecordingSize
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
                        this.config = { ...oldVal, ...message.data }
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
        <md-filled-text-field label="width" type="number" suffix-text="px" .value=${live(this.config.screenRecordingSize.width)} @input=${this.updateProp('screenRecordingSize', 'width')}></md-filled-text-field>
        <md-filled-text-field label="height" type="number" suffix-text="px" .value=${live(this.config.screenRecordingSize.height)} @input=${this.updateProp('screenRecordingSize', 'height')}></md-filled-text-field>
        <h2>Privacy</h2>
        <label style="line-height: 32px; font-size: 1.5em">
            Bug Tracking
            <md-switch ?selected=${this.config.enableBugTracking} @input=${this.updateProp('enableBugTracking')}></md-switch>
        </label>
        <h2>Sync</h2>
        <md-filled-tonal-button @click=${this.fetchConfig}>
            Sync Settings
            <md-icon slot="icon">sync</md-icon>
        </md-filled-tonal-button>
        `
    }

    private async resizeWindow() {
        const msg: BackgroundWindowSizeMessage = {
            type: 'resize-window',
            target: 'background',
            data: this.config.windowSize,
        }
        await chrome.runtime.sendMessage(msg)
    }
    private updateProp(key1: 'windowSize' | 'screenRecordingSize' | 'enableBugTracking', key2?: 'width' | 'height') {
        return async (e: Event) => {
            switch (key1) {
                case 'windowSize':
                    if (!(e.target instanceof MdFilledTextField) || key2 == null) return
                    this.config[key1][key2] = Number.parseInt(e.target.value, 10)
                    break
                case 'screenRecordingSize':
                    if (!(e.target instanceof MdFilledTextField) || key2 == null) return
                    this.config[key1][key2] = Number.parseInt(e.target.value, 10)
                    break
                case 'enableBugTracking':
                    if (!(e.target instanceof MdSwitch)) return
                    this.config[key1] = e.target.selected
                    break
            }

            Settings.setConfiguration(this.config)
            await Settings.syncConfiguration(this.config)
        }
    }
    private async fetchConfig() {
        const msg: BackgroundFetchConfigMessage = {
            target: 'background',
            type: 'fetch-config',
        }
        await chrome.runtime.sendMessage(msg)
    }
};

export default Settings

declare global {
    interface HTMLElementTagNameMap {
        'extension-settings': Settings;
    }
}
