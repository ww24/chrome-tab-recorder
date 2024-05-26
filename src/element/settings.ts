import { html, css, LitElement } from 'lit';
import { live } from 'lit/directives/live.js';
import { customElement, property } from 'lit/decorators.js';
import '@material/web/icon/icon';
import '@material/web/button/filled-tonal-button';
import '@material/web/switch/switch';
import { MdFilledTextField } from '@material/web/textfield/filled-text-field';
import type { Resolution, BackgroundWindowSizeMessage } from '../message';
import { MdSwitch } from '@material/web/switch/switch';

class Configuration {
    windowSize: Resolution;
    screenRecordingSize: Resolution;
    enableBugTracking: boolean;
    constructor() {
        this.windowSize = {
            width: 1920,
            height: 1080,
        };
        this.screenRecordingSize = {
            width: 1920,
            height: 1080,
        };
        this.enableBugTracking = true;
    }
};

@customElement('extension-settings')
export class Settings extends LitElement {
    private static readonly localStorageKey = 'settings';

    private static getConfiguration(): Configuration {
        const config = localStorage.getItem(Settings.localStorageKey);
        const defaultConfig = new Configuration();
        if (config == null) return defaultConfig;
        return { ...defaultConfig, ...JSON.parse(config) };
    }

    private static setConfiguration(config: Configuration) {
        const c = JSON.stringify({
            windowSize: config.windowSize,
            screenRecordingSize: config.screenRecordingSize,
        });
        localStorage.setItem(Settings.localStorageKey, c);
    }

    public static getScreenRecordingSize(): Resolution {
        return Settings.getConfiguration().screenRecordingSize;
    }

    public static getEnableBugTracking(): boolean {
        return Settings.getConfiguration().enableBugTracking;
    }

    static readonly styles = css`
    md-filled-tonal-button {
        height: 56px;
    }
    `;

    @property({ noAccessor: true })
    private config: Configuration;

    public constructor() {
        super();
        this.config = Settings.getConfiguration();
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
        `;
    }

    private async resizeWindow() {
        const msg: BackgroundWindowSizeMessage = {
            type: 'resize-window',
            target: 'background',
            data: this.config.windowSize,
        };
        await chrome.runtime.sendMessage(msg);
    }
    private updateProp(key1: 'windowSize' | 'screenRecordingSize' | 'enableBugTracking', key2?: 'width' | 'height') {
        return (e: Event) => {
            switch (key1) {
                case 'windowSize':
                    if (!(e.target instanceof MdFilledTextField) || key2 == null) return;
                    this.config[key1][key2] = Number.parseInt(e.target.value, 10);
                    break;
                case 'screenRecordingSize':
                    if (!(e.target instanceof MdFilledTextField) || key2 == null) return;
                    this.config[key1][key2] = Number.parseInt(e.target.value, 10);
                    break;
                case 'enableBugTracking':
                    if (!(e.target instanceof MdSwitch)) return;
                    this.config[key1] = e.target.selected;
                    break;
            }

            Settings.setConfiguration(this.config);
            console.debug('updated:', JSON.stringify(this.config));
        }
    }
};

export default Settings;

declare global {
    interface HTMLElementTagNameMap {
        'extension-settings': Settings;
    }
}
