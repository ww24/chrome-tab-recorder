import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@material/web/dialog/dialog'
import '@material/web/button/text-button'

@customElement('extension-alert')
export default class Alert extends LitElement {
  static override readonly styles = css`
    md-dialog {
      width: 520px;
      --md-dialog-container-color: var(--theme-dialog-bg, var(--md-sys-color-surface-container-high));
    }
  `

  @property({ noAccessor: true })
  private headline: string = 'Alert'

  @property({ noAccessor: true })
  private content: string = ''

  public constructor() {
    super()
  }

  public override render() {
    return html`
        <md-dialog>
          <div slot="headline">${this.headline}</div>
          <form id="form" slot="content" method="dialog">
            ${this.content.split('\n').map(p => html`<p>${p}</p>`)}
          </form>
          <div slot="actions">
            <md-text-button form="form" value="ok" autofocus>OK</md-text-button>
          </div>
        </md-dialog>
      `
  }

  public setContent(headline: string, content: string) {
    const oldHeadline = this.headline
    this.headline = headline
    this.requestUpdate('headline', oldHeadline)
    const oldContent = this.content
    this.content = content
    this.requestUpdate('content', oldContent)
  }
};

declare global {
  interface HTMLElementTagNameMap {
    'extension-alert': Alert;
  }
}
