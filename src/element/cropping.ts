import { html, css, LitElement } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
import { live } from 'lit/directives/live.js'
import '@material/web/switch/switch'
import '@material/web/textfield/filled-text-field'
import { MdSwitch } from '@material/web/switch/switch'
import { MdFilledTextField } from '@material/web/textfield/filled-text-field'
import { Configuration, CropRegion, Resolution } from '../configuration'
import {
    RecordingStateMessage,
    RequestRecordingStateMessage,
    PreviewControlMessage,
    UpdateCropRegionMessage,
} from '../message'
import Settings from './settings'
import './croppingPreview'
import { CropRegionChangeEvent } from './croppingPreview'
import { roundToEven, clampCoordinate, clampDimension } from './util'

@customElement('extension-cropping')
export class Cropping extends LitElement {
    static readonly styles = css`
        :host {
            display: block;
        }
        .switch-row {
            display: flex;
            align-items: center;
            gap: 16px;
            margin-bottom: 1em;
        }
        .switch-label {
            font-size: 1.2em;
        }
        .message {
            color: #666;
            font-style: italic;
            margin: 1em 0;
        }
        .message.warning {
            color: #b00;
        }
        .hint {
            color: #666;
            font-size: 0.9em;
            margin: 0.5em 0 1em 0;
        }
        .region-inputs {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
            max-width: 400px;
        }
        md-filled-text-field {
            width: 100%;
        }
    `

    @property({ type: Object })
    private config: Configuration

    @state()
    private isRecording: boolean = false

    @state()
    private screenSize: Resolution | null = null

    @state()
    private isTabActive: boolean = false

    constructor() {
        super()
        this.config = Settings.getConfiguration()
    }

    connectedCallback() {
        super.connectedCallback()
        // Listen for recording state changes
        chrome.runtime.onMessage.addListener(this.handleMessage)
        // Listen for configuration changes from other components
        window.addEventListener(Settings.CONFIG_CHANGED_EVENT, this.handleConfigChange)
        // Request current recording state
        this.requestRecordingState()
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        chrome.runtime.onMessage.removeListener(this.handleMessage)
        window.removeEventListener(Settings.CONFIG_CHANGED_EVENT, this.handleConfigChange)
        // Stop preview when component is disconnected
        this.stopPreview()
    }

    private handleMessage = (message: RecordingStateMessage) => {
        if (message.type === 'recording-state') {
            const wasRecording = this.isRecording
            this.isRecording = message.isRecording
            this.screenSize = message.screenSize ?? null

            // Update preview state based on recording state change
            if (this.isTabActive) {
                if (message.isRecording && !wasRecording) {
                    this.startPreview()
                } else if (!message.isRecording && wasRecording) {
                    this.stopPreview()
                }
            }
        }
    }

    private handleConfigChange = (event: Event) => {
        const customEvent = event as CustomEvent<Configuration>
        this.config = customEvent.detail
    }

    private async requestRecordingState() {
        const msg: RequestRecordingStateMessage = { type: 'request-recording-state' }
        try {
            await chrome.runtime.sendMessage(msg)
        } catch (e) {
            console.error('Failed to request recording state:', e)
        }
    }

    private async startPreview() {
        const msg: PreviewControlMessage = { type: 'preview-control', action: 'start' }
        try {
            await chrome.runtime.sendMessage(msg)
        } catch (e) {
            console.error('Failed to start preview:', e)
        }
    }

    private async stopPreview() {
        const msg: PreviewControlMessage = { type: 'preview-control', action: 'stop' }
        try {
            await chrome.runtime.sendMessage(msg)
        } catch (e) {
            console.error('Failed to stop preview:', e)
        }
    }

    // Called when Cropping tab becomes active/inactive
    public setTabActive(active: boolean) {
        this.isTabActive = active
        if (active && this.isRecording && !this.isAudioOnlyMode) {
            this.startPreview()
        } else if (!active) {
            this.stopPreview()
        }
    }

    private get isAudioOnlyMode(): boolean {
        return this.config.videoFormat.recordingMode === 'audio-only'
    }

    private get canChangeCroppingEnabled(): boolean {
        // Cannot change cropping ON/OFF during recording or in audio-only mode
        return !this.isRecording && !this.isAudioOnlyMode
    }

    private get canChangeRegion(): boolean {
        // Can change region when not in audio-only mode (even during recording)
        return !this.isAudioOnlyMode
    }

