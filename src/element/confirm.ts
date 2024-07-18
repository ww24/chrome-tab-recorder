import { LitElement, css, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@material/web/icon/icon'
import '@material/web/dialog/dialog'
import '@material/web/button/text-button'
import '@material/web/button/filled-tonal-button'
import '@material/web/list/list'
import '@material/web/list/list-item'
import '@material/web/divider/divider'
import { formatNum } from './util'
import { Record } from './recordList'

@customElement('extension-confirm')
export default class Confirm extends LitElement {
  static readonly styles = css`
    md-dialog {
      width: 520px;
    }
  `

  @property({ noAccessor: true })
  private records: Array<Record>

  public constructor() {
    super()
    this.records = []
  }

  public render() {
    return html`
        <md-dialog>
          <div slot="headline">Permanently delete?</div>
          <md-icon slot="icon">delete_outline</md-icon>
          <form id="form" slot="content" method="dialog">
            Deleting the selected record will remove permanently.<br>
            record(s):
            <md-list>
              ${this.records.map((record, i) => html`
                  ${i > 0 ? html`<md-divider></md-divider>` : html``}
                  <md-list-item>${record.title} <div slot="end">(size: ${formatNum(record.size / 1024 / 1024, 2)} MB)</div></md-list-item>
              `)}
            </md-list>
          </form>
          <div slot="actions">
            <md-text-button form="form" value="delete">Delete</md-text-button>
            <md-filled-tonal-button form="form" value="cancel" autofocus>Cancel</md-filled-tonal-button>
          </div>
        </md-dialog>
      `
  }

  public setRecords(records: Array<Record>) {
    const oldVal = [...this.records]
    this.records = records
    this.requestUpdate('records', oldVal)
  }
};

declare global {
  interface HTMLElementTagNameMap {
    'extension-confirm': Confirm;
  }
}
