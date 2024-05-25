import { html, css, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import '@material/web/icon/icon';
import '@material/web/button/filled-tonal-button';
import { MdFilledTextField } from '@material/web/textfield/filled-text-field';
import type { Resolution, BackgroundWindowSizeMessage } from '../message';

interface Configuration {
    windowSize: Resolution,
    screenRecordingSize: Resolution,
}

@customElement('extension-settings')
export class Settings extends LitElement {
    private static readonly localStorageKey = 'settings';

    private static getConfiguration(): Configuration {
        const config = localStorage.getItem(Settings.localStorageKey);
        const defaultConfig = {
            windowSize: {
                width: 1600,
                height: 900,
            },
            screenRecordingSize: {
                width: 1600,
                height: 900,
            },
        };
        if (config == null) return defaultConfig;
        const c = JSON.parse(config);
        c.windowSize ??= defaultConfig.windowSize;
        c.screenRecordingSize ??= defaultConfig.screenRecordingSize;
        return c;
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

    static readonly styles = css`
    md-filled-tonal-button {
        height: 56px;
    }
    `;

    @property({ noAccessor: true })
    private windowSize: Resolution;

    @property({ noAccessor: true })
    private screenRecordingSize: Resolution;

    public constructor() {
        super();
        const config = Settings.getConfiguration();
        this.windowSize = config.windowSize;
        this.screenRecordingSize = config.screenRecordingSize;
    }

    public render() {
        return html`
        <h2>Settings</h2>
        <h3>Window Size</h3>
        <md-filled-text-field label="width" type="number" suffix-text="px" value="${this.windowSize.width}" @input="${this.updateProp(this.windowSize, "width")}"></md-filled-text-field>
        <md-filled-text-field label="height" type="number" suffix-text="px" value="${this.windowSize.height}" @input="${this.updateProp(this.windowSize, "height")}"></md-filled-text-field>
        <md-filled-tonal-button @click="${this.resizeWindow}">
            Resize
            <md-icon slot="icon">resize</md-icon>
        </md-filled-tonal-button>
        <h3>Screen Recording Size</h3>
        <md-filled-text-field label="width" type="number" suffix-text="px" value="${this.screenRecordingSize.width}" @input="${this.updateProp(this.screenRecordingSize, "width")}"></md-filled-text-field>
        <md-filled-text-field label="height" type="number" suffix-text="px" value="${this.screenRecordingSize.height}" @input="${this.updateProp(this.screenRecordingSize, "height")}"></md-filled-text-field>
        `;
    }

    private async resizeWindow() {
        const msg: BackgroundWindowSizeMessage = {
            type: 'resize-window',
            target: 'background',
            data: this.windowSize,
        };
        await chrome.runtime.sendMessage(msg);
    }
    private updateProp(obj: Resolution, key: 'width' | 'height') {
        return (e: Event) => {
            if (!(e.target instanceof MdFilledTextField)) return;
            switch (e.target?.type) {
                case 'number':
                    obj[key] = Number.parseInt(e.target.value, 10);
                    break;
                default:
                    throw new Error(`unexpected input type: ${e.target.type}`);
            }

            Settings.setConfiguration({
                windowSize: this.windowSize,
                screenRecordingSize: this.screenRecordingSize,
            });
            console.log('updated:', obj);
        }
    }
};

export default Settings;

declare global {
    interface HTMLElementTagNameMap {
        'extension-settings': Settings;
    }
}