    private handleEnableChange(e: Event) {
        if (!this.canChangeCroppingEnabled) return
        const target = e.target as MdSwitch
        this.config = {
            ...this.config,
            cropping: {
                ...this.config.cropping,
                enabled: target.selected,
            },
        }
        Settings.setConfiguration(this.config)
    }

    private updateRegion(field: keyof CropRegion) {
        return (e: Event) => {
            if (!this.canChangeRegion) return
            const target = e.target as MdFilledTextField
            let value = parseInt(target.value, 10)
            if (isNaN(value)) return

            // Apply constraints based on field type
            if (field === 'x' || field === 'y') {
                // x, y: must be non-negative and even for VideoFrame compatibility
                value = roundToEven(clampCoordinate(value))
            } else {
                // width, height: must be positive (> 0)
                value = clampDimension(value)
            }

            this.updateCropRegion({
                ...this.config.cropping.region,
                [field]: value,
            })
        }
    }

    private handleCropRegionChange(e: CustomEvent<CropRegionChangeEvent>) {
        if (!this.canChangeRegion) return
        this.updateCropRegion(e.detail.region)
    }

    private async updateCropRegion(newRegion: CropRegion) {
        this.config = {
            ...this.config,
            cropping: {
                ...this.config.cropping,
                region: newRegion,
            },
        }
        Settings.setConfiguration(this.config)

        // If recording, send update to offscreen for immediate effect
        if (this.isRecording) {
            const msg: UpdateCropRegionMessage = {
                type: 'update-crop-region',
                region: newRegion,
            }
            try {
                await chrome.runtime.sendMessage(msg)
            } catch (e) {
                console.error('Failed to update crop region:', e)
            }
        }
    }

    private renderMessages() {
        if (this.isAudioOnlyMode) {
            return html`<p class="message warning">Cropping is not available in Audio only mode.</p>`
        }
        if (this.isRecording) {
            return html`<p class="message warning">Cannot enable or disable cropping during recording. You can still adjust the crop region.</p>`
        }
        return null
    }

    render() {
        const { enabled, region } = this.config.cropping
        const switchDisabled = !this.canChangeCroppingEnabled
        const inputsDisabled = !this.canChangeRegion

        return html`
            <h2>Cropping</h2>
            <div class="switch-row">
                <label class="switch-label">Enable Cropping</label>
                <md-switch
                    ?selected=${enabled}
                    ?disabled=${switchDisabled}
                    @change=${this.handleEnableChange}
                ></md-switch>
            </div>
            ${this.renderMessages()}

            <h3>Preview</h3>
            <p class="hint">Adjust the cropping area during a test recording, then apply to actual recordings.</p>
            <cropping-preview
                ?croppingEnabled=${enabled}
                .cropRegion=${region}
                .screenSize=${this.screenSize}
                ?isRecording=${this.isRecording}
                ?canInteract=${this.canChangeRegion}
                @crop-region-change=${this.handleCropRegionChange}
            ></cropping-preview>

            <h3>Region</h3>
            <p class="hint">Due to technical constraints, X and Y values must be even numbers.</p>
            <div class="region-inputs">
                <md-filled-text-field
                    label="X"
                    type="number"
                    min="0"
                    step="2"
                    suffix-text="px"
                    .value=${live(String(region.x))}
                    ?disabled=${inputsDisabled}
                    @input=${this.updateRegion('x')}
                ></md-filled-text-field>
                <md-filled-text-field
                    label="Y"
                    type="number"
                    min="0"
                    step="2"
                    suffix-text="px"
                    .value=${live(String(region.y))}
                    ?disabled=${inputsDisabled}
                    @input=${this.updateRegion('y')}
                ></md-filled-text-field>
                <md-filled-text-field
                    label="Width"
                    type="number"
                    min="1"
                    suffix-text="px"
                    .value=${live(String(region.width))}
                    ?disabled=${inputsDisabled}
                    @input=${this.updateRegion('width')}
                ></md-filled-text-field>
                <md-filled-text-field
                    label="Height"
                    type="number"
                    min="1"
                    suffix-text="px"
                    .value=${live(String(region.height))}
                    ?disabled=${inputsDisabled}
                    @input=${this.updateRegion('height')}
                ></md-filled-text-field>
            </div>
        `
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'extension-cropping': Cropping
    }
}
