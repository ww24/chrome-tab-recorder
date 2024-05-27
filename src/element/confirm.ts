import { LitElement, html } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import '@material/web/icon/icon'
import '@material/web/dialog/dialog'
import '@material/web/button/text-button'
import '@material/web/button/filled-tonal-button'
import { formatNum } from './util'
import { Record } from './recordList'

@customElement('extension-confirm')
export default class Confirm extends LitElement {
  @property({ noAccessor: true })
  private record: Record

  public constructor() {
    super()
    this.record = {
      title: '',
      size: 0,
    }
  }

  public render() {
    return html`
        <md-dialog style="max-width: 480px;">
          <div slot="headline">Permanently delete?</div>
          <md-icon slot="icon">delete_outline</md-icon>
          <form id="form" slot="content" method="dialog">
            Deleting the selected record will remove permanently.<br>
            record: ${this.record.title} (size: ${formatNum(this.record.size / 1024 / 1024, 2)} MB)
          </form>
          <div slot="actions">
            <md-text-button form="form" value="delete">Delete</md-text-button>
            <md-filled-tonal-button form="form" value="cancel" autofocus>Cancel</md-filled-tonal-button>
          </div>
        </md-dialog>
      `
  }

  public setRecord(record: Record) {
    const oldVal = this.record
    this.record = record
    this.requestUpdate('record', oldVal)
  }
};

declare global {
  interface HTMLElementTagNameMap {
    'extension-confirm': Confirm;
  }
}
