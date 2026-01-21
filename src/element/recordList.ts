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
    recordedAt?: Date;
    objectUrl?: string;
}

function selected(record: Record): boolean {
    return record.selected
}

@customElement('record-list')
export class RecordList extends LitElement {
    static readonly styles = css`
        md-list {
            --md-list-container-color: #f4fbfa;
            --md-list-item-label-text-color: #161d1d;
            --md-list-item-supporting-text-color: #3f4948;
            --md-list-item-trailing-supporting-text-color: #3f4948;
            --md-list-item-label-text-font: system-ui;
            --md-list-item-supporting-text-font: system-ui;
            --md-list-item-trailing-supporting-text-font: system-ui;
        }
        .meta {
            display: flex;
            align-items: center;
        }
        .meta > md-icon {
            padding: 1px 2px 1px 0;
        }

        .storage-heading {
            height: 40px;
            line-height: 40px;
        }
        .selected-actions {
            margin: 1em 0;
        }
    `

    private static readonly dateTimeFormat = new Intl.DateTimeFormat(undefined, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })

    @property({ noAccessor: true })
    private estimate: StorageEstimate

    @property({ type: Array })
    private records: Array<Record>

    // Track object URLs created by playRecord
    private playbackUrls: Set<string> = new Set()

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

    public disconnectedCallback() {
        super.disconnectedCallback()
        // Revoke all object URLs when component is destroyed
        this.revokeAllObjectUrls()
    }

    private revokeAllObjectUrls() {
        // Revoke URLs created in render
        this.records.forEach(record => {
            if (record.objectUrl != null) {
                URL.revokeObjectURL(record.objectUrl)
                record.objectUrl = undefined
            }
        })

        // Revoke URLs created in playRecord
        this.playbackUrls.forEach(url => URL.revokeObjectURL(url))
        this.playbackUrls.clear()
    }

    public render() {
        const row = (record: Record, idx: number) => {
            if (record.file == null) return

            // Create object URL only if it doesn't exist
            if (record.objectUrl == null) {
                record.objectUrl = URL.createObjectURL(record.file)
            }
            const uri = record.objectUrl

            return html`
            ${idx > 0 ? html`<md-divider></md-divider>` : ''}
            <md-list-item class="list-item">
                <md-checkbox touch-target="wrapper" slot="start" ?checked=${record.selected} @input=${this.selectRecord(record)}></md-checkbox>
                <a href="${uri}" download="${record.title}">${record.title}</a>
                <div class="meta" title="file size"><md-icon>storage</md-icon> ${formatNum(record.size / 1024 / 1024, 2)} MB</div>
                ${record.recordedAt != null ? html`<div class="meta" title="recorded at"><md-icon>schedule</md-icon> ${RecordList.dateTimeFormat.format(record.recordedAt)}</div>` : ''}
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
        // Revoke object URL before removing the record
        if (record.objectUrl != null) {
            URL.revokeObjectURL(record.objectUrl)
            record.objectUrl = undefined
        }
        this.records = this.records.filter(r => r.title !== record.title)
    }
    private async updateRecord() {
        const opfsRoot = await navigator.storage.getDirectory()
        const result: Array<Record> = []
        const timestampRegex = /^video-([0-9]+)\./

        // Save existing object URLs in a map
        const existingUrls = new Map<string, string>()
        this.records.forEach(record => {
            if (record.objectUrl != null) {
                existingUrls.set(record.title, record.objectUrl)
            }
        })

        for await (const [name, handle] of opfsRoot.entries()) {
            const file = await handle.getFile()

            let recordedAt: Date | undefined
            const matched = name.match(timestampRegex)
            if (matched != null && matched.length >= 2) {
                recordedAt = new Date(Number.parseInt(matched[1], 10))
            }
            const record: Record = {
                title: name,
                file: file,
                size: file.size,
                selected: false,
                recordedAt,
                // Reuse existing URL
                objectUrl: existingUrls.get(name),
            }
            result.unshift(record)
        }

        // Revoke object URLs for removed records
        const newTitles = new Set(result.map(r => r.title))
        this.records.forEach(record => {
            if (!newTitles.has(record.title) && record.objectUrl != null) {
                URL.revokeObjectURL(record.objectUrl)
            }
        })

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
        return () => {
            if (record.file == null || record.objectUrl == null) return
            window.open(record.objectUrl, '_blank', 'popup=true')
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
