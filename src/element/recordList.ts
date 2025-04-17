import { html, css, LitElement } from 'lit'
import { customElement, property } from 'lit/decorators.js'
import { formatNum, formatRate, checkFileHandlePermission } from './util'
import '@material/web/list/list'
import '@material/web/list/list-item'
import '@material/web/divider/divider'
import '@material/web/icon/icon'
import '@material/web/iconbutton/filled-icon-button'
import '@material/web/iconbutton/icon-button'
import '@material/web/button/filled-tonal-button'
import '@material/web/chips/chip-set'
import '@material/web/chips/assist-chip'
import '@material/web/chips/filter-chip'
import '@material/web/textfield/filled-text-field'
import { MdDialog } from '@material/web/dialog/dialog'
import { MdCheckbox } from '@material/web/checkbox/checkbox'
import { MdFilterChip } from '@material/web/chips/filter-chip'
import { MdFilledTextField } from '@material/web/textfield/filled-text-field'
import Confirm from './confirm'
import Settings from './settings'
import type { ShowDirectoryPickerOptions } from '../type'
import { Message } from '../message'
import { sendException } from '../sentry'

export interface Record {
    title: string;
    size: number;
    file?: File;
    selected: boolean;
    recordedAt?: Date;  // Start time
    endTime?: Date;     // End time
    tabTitle?: string;  // Tab title
    editMode?: boolean;
    newTitle?: string;
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
            margin-right: 12px;
        }
        .meta > md-icon {
            padding: 1px 2px 1px 0;
        }

        .storage-heading {
            height: 40px;
            line-height: 40px;
            display: flex;
            align-items: center;
        }
        .selected-actions {
            margin: 1em 0;
        }
        
        .action-buttons {
            display: flex;
            gap: 4px;
        }
        
        .file-name {
            width: 500px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        
        .file-name-secondary {
            font-size: 0.85em;
            color: #666;
            margin-top: 2px;
        }
        
        .edit-field {
            width: 500px;
            --md-filled-text-field-container-height: 40px;
            --md-filled-text-field-container-shape: 4px;
        }
        
        .time-range {
            font-size: 0.85em;
            color: #666;
            margin-left: 4px;
        }
        
        .list-item {
            min-height: 72px;
        }
        
        .refresh-button {
            margin-left: 8px;
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

    private static readonly timeFormat = new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    })

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
            ${idx > 0 ? html`<md-divider></md-divider>` : ''}
            <md-list-item class="list-item">
                <md-checkbox touch-target="wrapper" slot="start" ?checked=${record.selected} @input=${this.selectRecord(record)}></md-checkbox>
                
                ${record.editMode 
                  ? html`
                    <md-filled-text-field
                      class="edit-field"
                      .value=${record.newTitle || record.title}
                      @input=${this.handleTitleInput(record)}
                      @keydown=${this.handleKeyDown(record)}
                      @blur=${this.saveEdit(record)}
                    ></md-filled-text-field>
                  ` 
                  : html`
                    <div class="file-name">
                      <a href="${uri}" download="${record.title}">${record.title}</a>
                      ${record.tabTitle ? html`<div class="file-name-secondary" title="Tab title">${record.tabTitle}</div>` : ''}
                    </div>
                  `}
                
                <div class="meta" title="file size"><md-icon>storage</md-icon> ${formatNum(record.size / 1024 / 1024, 2)} MB</div>
                
                ${record.recordedAt != null ? html`
                    <div class="meta" title="recorded at">
                        <md-icon>schedule</md-icon> 
                        ${RecordList.dateTimeFormat.format(record.recordedAt)}
                        ${record.recordedAt && record.endTime ? html`
                            <span class="time-range" title="Start time - End time">
                                (${RecordList.timeFormat.format(record.recordedAt)} - 
                                ${RecordList.timeFormat.format(record.endTime)})
                            </span>
                        ` : ''}
                    </div>
                ` : ''}
                
                <div slot="end" class="action-buttons">
                    ${record.editMode
                      ? html`
                        <md-filled-icon-button @click=${this.saveEdit(record)}>
                          <md-icon>check</md-icon>
                        </md-filled-icon-button>
                        <md-filled-icon-button @click=${this.cancelEdit(record)}>
                          <md-icon>close</md-icon>
                        </md-filled-icon-button>
                      `
                      : html`
                        <md-filled-icon-button @click=${this.startEdit(record)}>
                          <md-icon>edit</md-icon>
                        </md-filled-icon-button>
                        <md-filled-icon-button @click=${this.playRecord(record)}>
                          <md-icon>play_arrow</md-icon>
                        </md-filled-icon-button>
                      `
                    }
                </div>
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
            <md-assist-chip label="Refresh" @click=${this.refreshRecords}>
                <md-icon slot="icon">refresh</md-icon>
            </md-assist-chip>
        </md-chip-set>
        <md-list>
            ${this.records.length === 0 ? html`<md-list-item>no entry</md-list-item>` : this.records.map(row)}
        </md-list>`
    }
    
    private startEdit(record: Record) {
        return () => {
            // Exit edit mode for other records
            this.records.forEach(r => {
                if (r !== record && r.editMode) {
                    r.editMode = false;
                    delete r.newTitle;
                }
            });
            
            // Enter edit mode
            record.editMode = true;
            record.newTitle = record.title;
            this.requestUpdate();
            
            // Focus the text field
            setTimeout(() => {
                const shadowRoot = this.shadowRoot;
                if (shadowRoot) {
                    const textField = shadowRoot.querySelector('.edit-field') as MdFilledTextField;
                    if (textField) {
                        textField.focus();
                    }
                }
            }, 10);
        };
    }
    
    private handleTitleInput(record: Record) {
        return (e: Event) => {
            if (e.target instanceof MdFilledTextField) {
                record.newTitle = e.target.value;
            }
        };
    }
    
    private handleKeyDown(record: Record) {
        return (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                this.saveEdit(record)();
            } else if (e.key === 'Escape') {
                this.cancelEdit(record)();
            }
        };
    }
    
    private cancelEdit(record: Record) {
        return () => {
            record.editMode = false;
            delete record.newTitle;
            this.requestUpdate();
        };
    }
    
    private saveEdit(record: Record) {
        return async () => {
            if (!record.editMode || !record.newTitle || record.newTitle.trim() === '') {
                this.cancelEdit(record)();
                return;
            }
            
            const newFileName = record.newTitle.trim();
            
            // If filename is unchanged or conflicts with existing files, cancel edit
            if (newFileName === record.title || 
                (newFileName !== record.title && this.records.some(r => r !== record && r.title === newFileName))) {
                this.cancelEdit(record)();
                return;
            }
            
            try {
                const oldFileName = record.title;
                
                // Get OPFS root directory
                const opfsRoot = await navigator.storage.getDirectory();
                
                // Get original file handle and content
                const oldFileHandle = await opfsRoot.getFileHandle(oldFileName);
                const fileContent = await oldFileHandle.getFile();
                
                // Create new file and write content
                const newFileHandle = await opfsRoot.getFileHandle(newFileName, { create: true });
                const writableStream = await newFileHandle.createWritable();
                
                let success = false;
                try {
                    await fileContent.stream().pipeTo(writableStream);
                    success = true;
                } catch (e) {
                    // Stream error, try to close
                    try { 
                        await writableStream.close(); 
                    } catch (closeError) { 
                        console.error('Close error:', closeError); 
                    }
                    throw e;
                }
                
                // Only delete old file after new file is completely written
                if (success) {
                    try {
                        await opfsRoot.removeEntry(oldFileName);
                    } catch (removeError) {
                        console.error('Delete old file error:', removeError);
                        // Continue execution, don't throw error, because new file was created successfully
                    }
                }
                
                // Update records
                await this.updateRecord();
                
                console.log(`File renamed successfully: ${oldFileName} -> ${newFileName}`);
            } catch (error) {
                console.error('Rename file failed:', error);
                // Exit edit mode even on error
                this.cancelEdit(record)();
            }
        };
    }

    // Refresh recording file list
    private async refreshRecords() {
        try {
            await this.updateRecord();
            await this.updateEstimate();
            this.showSuccessToast('File list refreshed');
        } catch (error) {
            console.error('Error refreshing records:', error);
            this.showErrorToast('Refresh failed, please try again');
        }
    }

    // Simple error toast method
    private showErrorToast(message: string) {
        this.showToast(message, '#f44336');
    }

    private removeRecord(record: Record) {
        this.records = this.records.filter(r => r.title !== record.title)
    }
    private async updateRecord() {
        try {
            const opfsRoot = await navigator.storage.getDirectory()
            // Metadata directory name
            const metadataDir = 'metadata';
            
            // Ensure metadata directory exists
            let metadataHandle: FileSystemDirectoryHandle;
            try {
                metadataHandle = await opfsRoot.getDirectoryHandle(metadataDir);
            } catch (error) {
                metadataHandle = await opfsRoot.getDirectoryHandle(metadataDir, { create: true });
            }
            
            const result: Array<Record> = []
            const timestampRegex = /^video-([0-9]+)-([0-9]+)/
            for await (const [name, handle] of opfsRoot.entries()) {
                // Skip metadata directory
                if (name === metadataDir) continue;
                
                const file = await handle.getFile()

                let recordedAt: Date | undefined
                let endTime: Date | undefined
                let tabTitle: string | undefined;
                
                const matched = name.match(timestampRegex)
                if (matched != null && matched.length >= 3) {
                    // Extract start and end time from filename
                    recordedAt = new Date(Number.parseInt(matched[1], 10))
                    const endTimestamp = Number.parseInt(matched[2], 10)
                    endTime = new Date(endTimestamp)
                } else {
                    // Support legacy filename format
                    const oldFormatRegex = /^video-([0-9]+)\./
                    const oldMatched = name.match(oldFormatRegex)
                    if (oldMatched != null && oldMatched.length >= 2) {
                        recordedAt = new Date(Number.parseInt(oldMatched[1], 10))
                        // For legacy format, use file modification time as end time estimate
                        endTime = new Date(file.lastModified)
                    }
                }
                
                // Try to read tab title from metadata file
                try {
                    const metadataFileHandle = await metadataHandle.getFileHandle(`${name}.metadata.json`);
                    const metadataFile = await metadataFileHandle.getFile();
                    const metadata = JSON.parse(await metadataFile.text());
                    tabTitle = metadata.tabTitle;
                } catch (error) {
                    // Ignore if metadata file doesn't exist or can't be read
                    console.debug(`No metadata for ${name}`);
                }
                
                const record: Record = {
                    title: name,
                    file: file,
                    size: file.size,
                    selected: false,
                    recordedAt,
                    endTime,
                    tabTitle
                }
                result.unshift(record)
            }
            const oldVal = [...this.records]
            this.records = result
            this.requestUpdate('records', oldVal)
        } catch (error) {
            console.error('Error updating records:', error);
            this.showErrorToast('Failed to load recording list');
        }
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
        try {
            // Get configuration
            const config = Settings.getConfiguration();
            let dirHandle;
            
            if (config.saveToDefaultPath && config.defaultSavePath) {
                // Get directory handle from IndexedDB
                try {
                    dirHandle = await this.getDefaultDirHandle();
                    
                    // Check permissions
                    const permission = await checkFileHandlePermission(dirHandle);
                    if (!permission) {
                        console.warn('Permission denied for default save path, falling back to directory picker');
                        this.showErrorToast('Permission denied for default path, please select another directory');
                        dirHandle = null;
                    }
                } catch (error) {
                    console.error('Error accessing default save path:', error);
                    this.showErrorToast('Cannot access default save path, please select another directory');
                    dirHandle = null;
                }
            }
            
            // If default path is unavailable or disabled, use directory picker
            if (!dirHandle) {
                const options: ShowDirectoryPickerOptions = {
                    id: 'save-directory',
                    mode: 'readwrite',
                    startIn: 'downloads',
                }
                try {
                    dirHandle = await window.showDirectoryPicker(options);
                } catch (error) {
                    console.error('User cancelled directory selection');
                    return;
                }
                
                const permission = await checkFileHandlePermission(dirHandle);
                if (!permission) {
                    this.showErrorToast('Folder access permission denied');
                    throw new Error('Permission denied');
                }
            }

            const recordsMap = new Map<string, boolean>();
            const selectedRecords = this.records.filter(selected);
            
            if (selectedRecords.length === 0) {
                this.showErrorToast('Please select files to save first');
                return;
            }
            
            selectedRecords.forEach(record => {
                recordsMap.set(record.title, true);
            });

            const opfsRoot = await navigator.storage.getDirectory();
            let successCount = 0;
            let failCount = 0;
            
            for await (const [name, handle] of opfsRoot.entries()) {
                if (!recordsMap.get(name)) {
                    continue;
                }
                
                try {
                    console.log('Copy:', name);
                    const fileHandle = await dirHandle.getFileHandle(name, { create: true });
                    const file = await handle.getFile();
                    const writableStream = await fileHandle.createWritable();
                    
                    try {
                        await file.stream().pipeTo(writableStream);
                        successCount++;
                    } catch (e) {
                        await writableStream.close();
                        failCount++;
                        console.error(`Error saving file ${name}:`, e);
                    }
                } catch (e) {
                    failCount++;
                    console.error(`Error creating file ${name}:`, e);
                }
            }
            
            if (successCount > 0 && failCount === 0) {
                this.showSuccessToast(`Successfully saved ${successCount} files`);
            } else if (successCount > 0 && failCount > 0) {
                this.showWarningToast(`Saved ${successCount} files, ${failCount} failed`);
            } else if (failCount > 0) {
                this.showErrorToast(`Save failed: ${failCount} files could not be saved`);
            }
            
            console.log(`Save completed. Success: ${successCount}, Failed: ${failCount}`);
        } catch (error) {
            console.error('Save operation failed:', error);
            this.showErrorToast('Save operation failed, please try again');
        }
    }
    
    // Get default save directory handle from IndexedDB
    private async getDefaultDirHandle(): Promise<FileSystemDirectoryHandle> {
        const dbName = 'directoryHandlesDB';
        const storeName = 'directoryHandles';
        const key = 'defaultSavePath';
        
        return new Promise<FileSystemDirectoryHandle>((resolve, reject) => {
            try {
                const request = indexedDB.open(dbName, 1);
                
                request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
                    const db = (event.target as IDBOpenDBRequest).result;
                    if (!db.objectStoreNames.contains(storeName)) {
                        db.createObjectStore(storeName);
                    }
                };
                
                request.onsuccess = async (event: Event) => {
                    try {
                        const db = (event.target as IDBOpenDBRequest).result;
                        const transaction = db.transaction(storeName, 'readonly');
                        const objectStore = transaction.objectStore(storeName);
                        
                        const getRequest = objectStore.get(key);
                        
                        getRequest.onsuccess = async () => {
                            if (getRequest.result) {
                                try {
                                    // Try to validate if handle is valid
                                    await getRequest.result.queryPermission({ mode: 'read' });
                                    resolve(getRequest.result);
                                } catch (permError) {
                                    reject(new Error('Directory handle permission error: ' + (permError as Error).message));
                                }
                            } else {
                                reject(new Error('No default directory handle found'));
                            }
                        };
                        
                        getRequest.onerror = (error: Event) => {
                            reject(error);
                        };
                    } catch (innerError) {
                        reject(innerError);
                    }
                };
                
                request.onerror = (error: Event) => {
                    reject(error);
                };
            } catch (outerError) {
                reject(outerError);
            }
        });
    }
    
    // Success toast
    private showSuccessToast(message: string) {
        this.showToast(message, '#4caf50');
    }

    // Warning toast
    private showWarningToast(message: string) {
        this.showToast(message, '#ff9800');
    }

    // Generic toast method
    private showToast(message: string, backgroundColor: string) {
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.position = 'fixed';
        toast.style.bottom = '20px';
        toast.style.left = '50%';
        toast.style.transform = 'translateX(-50%)';
        toast.style.backgroundColor = backgroundColor;
        toast.style.color = 'white';
        toast.style.padding = '10px 20px';
        toast.style.borderRadius = '4px';
        toast.style.zIndex = '1000';
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            document.body.removeChild(toast);
        }, 3000);
    }
    
    private deleteSelectedRecords() {
        const dialogWrapper = document.getElementById('confirm-dialog') as Confirm
        const selectedRecords = this.records.filter(selected)
        dialogWrapper.setRecords(selectedRecords)

        if (dialogWrapper.shadowRoot == null) return
        const dialog = dialogWrapper.shadowRoot.children[0] as MdDialog
        const listener = async () => {
            try {
                if (dialog.returnValue !== 'delete') return

                const recordsMap = new Map<string, boolean>()
                selectedRecords.forEach(record => {
                    this.removeRecord(record)
                    recordsMap.set(record.title, true)
                })

                const opfsRoot = await navigator.storage.getDirectory()
                for await (const [name] of opfsRoot.entries()) {
                    if (!recordsMap.get(name)) {
                        continue
                    }
                    console.log('Delete:', name)
                    await opfsRoot.removeEntry(name)
                }
                await this.updateEstimate()
            } catch (e) {
                sendException(e)
                console.error(e)
            } finally {
                dialog.removeEventListener('closed', listener)
            }
        }
        dialog.addEventListener('closed', listener)
        dialog.show()
    }
};

declare global {
    interface HTMLElementTagNameMap {
        'record-list': RecordList;
    }
}
