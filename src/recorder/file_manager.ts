import type { ContainerFormat } from '../configuration'
import { containerExtension, Configuration } from '../configuration'

export class FileManager {
    private dirHandle: FileSystemDirectoryHandle | undefined

    private async getDirectory(): Promise<FileSystemDirectoryHandle> {
        if (this.dirHandle == null) {
            this.dirHandle = await navigator.storage.getDirectory()
        }
        return this.dirHandle
    }

    /**
     * Create a recording file in OPFS and return its handle.
     */
    async createRecordingFile(startAtMs: number, container: ContainerFormat): Promise<FileSystemFileHandle> {
        const dirHandle = await this.getDirectory()
        const ext = containerExtension(container)
        const fileName = Configuration.filename(startAtMs, ext)
        return dirHandle.getFileHandle(fileName, { create: true })
    }

    /**
     * Create an audio separation file in OPFS.
     */
    async createAudioFile(fileName: string): Promise<FileSystemFileHandle> {
        const dirHandle = await this.getDirectory()
        return dirHandle.getFileHandle(fileName, { create: true })
    }
}
