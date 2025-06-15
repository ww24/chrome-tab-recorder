import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@material/web/dialog/dialog'
import '@material/web/button/text-button'

@customElement('extension-alert')
export default class Alert extends LitElement {
    static readonly styles = css`
    md-dialog {
      width: 520px;
    }
  `

    @property({ noAccessor: true })
    private content: string = ''

    public constructor() {
        super()
    }

    public render() {
        return html`
        <md-dialog>
          <div slot="headline">Alert</div>
          <form id="form" slot="content" method="dialog">
            ${this.content.split('\n').map(p => html`<p>${p}</p>`)}
          </form>
          <div slot="actions">
            <md-text-button form="form" value="ok" autofocus>OK</md-text-button>
          </div>
        </md-dialog>
      `
    }

    public setContent(content: string) {
        const oldVal = this.content
        this.content = content
        this.requestUpdate('content', oldVal)
    }
};

declare global {
    interface HTMLElementTagNameMap {
        'extension-alert': Alert;
    }
}
