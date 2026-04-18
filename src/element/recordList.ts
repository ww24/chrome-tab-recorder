import { html, css, LitElement } from 'lit'
import { customElement, property, state } from 'lit/decorators.js'
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
import Alert from './alert'
import type { ShowDirectoryPickerOptions } from '../type'
import { Message, SaveConfigSyncMessage, RequestRecordingStateMessage } from '../message'
import { sendException } from '../sentry'
import { recordingApi } from '../api_client'
import type { StorageEstimateInfo } from '../storage'
import { Settings } from './settings'
import { Configuration, RecordingSortOrder } from '../configuration'
import { formatElapsedTime } from '../format'
import { t } from '../i18n'

export interface RecordEntry {
    title: string;
    size: number;
    selected: boolean;
    recordedAt?: Date;
    isRecording: boolean;
    subFiles: string[];  // Related audio separation files (e.g. video-{ts}-tab.ogg, video-{ts}-mic.ogg)
    subFilesSize: number; // Total size of sub-files in bytes
}

/**
 * Get the API URL for a recording file
 */
function getRecordingFileUrl(title: string): string {
    return `/api/recordings/${encodeURIComponent(title)}`
}

/** Pattern to extract startAtMs and optional suffix (tab/mic) from filename */
const filePattern = /^video-([0-9]+)(?:-(tab|mic))?\./

function isSubFile(title: string): boolean {
    const m = title.match(filePattern)
    return m != null && m[2] != null
}

function isSelected(record: RecordEntry): boolean {
    return record.selected
}

