import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { formatNum, formatRate, checkFileHandlePermission } from './util'
import '@material/web/list/list'
import '@material/web/list/list-item'
import '@material/web/divider/divider'
import '@material/web/icon/icon'
import '@material/web/iconbutton/filled-icon-button'
import '@material/web/button/filled-tonal-button'
import '@material/web/chips/chip-set'
import '@material/web/chips/assist-chip'
import '@material/web/chips/filter-chip'
import { MdDialog } from '@material/web/dialog/dialog'
import { MdCheckbox } from '@material/web/checkbox/checkbox'
import { MdFilterChip } from '@material/web/chips/filter-chip'
import Confirm from './confirm'
import type { ShowDirectoryPickerOptions } from '../type'
import { Message } from '../message'
import { sendException } from '../sentry'

export interface Record {
    title: string;
    size: number;
    file?: File;
    selected: boolean;
}

function selected(record: Record): boolean {
    return record.selected
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
        .selected-actions {
            margin: 1em 0;
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
        this.updateRecord()
        this.updateEstimate()

        chrome.runtime.onMessage.addListener(async (message: Message) => {
            try {
                switch (message.type) {
                    case 'complete-recording':
                        await this.updateRecord()
                        await this.updateEstimate()
                        return
                }
            } catch (e) {
                sendException(e)
                console.error(e)
            }
        })
    }

    public render() {
        const row = (record: Record, idx: number) => {
            if (record.file == null) return

            const uri = URL.createObjectURL(record.file)
            return html`
            ${idx > 0 ? html`<md-divider></md-divider>` : html``}
            <md-list-item>
                <span>${idx + 1}. </span>
                <a href="${uri}" download="${record.title}">${record.title}</a>
                <div slot="end">(size: ${formatNum(record.size / 1024 / 1024, 2)} MB)</div>
                <md-checkbox touch-target="wrapper" slot="start" ?checked=${record.selected} @input=${this.selectRecord(record)}></md-checkbox>
                <md-filled-icon-button slot="end" @click=${this.playRecord(record)}>
                    <md-icon>play_arrow</md-icon>
                </md-filled-icon-button>
            </md-list-item>`
        }
        const est = this.estimate
        const usage = est.usage ?? 0
        const quota = est.quota ?? 1
        return html`
        <h2 class="storage-heading">
        Storage (total: ${formatNum(usage / 1024 / 1024, 1)} MB, ${formatRate(usage / quota, 1)})
        </h2>
        <md-chip-set class="selected-actions">
            <md-filter-chip label="Select all" has-icon="true" ?disabled=${this.records.length === 0} ?selected=${this.records.length > 0 && this.records.every(selected)} @click=${this.selectAll}>
                <md-icon slot="icon">check_box_outline_blank</md-icon>
            </md-filter-chip>
            <md-assist-chip label="Save" ?disabled=${!this.records.some(selected)} @click=${this.saveSelectedRecords}>
                <md-icon slot="icon">save</md-icon>
            </md-assist-chip>
            <md-assist-chip label="Delete" ?disabled=${!this.records.some(selected)} @click=${this.deleteSelectedRecords}>
                <md-icon slot="icon">delete</md-icon>
            </md-assist-chip>
        </md-chip-set>
        <md-list>
            ${this.records.length === 0 ? html`<md-list-item>no entry</md-list-item>` : this.records.map(row)}
        </md-list>`
    }

    private removeRecord(record: Record) {
        this.records = this.records.filter(r => r.title !== record.title)
    }
    private async updateRecord() {
        const opfsRoot = await navigator.storage.getDirectory()
        const result: Array<Record> = []
        for await (const [name, handle] of opfsRoot.entries()) {
            const file = await handle.getFile()
            result.unshift({
                title: name,
                file: file,
                size: file.size,
                selected: false,
            })
        }
        const oldVal = [...this.records]
        this.records = result
        this.requestUpdate('records', oldVal)
    }
    private async updateEstimate() {
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
    private selectRecord(record: Record) {
        return (e: Event) => {
            if (!(e.target instanceof MdCheckbox)) return
            const oldVal = [...this.records]
            record.selected = e.target.checked
            this.requestUpdate('records', oldVal)
        }
    }
    private selectAll(e: Event) {
        if (!(e.target instanceof MdFilterChip)) return
        const selected = e.target.selected
        const oldVal = [...this.records]
        this.records = this.records.map(record => {
            record.selected = selected
            return record
        })
        this.requestUpdate('records', oldVal)
    }
    private async saveSelectedRecords() {
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

        const recordsMap = new Map<string, boolean>()
        this.records.filter(selected).forEach(record => {
            recordsMap.set(record.title, true)
        })

        const opfsRoot = await navigator.storage.getDirectory()
        for await (const [name, handle] of opfsRoot.entries()) {
            if (!recordsMap.get(name)) {
                continue
            }
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
        console.log('done')
    }
    private deleteSelectedRecords() {
        const dialogWrapper = document.getElementById('confirm-dialog') as Confirm
        const selectedRecords = this.records.filter(selected)
        dialogWrapper.setRecords(selectedRecords)

        if (dialogWrapper.shadowRoot == null) return
        const dialog = dialogWrapper.shadowRoot.children[0] as MdDialog
        const listener = async () => {
            dialog.removeEventListener('close', listener)

            console.log('confirm-dialog:', dialog.returnValue)
            if (dialog.returnValue === 'delete') {
                const opfsRoot = await navigator.storage.getDirectory()
                await Promise.all(selectedRecords.map(async record => {
                    console.log('Delete:', record.title)

                    // remove entry from file system
                    await opfsRoot.removeEntry(record.title)
                    // remove from UI
                    this.removeRecord(record)
                }))

                // update UI
                this.updateEstimate()
            }
            dialog.returnValue = ''
        }
        dialog.addEventListener('close', listener)
        dialog.show()
    }
}

export default RecordList

declare global {
    interface HTMLElementTagNameMap {
        'record-list': RecordList;
    }
}
