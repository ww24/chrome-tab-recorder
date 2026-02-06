import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'
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
import { Message, SaveConfigSyncMessage } from '../message'
import { sendException } from '../sentry'
import { recordingApi } from '../api_client'
import type { StorageEstimateInfo } from '../storage'
import { Settings } from './settings'
import { Configuration, RecordingSortOrder } from '../configuration'

export interface RecordEntry {
    title: string;
    size: number;
    selected: boolean;
    recordedAt?: Date;
}

/**
 * Get the API URL for a recording file
 */
function getRecordingFileUrl(title: string): string {
    return `/api/recordings/${encodeURIComponent(title)}`
}

function selected(record: RecordEntry): boolean {
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
        .sort-chip {
            min-width: 90px;
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
    private estimate: StorageEstimateInfo

    @property({ type: Array })
    private records: Array<RecordEntry>

    @property()
    private sortOrder: RecordingSortOrder

    public constructor() {
        super()
        this.estimate = { usage: 0, quota: 0 }
        this.records = []
        this.sortOrder = Settings.getConfiguration().recordingSortOrder
    }

    public async connectedCallback() {
        super.connectedCallback()
        await this.updateRecord()
        await this.updateEstimate()
        chrome.runtime.onMessage.addListener(this.handleMessage)
    }

    public disconnectedCallback() {
        super.disconnectedCallback()
        chrome.runtime.onMessage.removeListener(this.handleMessage)
    }

    private handleMessage = async (message: Message) => {
        try {
            switch (message.type) {
                case 'complete-recording':
                    await this.updateRecord()
                    await this.updateEstimate()
                    return
            }
        } catch (e) {
            sendException(e, { exceptionSource: 'option.recordList.onMessage' })
            console.error(e)
        }
    }

    public render() {
        const row = (record: RecordEntry, idx: number) => {
            const fileUrl = getRecordingFileUrl(record.title)
            const downloadUrl = `${fileUrl}?download=true`
            return html`
            ${idx > 0 ? html`<md-divider></md-divider>` : ''}
            <md-list-item class="list-item">
                <md-checkbox touch-target="wrapper" slot="start" ?checked=${record.selected} @input=${this.selectRecord(record)}></md-checkbox>
                <a href="${downloadUrl}">${record.title}</a>
                <div class="meta" title="file size"><md-icon>storage</md-icon> ${formatNum(record.size / 1024 / 1024, 2)} MB</div>
                ${record.recordedAt != null ? html`<div class="meta" title="recorded at"><md-icon>schedule</md-icon> ${RecordList.dateTimeFormat.format(record.recordedAt)}</div>` : ''}
                <md-filled-icon-button slot="end" @click=${this.playRecord(record)}>
                    <md-icon>play_arrow</md-icon>
                </md-filled-icon-button>
            </md-list-item>`
        }
        const est = this.estimate
        const usage = est.usage
        const quota = est.quota || 1
        const sortIcon = this.sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'
        const sortLabel = this.sortOrder.toUpperCase()
        return html`
        <h2 class="storage-heading">
        Storage (total: ${formatNum(usage / 1024 / 1024, 1)} MB, ${formatRate(usage / quota, 1)})
        </h2>
        <md-chip-set class="selected-actions">
            <md-filter-chip label="Select all" has-icon="true" ?disabled=${this.records.length === 0} ?selected=${this.records.length > 0 && this.records.every(selected)} @click=${this.selectAll}>
                <md-icon slot="icon">check_box_outline_blank</md-icon>
            </md-filter-chip>
            <md-assist-chip class="sort-chip" label="${sortLabel}" has-icon="true" @click=${this.toggleSortOrder}>
                <md-icon slot="icon">${sortIcon}</md-icon>
            </md-assist-chip>
            <md-assist-chip label="Save" ?disabled=${!this.records.some(selected)} @click=${this.saveSelectedRecords}>
                <md-icon slot="icon">save</md-icon>
            </md-assist-chip>
            <md-assist-chip label="Delete" ?disabled=${!this.records.some(selected)} @click=${this.deleteSelectedRecords}>
                <md-icon slot="icon">delete</md-icon>
            </md-assist-chip>
        </md-chip-set>
        <md-list>
            ${this.records.length === 0 ? html`<md-list-item>no entry</md-list-item>` : repeat(this.records, record => record.title, row)}
        </md-list>`
    }

    private removeRecord(record: RecordEntry) {
        this.records = this.records.filter(r => r.title !== record.title)
    }
    private async updateRecord() {
        // Fetch recordings from API
        const recordings = await recordingApi.listRecordings({ sort: this.sortOrder })

        const result: Array<RecordEntry> = recordings.map(meta => ({
            title: meta.title,
            size: meta.size,
            selected: false,
            recordedAt: meta.recordedAt != null ? new Date(meta.recordedAt) : undefined,
        }))

        const oldVal = [...this.records]
        this.records = result
        this.requestUpdate('records', oldVal)
    }
    private async updateEstimate() {
        const oldVal = this.estimate
        this.estimate = await recordingApi.getStorageEstimate()
        this.requestUpdate('estimate', oldVal)
    }
    private async toggleSortOrder() {
        const newOrder: RecordingSortOrder = this.sortOrder === 'asc' ? 'desc' : 'asc'
        this.sortOrder = newOrder

        // Save to configuration
        const config = Settings.getConfiguration()
        config.recordingSortOrder = newOrder
        Settings.setConfiguration(config)

        // Sync to remote storage
        const msg: SaveConfigSyncMessage = {
            type: 'save-config-sync',
            data: Configuration.filterForSync(config),
        }
        await chrome.runtime.sendMessage(msg)

        // Refresh the list with new sort order
        await this.updateRecord()
    }
    private playRecord(record: RecordEntry) {
        return () => {
            const fileUrl = getRecordingFileUrl(record.title)
            window.open(fileUrl, '_blank', 'popup=true')
        }
    }
    private selectRecord(record: RecordEntry) {
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

        const selectedRecords = this.records.filter(selected)

        for (const record of selectedRecords) {
            console.log('Copy:', record.title)
            const fileHandle = await dirHandle.getFileHandle(record.title, { create: true })
            const blob = await recordingApi.getRecordingFile(record.title)
            if (!blob) {
                console.error('File not found:', record.title)
                continue
            }
            const writableStream = await fileHandle.createWritable()
            try {
                await blob.stream().pipeTo(writableStream)
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
                try {
                    await Promise.all(selectedRecords.map(async record => {
                        console.log('Delete:', record.title)

                        // Delete via API
                        await recordingApi.deleteRecording(record.title)
                        // remove from UI
                        this.removeRecord(record)
                    }))

                    // update UI
                    this.updateEstimate()
                } catch (e) {
                    sendException(e, { exceptionSource: 'option.recordList.delete.dialog' })
                }
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