@customElement('record-list')
export class RecordList extends LitElement {
    static override readonly styles = css`
        md-list {
            --md-list-container-color: var(--theme-surface, #f4fbfa);
            --md-list-item-label-text-color: var(--theme-text, #161d1d);
            --md-list-item-supporting-text-color: var(--theme-text-secondary, #3f4948);
            --md-list-item-trailing-supporting-text-color: var(--theme-text-secondary, #3f4948);
            --md-list-item-label-text-font: system-ui;
            --md-list-item-supporting-text-font: system-ui;
            --md-list-item-trailing-supporting-text-font: system-ui;
        }
        .meta {
            display: flex;
            align-items: center;
            color: var(--theme-text-secondary, inherit);
        }
        .meta > md-icon {
            padding: 1px 2px 1px 0;
        }

        .storage-heading {
            height: 40px;
            line-height: 40px;
            color: var(--theme-text, inherit);
        }
        .selected-actions {
            margin: 1em 0;
        }
        .sort-chip {
            min-width: 90px;
        }
        .list-item {
            font-variant-numeric: tabular-nums;
        }
        .recording {
            color: var(--theme-recording, #d93025);
        }
        .elapsed-time {
            margin-left: 0.25em;
        }
        .elapsed-blink {
            animation: blink 1s step-end infinite;
        }
        @keyframes blink {
            50% { visibility: hidden; }
        }
        @media (prefers-reduced-motion: reduce) {
            .elapsed-blink {
                animation: none;
            }
        }
        .sub-file-icon {
            color: var(--theme-text-secondary, #3f4948);
            margin-left: 4px;
            vertical-align: middle;
        }
        .separated-size {
            margin-left: 0.25em;
        }
        a {
            color: var(--theme-link, inherit);
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

    @state()
    private elapsedTimeText: string = formatElapsedTime(0)

    @state()
    private timerStopText: string = ''

    private recordingStartAtMs: number | null = null
    private recordingStopAtMs: number | null = null
    private recordingPaused: boolean = false
    private recordingTotalPausedMs: number = 0
    private elapsedTimerId?: ReturnType<typeof setInterval>

    public constructor() {
        super()
        this.estimate = { usage: 0, quota: 0 }
        this.records = []
        this.sortOrder = Settings.getConfiguration().recordingSortOrder
    }

    override connectedCallback() {
        super.connectedCallback()
        chrome.runtime.onMessage.addListener(this.handleMessage);
        (async () => {
            await this.updateRecord()
            this.syncElapsedTimer()
            await this.updateEstimate()
            await this.checkStoredRecordingError()
            // Request current recording state to get accurate pause info
            const msg: RequestRecordingStateMessage = { type: 'request-recording-state' }
            await chrome.runtime.sendMessage(msg)
        })().catch(e => {
            console.error(e)
            sendException(e, { exceptionSource: 'option.recordList.connectedCallback' })
        })
    }

    override disconnectedCallback() {
        super.disconnectedCallback()
        chrome.runtime.onMessage.removeListener(this.handleMessage)
        this.stopElapsedTimer()
    }

    // NOTE: Must not return true or a truthy value (e.g. Promise from async function)
    // to avoid interfering with sendMessage responses from other contexts.
    private handleMessage = (message: Message) => {
        if (message.type !== 'recording-state') return;
        (async () => {
            const recordingState = message.data
            if (recordingState.isRecording && recordingState.startAtMs != null) {
                this.recordingTotalPausedMs = recordingState.totalPausedMs ?? 0
                if (recordingState.isPaused) {
                    this.recordingPaused = true
                    this.pauseElapsedTimer(recordingState.startAtMs)
                } else {
                    this.recordingPaused = false
                    this.startElapsedTimer(recordingState.startAtMs)
                }
                this.recordingStopAtMs = recordingState.stopAtMs ?? null
                this.updateTimerStopText()
            } else {
                this.stopElapsedTimer()
            }
            await this.updateRecord()
            await this.updateEstimate()
            await this.checkStoredRecordingError()
        })().catch(e => {
            console.error(e)
            sendException(e, { exceptionSource: 'option.recordList.onMessage' })
        })
    }

    private async checkStoredRecordingError() {
        try {
            const result = await chrome.storage.local.get('lastRecordingError')
            const lastRecordingError = result.lastRecordingError as string | undefined
            if (lastRecordingError) {
                await chrome.storage.local.remove('lastRecordingError')
                RecordList.showRecordingError(lastRecordingError)
            }
        } catch (e) {
            console.error(e)
            sendException(e, { exceptionSource: 'option.recordList.checkStoredRecordingError' })
        }
    }

    private static showRecordingError(error: string) {
        const alertDialog = document.getElementById('alert-dialog') as Alert | null
        if (alertDialog == null) return
        alertDialog.setContent(t('recordListRecordingFailed'), error)
        const dialog = alertDialog.shadowRoot?.querySelector('md-dialog') as MdDialog | null
        dialog?.show()
    }

    public override render() {
        const row = (record: RecordEntry, idx: number) => {
            const fileUrl = getRecordingFileUrl(record.title)
            const downloadUrl = `${fileUrl}?download=true`
            return html`
            ${idx > 0 ? html`<md-divider></md-divider>` : ''}
            <md-list-item class="list-item">
                <md-checkbox touch-target="wrapper" slot="start" ?disabled=${record.isRecording} ?checked=${record.selected} @input=${this.selectRecord(record)}></md-checkbox>
                ${record.isRecording
                    ? html`<span aria-disabled="true">${record.title}</span>`
                    : html`<a href="${downloadUrl}">${record.title}</a>`}
                ${record.isRecording ? '' : record.subFiles.map(sub => {
                        const subUrl = `${getRecordingFileUrl(sub)}?download=true`
                        const label = sub.includes('-tab') ? t('recordListTabAudio') : t('recordListMicAudio')
                        const icon = sub.includes('-tab') ? 'headphones' : 'mic'
                        return html`<a href="${subUrl}" title="${label}" aria-label="${t('recordListDownloadLabel', label)}" class="sub-file-icon"><md-icon>${icon}</md-icon></a>`
                    })}
                <div class="meta" title=${t('recordListTitleFileSize')}><md-icon>storage</md-icon> ${formatNum((record.size + record.subFilesSize) / 1024 / 1024, 2)} MB ${record.subFilesSize > 0 ? html` <span class="separated-size" title=${t('recordListTitleSeparatedSize')}>(${t('recordListSeparatedSize', formatNum(record.subFilesSize / 1024 / 1024, 2))})</span>` : ''}</div>
                ${record.recordedAt != null ? html`<div class="meta" title=${t('recordListTitleRecordedAt')}><md-icon>schedule</md-icon> ${RecordList.dateTimeFormat.format(record.recordedAt)}</div>` : ''}
                ${record.isRecording ? html`<div class="meta recording" title=${t('recordListTitleRecording')}><md-icon>screen_record</md-icon> ${this.recordingPaused ? t('recordListPaused') : t('recordListRecording')} <span class="elapsed-time${this.recordingPaused ? ' elapsed-blink' : ''}">${this.elapsedTimeText}</span>${this.timerStopText ? html` <span title=${t('recordListTitleTimerStop')}>(⏱ ${this.recordingPaused ? t('recordListTimerPaused') : t('recordListTimerStopsAt', this.timerStopText)})</span>` : ''}</div>` : ''}
                <md-filled-icon-button slot="end" ?disabled=${record.isRecording} @click=${this.playRecord(record)}>
                    <md-icon>play_arrow</md-icon>
                </md-filled-icon-button>
            </md-list-item>`
        }
        const est = this.estimate
        const usage = est.usage
        const quota = est.quota || 1
        const sortIcon = this.sortOrder === 'asc' ? 'arrow_upward' : 'arrow_downward'
        const sortLabel = this.sortOrder === 'asc' ? t('recordListSortAsc') : t('recordListSortDesc')
        return html`
        <h2 class="storage-heading">
        ${t('recordListStorage', [formatNum(usage / 1024 / 1024, 1), formatRate(usage / quota, 1)])}
        </h2>
        <md-chip-set class="selected-actions">
            <md-filter-chip label=${t('recordListSelectAll')} has-icon="true" ?disabled=${this.records.length === 0} ?selected=${this.records.length > 0 && this.records.every(isSelected)} @click=${this.selectAll}>
                <md-icon slot="icon">check_box_outline_blank</md-icon>
            </md-filter-chip>
            <md-assist-chip class="sort-chip" label="${sortLabel}" has-icon="true" @click=${this.toggleSortOrder}>
                <md-icon slot="icon">${sortIcon}</md-icon>
            </md-assist-chip>
            <md-assist-chip label=${t('recordListSave')} ?disabled=${!this.records.some(isSelected)} @click=${this.saveSelectedRecords}>
                <md-icon slot="icon">save</md-icon>
            </md-assist-chip>
            <md-assist-chip label=${t('recordListDelete')} ?disabled=${!this.records.some(isSelected)} @click=${this.deleteSelectedRecords}>
                <md-icon slot="icon">delete</md-icon>
            </md-assist-chip>
        </md-chip-set>
        <md-list>
            ${this.records.length === 0 ? html`<md-list-item>${t('recordListNoEntry')}</md-list-item>` : repeat(this.records, record => record.title, row)}
        </md-list>`
    }

    private removeRecord(record: RecordEntry) {
        this.records = this.records.filter(r => r.title !== record.title)
    }
    private async updateRecord() {
        // Fetch recordings from API
        const recordings = await recordingApi.listRecordings({ sort: this.sortOrder })

        // Group sub-files by startAtMs
        const subFileMap = new Map<string, string[]>() // startAtMs -> sub-file titles
        const subFileSizeMap = new Map<string, number>() // startAtMs -> total sub-file size
        for (const meta of recordings) {
            const m = meta.title.match(filePattern)
            if (m && m[2] != null) {
                const ts = m[1]
                const arr = subFileMap.get(ts) ?? []
                arr.push(meta.title)
                subFileMap.set(ts, arr)
                subFileSizeMap.set(ts, (subFileSizeMap.get(ts) ?? 0) + meta.size)
            }
        }

        const result: Array<RecordEntry> = recordings.filter(meta => {
            if (isSubFile(meta.title)) return false  // Exclude sub-files from main list
            return !meta.isRecording || meta.isTemporary
        }).map(meta => {
            const m = meta.title.match(filePattern)
            const ts = m?.[1]
            return {
                title: meta.title,
                size: meta.size,
                selected: false,
                recordedAt: meta.recordedAt != null ? new Date(meta.recordedAt) : undefined,
                isRecording: meta.isRecording ?? false,
                subFiles: ts ? (subFileMap.get(ts) ?? []) : [],
                subFilesSize: ts ? (subFileSizeMap.get(ts) ?? 0) : 0,
            }
        })

        const oldVal = [...this.records]
        this.records = result
        this.requestUpdate('records', oldVal)
    }
    private async updateEstimate() {
        const oldVal = this.estimate
        this.estimate = await recordingApi.getStorageEstimate()
        this.requestUpdate('estimate', oldVal)
    }

    private syncElapsedTimer() {
        const recordingEntry = this.records.find(r => r.isRecording && r.recordedAt)
        if (recordingEntry?.recordedAt) {
            this.startElapsedTimer(recordingEntry.recordedAt.getTime())
        }
    }

    private startElapsedTimer(startAtMs: number) {
        if (this.recordingStartAtMs === startAtMs && this.elapsedTimerId != null) return
        if (this.elapsedTimerId != null) {
            clearInterval(this.elapsedTimerId)
            this.elapsedTimerId = undefined
        }
        this.recordingStartAtMs = startAtMs
        this.updateElapsedTime()
        this.elapsedTimerId = setInterval(() => this.updateElapsedTime(), 1000)
    }

    private pauseElapsedTimer(startAtMs: number) {
        if (this.elapsedTimerId != null) {
            clearInterval(this.elapsedTimerId)
            this.elapsedTimerId = undefined
        }
        this.recordingStartAtMs = startAtMs
        this.updateElapsedTime()
    }

    private stopElapsedTimer() {
        if (this.elapsedTimerId != null) {
            clearInterval(this.elapsedTimerId)
            this.elapsedTimerId = undefined
        }
        this.recordingStartAtMs = null
        this.recordingStopAtMs = null
        this.recordingPaused = false
        this.recordingTotalPausedMs = 0
        this.elapsedTimeText = ''
        this.timerStopText = ''
    }

    private updateElapsedTime() {
        if (this.recordingStartAtMs == null) return
        const elapsed = Date.now() - this.recordingStartAtMs - this.recordingTotalPausedMs
        this.elapsedTimeText = formatElapsedTime(elapsed)
        this.updateTimerStopText()
    }

    private updateTimerStopText() {
        if (this.recordingStopAtMs == null) {
            this.timerStopText = ''
            return
        }
        this.timerStopText = new Date(this.recordingStopAtMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
            if (record.isRecording) return record // ignore recording entry
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

        const selectedRecords = this.records.filter(isSelected)

        for (const record of selectedRecords) {
            // Save main file
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
            // Save related sub-files
            for (const subFile of record.subFiles) {
                console.log('Copy sub-file:', subFile)
                const subHandle = await dirHandle.getFileHandle(subFile, { create: true })
                const subBlob = await recordingApi.getRecordingFile(subFile)
                if (!subBlob) {
                    console.warn('Sub-file not found:', subFile)
                    continue
                }
                const subWritable = await subHandle.createWritable()
                try {
                    await subBlob.stream().pipeTo(subWritable)
                } catch (e) {
                    subWritable.close()
                    throw e
                }
            }
        }
        console.log('done')
    }
    private deleteSelectedRecords() {
        const dialogWrapper = document.getElementById('confirm-dialog') as Confirm
        const selectedRecords = this.records.filter(isSelected)
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

                        // Delete related sub-files first
                        for (const subFile of record.subFiles) {
                            console.log('Delete sub-file:', subFile)
                            await recordingApi.deleteRecording(subFile)
                        }

                        // Delete main file via API
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
