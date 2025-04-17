import { html, css, LitElement } from 'lit'
import { live } from 'lit/directives/live.js'
import { customElement, property } from 'lit/decorators.js'
import '@material/web/icon/icon'
import '@material/web/button/filled-tonal-button'
import '@material/web/switch/switch'
import '@material/web/select/filled-select'
import '@material/web/select/select-option'
import { MdFilledSelect } from '@material/web/select/filled-select'
import { MdFilledTextField } from '@material/web/textfield/filled-text-field'
import { MdSwitch } from '@material/web/switch/switch'
import type { ResizeWindowMessage, SaveConfigSyncMessage } from '../message'
import { Configuration, Resolution, VideoFormat, isVideoRecordingMode } from '../configuration'
import { WebLocalStorage } from '../storage'
import type { FetchConfigMessage } from '../message'
import { deepMerge } from './util'

@customElement('extension-settings')
export class Settings extends LitElement {
    private static readonly storage = new WebLocalStorage()

    public static getConfiguration(): Configuration {
        const defaultConfig = new Configuration()
        const config = Settings.storage.get(Configuration.key) as Configuration
        return deepMerge(defaultConfig, config)
    }

    public static setConfiguration(config: Configuration) {
        config.updatedAt = Date.now()
        Settings.storage.set(Configuration.key, config)
    }

