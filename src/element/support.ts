import { html, css, LitElement } from 'lit'
import { live } from 'lit/directives/live.js'
import { customElement, property, state } from 'lit/decorators.js'
import '@material/web/icon/icon'
import '@material/web/button/filled-tonal-button'
import '@material/web/switch/switch'
import '@material/web/textfield/filled-text-field'
import '@material/web/select/filled-select'
import '@material/web/select/select-option'
import { MdFilledTextField } from '@material/web/textfield/filled-text-field'
import { MdFilledSelect } from '@material/web/select/filled-select'
import { MdSwitch } from '@material/web/switch/switch'
import { Settings } from './settings'
import { Configuration } from '../configuration'
import { sendFeedback, FeedbackType, sendException, sendEvent } from '../sentry'
import Alert from './alert'

const MAX_MESSAGE_LENGTH = 1000

@customElement('extension-support')
export class Support extends LitElement {
    static readonly styles = css`
        :host {
            display: block;
        }
        md-filled-tonal-button {
            height: 56px;
        }
        md-filled-tonal-button, md-filled-text-field, md-filled-select, md-switch {
            margin-bottom: 1em;
        }
        .feedback-form {
            display: flex;
            flex-direction: column;
        }
        .feedback-form md-filled-text-field,
        .feedback-form md-filled-select {
            width: 100%;
        }
        .warning-message {
            color: #f44336;
            margin-bottom: 1em;
            font-size: 1.1em;
        }
        .section-description {
            font-size: 1.1em;
            margin-bottom: 1em;
            color: #666;
        }
        .notice {
            font-size: 0.95em;
            color: #888;
            margin-bottom: 1em;
            padding: 0.5em;
            background-color: #f5f5f5;
            border-radius: 4px;
        }
        .char-count {
            font-size: 0.9em;
            color: #666;
            text-align: right;
            margin-top: -0.8em;
            margin-bottom: 1em;
        }
        .char-count.over-limit {
            color: #f44336;
        }
        .review-section p {
            font-size: 1.1em;
            margin-bottom: 1em;
        }
        .support-section p {
            font-size: 1.1em;
            margin-bottom: 1em;
            color: #666;
        }
        .buymeacoffee-link img {
            max-height: 60px;
        }
        a {
            text-decoration: none;
        }
    `

    @property({ noAccessor: true })
    private config: Configuration

    @state()
    private feedbackType: FeedbackType = 'bug-report'

    @state()
    private feedbackMessage: string = ''

    @state()
    private isSending: boolean = false

    public constructor() {
        super()
        this.config = Settings.getConfiguration()
        this.handleConfigChange = this.handleConfigChange.bind(this)
    }

    connectedCallback() {
        super.connectedCallback()
        window.addEventListener(Settings.CONFIG_CHANGED_EVENT, this.handleConfigChange)
    }

    disconnectedCallback() {
        super.disconnectedCallback()
        window.removeEventListener(Settings.CONFIG_CHANGED_EVENT, this.handleConfigChange)
    }

    private handleConfigChange(e: Event) {
        if (!(e instanceof CustomEvent)) return
        this.config = e.detail as Configuration
        this.requestUpdate()
    }

    private getMessageCharLength(): number {
        return [...this.feedbackMessage.trim()].length
    }

    private isMessageValid(): boolean {
        const charLength = this.getMessageCharLength()
        return charLength > 0 && charLength <= MAX_MESSAGE_LENGTH
    }

