import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { formatNum, formatRate, checkFileHandlePermission } from './util'
import '@material/web/list/list'
import '@material/web/list/list-item'
import '@material/web/divider/divider'
import '@material/web/icon/icon'
import '@material/web/iconbutton/filled-icon-button'
import '@material/web/button/filled-tonal-button'
import { MdDialog } from '@material/web/dialog/dialog'
import Confirm from './confirm'
import type { ShowDirectoryPickerOptions } from '../type'

export interface Record {
    title: string;
    size: number;
    file?: File;
}

@customElement('record-list')
export class RecordList extends LitElement {
    static readonly styles = css`
        md-list {
            max-width: 600px;
            --md-list-container-color: #f4fbfa;
            --md-list-item-label-text-color: #161d1d;
            --md-list-item-supporting-text-color: #3f4948;
            --md-list-item-trailing-supporting-text-color: #3f4948;
            --md-list-item-label-text-font: system-ui;
            --md-list-item-supporting-text-font: system-ui;
            --md-list-item-trailing-supporting-text-font: system-ui;
        }

        .storage-heading {
            height: 40px;
            line-height: 40px;
        }
        .storage-heading > md-filled-tonal-button {
            position: absolute;
            right: 0;
        }
    `

    @property({ noAccessor: true })
    private estimate: StorageEstimate

    @property({ type: Array })
    private records: Array<Record>

    public constructor() {
        super()
        this.estimate = {}
        this.records = []
    }

    public render() {
        let records = this.records
        if (records.length === 0) {
            records = records.concat([{ title: 'no entry', size: 0 }])
        }
        const row = (record: Record, idx: number) => {
            if (record.file == null) {
                return html`<md-list-item>
                    ${record.title}
                </md-list-item><md-divider></md-divider>`
            }

            const uri = URL.createObjectURL(record.file)
            return html`<md-list-item>
                <span>${idx + 1}. </span>
                <a href="${uri}" download="${record.title}">${record.title}</a>
                <span>(size: ${formatNum(record.size / 1024 / 1024, 2)} MB)</span>
                <md-filled-icon-button slot="end" @click=${this.playRecord(record)}>
                    <md-icon>play_arrow</md-icon>
                </md-filled-icon-button>
                <md-filled-icon-button slot="end" @click=${this.deleteRecord(record)}>
                    <md-icon>delete</md-icon>
                </md-filled-icon-button>
            </md-list-item><md-divider></md-divider>`
        }
        const est = this.estimate
        const usage = est.usage ?? 0
        const quota = est.quota ?? 1
        return html`
        <h2 class="storage-heading">
        Storage (total: ${formatNum(usage / 1024 / 1024, 1)} MB, ${formatRate(usage / quota, 1)})
        <md-filled-tonal-button @click=${this.saveAll}>
            Save all records
            <md-icon slot="icon">save</md-icon>
        </md-filled-tonal-button>
        </h2>
        <md-list>
            ${records.map(row)}
        </md-list>`
    }

    public addRecord(record: Record) {
        this.records = [record].concat(this.records)
    }
    private removeRecord(record: Record) {
        this.records = this.records.filter(r => r.title !== record.title)
    }
    public async updateEstimate() {
        const oldVal = this.estimate
        this.estimate = await navigator.storage.estimate()
        this.requestUpdate('estimate', oldVal)
    }
    private playRecord(record: Record) {
        return async () => {
            if (record.file == null) return
            const url = URL.createObjectURL(record.file)
            const win = window.open(url, '_blank', 'popup=true')
            if (win == null) return
            win.addEventListener('visibilitychange', event => {
                if (!event.isTrusted) {
                    return
                }
                setTimeout(() => {
                    if (!win.closed) return
                    console.debug('popup window is closed')
                    URL.revokeObjectURL(url)
                }, 500)
            })
        }
    }
    private deleteRecord(record: Record) {
        return () => {
            const dialogWrapper = document.getElementById('confirm-dialog') as Confirm
            dialogWrapper.setRecord(record)

            if (dialogWrapper.shadowRoot == null) return
            const dialog = dialogWrapper.shadowRoot.children[0] as MdDialog
            const listener = async () => {
                dialog.removeEventListener('close', listener)

                console.log('confirm-dialog:', dialog.returnValue)
                if (dialog.returnValue === 'delete') {
                    console.log('Delete:', record.title)

                    // remove entry from file system
                    const opfsRoot = await navigator.storage.getDirectory()
                    await opfsRoot.removeEntry(record.title)

                    // remove and update UI
                    this.removeRecord(record)
                    this.updateEstimate()
                }
            }
            dialog.addEventListener('close', listener)
            dialog.show()
        }
    }
    private async saveAll() {
        const options: ShowDirectoryPickerOptions = {
            id: 'save-directory',
            mode: 'readwrite',
            startIn: 'downloads',
        }
        const dirHandle = await window.showDirectoryPicker(options)
        const permission = await checkFileHandlePermission(dirHandle)
        if (!permission) {
            throw new Error('permission denied')
        }

        // TODO: 書き出しに時間を要するので、Service Worker  に逃がすか、モーダルで進捗表示する
        const opfsRoot = await navigator.storage.getDirectory()
        for await (const [name, handle] of opfsRoot.entries()) {
            console.log('Copy:', name)
            const fileHandle = await dirHandle.getFileHandle(name, { create: true })
            const file = await handle.getFile()
            const writableStream = await fileHandle.createWritable()
            try {
                await file.stream().pipeTo(writableStream)
            } catch (e) {
                writableStream.close()
                throw e
            }
        }
    }
};

export default RecordList

declare global {
    interface HTMLElementTagNameMap {
        'record-list': RecordList;
    }
}