    private static async syncConfiguration(config: Configuration) {
        const msg: SaveConfigSyncMessage = {
            type: 'save-config-sync',
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
    .path-input {
        width: 500px;
    }
    .path-select-button {
        margin-left: 8px;
    }
    .path-container {
        display: flex;
        align-items: center;
        margin-bottom: 1em;
    }
    `

    @property({ noAccessor: true })
    private config: Configuration

    public constructor() {
        super()
        this.config = Settings.getConfiguration()
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
        <md-filled-text-field class="mime-type-input" label="MIME type" type="text" .value=${live(this.config.videoFormat.mimeType)} @input=${this.updateProp('videoFormat', 'mimeType')}></md-filled-text-field>
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
        <h2>Option</h2>
        <label style="line-height: 32px; font-size: 1.5em">
            Open the option page after recording
            <md-switch ?selected=${live(this.config.openOptionPage)} @input=${this.updateProp('openOptionPage')}></md-switch>
        </label>
        <label style="line-height: 32px; font-size: 1.5em; margin-top: 1em; display: block;">
            Mute tab audio when recording starts
            <md-switch ?selected=${live(this.config.muteOnRecording)} @input=${this.updateProp('muteOnRecording')}></md-switch>
        </label>
        <h2>Save Settings</h2>
        <label style="line-height: 32px; font-size: 1.5em">
            Save to default path
            <md-switch ?selected=${live(this.config.saveToDefaultPath)} @input=${this.updateProp('saveToDefaultPath')}></md-switch>
        </label>
        <div class="path-container">
            <md-filled-text-field
                class="path-input"
                label="Default save path"
                .value=${live(this.config.defaultSavePath)}
                ?disabled=${!this.config.saveToDefaultPath}
                @input=${this.updateProp('defaultSavePath')}
            ></md-filled-text-field>
            <md-filled-tonal-button
                class="path-select-button"
                ?disabled=${!this.config.saveToDefaultPath}
                @click=${this.selectDefaultPath}
            >
                Select folder
                <md-icon slot="icon">folder_open</md-icon>
            </md-filled-tonal-button>
        </div>
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
        const msg: ResizeWindowMessage = {
            type: 'resize-window',
            data: { width, height },
        }
        await chrome.runtime.sendMessage(msg)
    }
    private updateProp(key1: 'windowSize' | 'screenRecordingSize' | 'videoFormat' | 'enableBugTracking' | 'openOptionPage' | 'muteOnRecording' | 'saveToDefaultPath' | 'defaultSavePath', key2?: string) {
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
                        case 'recordingMode':
                            if (!isVideoRecordingMode(e.target.value)) return
                            this.config[key1][key2] = e.target.value
                            break
                    }
                    break
                case 'enableBugTracking':
                case 'openOptionPage':
                case 'muteOnRecording':
                case 'saveToDefaultPath':
                    if (!(e.target instanceof MdSwitch)) return
                    this.config[key1] = e.target.selected
                    break
                case 'defaultSavePath':
                    if (!(e.target instanceof MdFilledTextField)) return
                    this.config[key1] = e.target.value
                    break
            }

            this.requestUpdate('config', oldVal)
            Settings.setConfiguration(this.config)
            await Settings.syncConfiguration(this.config)
        }
    }
    private async sync() {
        const msg: FetchConfigMessage = {
            type: 'fetch-config',
        }
        const config = await chrome.runtime.sendMessage<FetchConfigMessage, Configuration | null>(msg)
        if (config == null) return
        const oldVal = this.config
        this.config = deepMerge(oldVal, config)
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
    private async selectDefaultPath() {
        try {
            const dirHandle = await window.showDirectoryPicker({
                id: 'default-save-directory',
                mode: 'readwrite',
                startIn: 'downloads'
            });
            
            // Confirm permissions
            const permission = await dirHandle.requestPermission({ mode: 'readwrite' });
            if (permission !== 'granted') {
                throw new Error('Permission denied');
            }
            
            // Store directory handle
            const oldVal = { ...this.config };
            this.config.defaultSavePath = dirHandle.name;
            
            // Save directory handle to IndexedDB for future use
            await this.storeDirHandle(dirHandle);
            
            this.requestUpdate('config', oldVal);
            Settings.setConfiguration(this.config);
            await Settings.syncConfiguration(this.config);
            
            // Show success message
            this.showToast('Default save path set successfully', '#4caf50');
        } catch (error) {
            console.error('Failed to select directory:', error);
            this.showToast('Failed to select folder: ' + (error as Error).message, '#d32f2f');
        }
    }
    
    private async storeDirHandle(dirHandle: FileSystemDirectoryHandle): Promise<void> {
        // 使用IndexedDB存储目录句柄
        const dbName = 'directoryHandlesDB';
        const storeName = 'directoryHandles';
        const key = 'defaultSavePath';
        
        return new Promise<void>((resolve, reject) => {
            try {
                const request = indexedDB.open(dbName, 1);
                
                request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
                    try {
                        const db = (event.target as IDBOpenDBRequest).result;
                        if (!db.objectStoreNames.contains(storeName)) {
                            db.createObjectStore(storeName);
                        }
                    } catch (error) {
                        console.error('Error during database upgrade:', error);
                    }
                };
                
                request.onsuccess = (event: Event) => {
                    try {
                        const db = (event.target as IDBOpenDBRequest).result;
                        const transaction = db.transaction(storeName, 'readwrite');
                        const objectStore = transaction.objectStore(storeName);
                        
                        const saveRequest = objectStore.put(dirHandle, key);
                        
                        saveRequest.onsuccess = () => {
                            console.log('Directory handle stored successfully');
                            resolve();
                        };
                        
                        saveRequest.onerror = (error: Event) => {
                            console.error('Error storing directory handle:', error);
                            reject(error);
                        };
                        
                        transaction.oncomplete = () => {
                            db.close();
                        };
                    } catch (error) {
                        console.error('Error in IndexedDB transaction:', error);
                        reject(error);
                    }
                };
                
                request.onerror = (error: Event) => {
                    console.error('Error opening database:', error);
                    reject(error);
                };
            } catch (error) {
                console.error('Unexpected error in storeDirHandle:', error);
                reject(error);
            }
        });
    }

    // Display toast message
    private showToast(message: string, backgroundColor: string) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.left = '50%';
        toast.style.transform = 'translateX(-50%)';
        toast.style.backgroundColor = backgroundColor;
        toast.style.color = 'white';
        toast.style.padding = '10px 20px';
        toast.style.borderRadius = '4px';
        toast.style.zIndex = '1000';
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            if (document.body.contains(toast)) {
                document.body.removeChild(toast);
            }
        }, 3000);
    }
};

export default Settings

declare global {
    interface HTMLElementTagNameMap {
        'extension-settings': Settings;
    }
}