    public render() {
        const bugTrackingEnabled = this.config.enableBugTracking
        const messageCharLength = this.getMessageCharLength()
        const isOverLimit = messageCharLength > MAX_MESSAGE_LENGTH

        return html`
            <h2>Review</h2>
            <div class="review-section">
                <p>If you find this extension useful, please leave a review!</p>
                <md-filled-tonal-button href="https://chromewebstore.google.com/detail/instant-tab-recorder/giebbnikpnedbdojlghnnegpfbgdecmi/reviews" target="_blank" rel="noopener" @click=${this.handleReviewLink}>
                    Write a Review
                    <md-icon slot="icon">rate_review</md-icon>
                </md-filled-tonal-button>
            </div>

            <h2>Support Development</h2>
            <div class="support-section">
                <p>Your support helps keep this extension maintained and improved. Every contribution motivates continued development!</p>
                <a class="buymeacoffee-link" href="https://www.buymeacoffee.com/ww24" target="_blank" rel="noopener" @click=${this.handleSupportLink}>
                    <img src="icons/buymeacoffee.png" alt="Buy Me a Coffee">
                </a>
            </div>

            <h2>Feedback</h2>
            <p class="section-description">
                Send feedback directly to the developer. Enabling Bug Tracking does not share any personal information.
            </p>
            <div>
                <label style="line-height: 32px; font-size: 1.5em">
                    Bug Tracking
                    <md-switch 
                        ?selected=${live(this.config.enableBugTracking)} 
                        @input=${this.updateBugTracking}
                    ></md-switch>
                </label>
            </div>
            
            ${!bugTrackingEnabled ? html`
                <p class="warning-message">
                    To send feedback, please enable Bug Tracking above.
                </p>
            ` : ''}
            
            <div class="feedback-form">
                <md-filled-select 
                    label="Feedback Type"
                    ?disabled=${!bugTrackingEnabled || this.isSending}
                    .value=${live(this.feedbackType)}
                    @input=${this.updateFeedbackType}
                >
                    <md-select-option value="bug-report">
                        <div slot="headline">Bug Report</div>
                    </md-select-option>
                    <md-select-option value="feature-request">
                        <div slot="headline">Feature Request / Other</div>
                    </md-select-option>
                </md-filled-select>
                
                <md-filled-text-field 
                    label="Message" 
                    type="textarea"
                    rows="4"
                    ?disabled=${!bugTrackingEnabled || this.isSending}
                    .value=${live(this.feedbackMessage)}
                    @input=${this.updateFeedbackMessage}
                    required
                ></md-filled-text-field>
                <div class="char-count ${isOverLimit ? 'over-limit' : ''}">
                    ${messageCharLength} / ${MAX_MESSAGE_LENGTH} characters
                </div>
                
                <div class="notice">
                    <strong>Important:</strong> Do not include any personal information in your message. 
                    We will not reply to feedback. All feedback is addressed on a best-effort basis.
                </div>

                <md-filled-tonal-button 
                    ?disabled=${!bugTrackingEnabled || this.isSending || !this.isMessageValid()}
                    @click=${this.handleSendFeedback}
                >
                    ${this.isSending ? 'Sending...' : 'Send Feedback'}
                    <md-icon slot="icon">send</md-icon>
                </md-filled-tonal-button>
            </div>
        `
    }

    private async updateBugTracking(e: Event) {
        if (!(e.target instanceof MdSwitch)) return
        this.config.enableBugTracking = e.target.selected
        Settings.setConfiguration(this.config)
        await Settings.syncConfiguration(this.config)
    }

    private updateFeedbackType(e: Event) {
        if (!(e.target instanceof MdFilledSelect)) return
        this.feedbackType = e.target.value as FeedbackType
    }

    private updateFeedbackMessage(e: Event) {
        if (!(e.target instanceof MdFilledTextField)) return
        this.feedbackMessage = e.target.value
    }

    private async handleSendFeedback() {
        if (!this.isMessageValid()) return

        this.isSending = true

        try {
            const message = this.feedbackMessage.trim()
            const feedbackType = this.feedbackType
            const success = sendFeedback({ message, feedbackType })

            const alertDialog = document.getElementById('alert-dialog') as Alert | null
            if (alertDialog) {
                if (success) {
                    // Clear form
                    this.feedbackMessage = ''

                    // Show success message
                    alertDialog.setContent('Information', 'Thank you for your feedback!')
                } else {
                    alertDialog.setContent('Alert', 'Failed to send feedback. Please make sure Bug Tracking is enabled.')
                }
                alertDialog.shadowRoot?.querySelector('md-dialog')?.show()
            }
        } catch (e) {
            const alertDialog = document.getElementById('alert-dialog') as Alert | null
            if (alertDialog) {
                alertDialog.setContent('Alert', 'Failed to send feedback. Please retry.')
                alertDialog.shadowRoot?.querySelector('md-dialog')?.show()
            }
            sendException(e, { exceptionSource: 'option.support.feedback' })
        } finally {
            this.isSending = false
        }
    }

    private handleSupportLink() {
        sendEvent({ type: 'click_external_link', tags: { link: 'support' } })
    }

    private handleReviewLink() {
        sendEvent({ type: 'click_external_link', tags: { link: 'review' } })
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'extension-support': Support
    }
}
