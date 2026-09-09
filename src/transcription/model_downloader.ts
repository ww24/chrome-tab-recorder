import { REQUIRED_MODEL_FILES, getModelFileUrl } from './model_files'
import { OPFSModelCache } from './opfs_model_cache'
import { formatFileSize } from '../format'

export interface ModelDownloadProgress {
    loaded: number
    total: number
    file: string
    fileIndex: number
    totalFiles: number
}

/**
 * Downloads model files directly from HuggingFace to OPFS without initializing pipeline.
 */
export class ModelDownloader {
    private readonly cache = new OPFSModelCache()
    private isAborted = false
    private isDownloadingFlag = false
    private lastProgress: ModelDownloadProgress | null = null
    private abortController: AbortController | null = null

    /**
     * Returns the total estimated size of all required model files in bytes.
     */
    static getTotalSize(): number {
        return REQUIRED_MODEL_FILES.reduce((acc, f) => acc + f.size, 0)
    }

    /**
     * Returns the formatted total size string (e.g. "1.5 GB").
     */
    static getFormattedTotalSize(fractionDigits: number = 1): string {
        return formatFileSize(ModelDownloader.getTotalSize(), fractionDigits)
    }

    get isDownloading(): boolean {
        return this.isDownloadingFlag
    }

    get aborted(): boolean {
        return this.isAborted
    }

    getProgress(): ModelDownloadProgress | null {
        return this.lastProgress
    }

    abort() {
        this.isAborted = true
        this.lastProgress = null
        this.abortController?.abort()
    }

    async clearCache(): Promise<void> {
        await this.cache.clear()
    }

    async download(onProgress?: (progress: ModelDownloadProgress) => void): Promise<void> {
        this.isAborted = false
        this.isDownloadingFlag = true
        this.lastProgress = null
        this.abortController = new AbortController()
        const signal = this.abortController.signal

        const reportProgress = (p: ModelDownloadProgress) => {
            this.lastProgress = p
            onProgress?.(p)
        }

        try {
            const totalFiles = REQUIRED_MODEL_FILES.length
            let totalBytesDownloaded = 0
            const totalSize = ModelDownloader.getTotalSize()

            for (let i = 0; i < totalFiles; i++) {
                if (this.isAborted || signal.aborted) {
                    throw new Error('Model download aborted')
                }

                const file = REQUIRED_MODEL_FILES[i]
                const url = getModelFileUrl(file)

                // Check if already in cache and has exact expected size
                const existing = await this.cache.match(url)
                const existingContentLength = Number(existing?.headers.get('Content-Length') || 0)
                if (existing && existingContentLength === file.size) {
                    totalBytesDownloaded += existingContentLength
                    reportProgress({
                        loaded: totalBytesDownloaded,
                        total: totalSize,
                        file: file.repo + '/' + file.name,
                        fileIndex: i + 1,
                        totalFiles,
                    })
                    continue
                }

                let res: Response
                try {
                    console.info(`fetch: ${url}`)
                    res = await fetch(url, { signal })
                } catch (fetchErr) {
                    if (this.isAborted || signal.aborted) {
                        throw new Error('Model download aborted', { cause: fetchErr })
                    }
                    throw fetchErr
                }

                if (!res.ok) {
                    throw new Error(`Failed to download ${file.name}: ${res.status} ${res.statusText}`)
                }

                const contentLength = Number(res.headers.get('Content-Length') || file.size)
                const reader = res.body?.getReader()
                if (!reader) {
                    await this.cache.put(url, res)
                    totalBytesDownloaded += contentLength
                    continue
                }

                const isAborted = () => this.isAborted || signal.aborted
                const stream = new ReadableStream({
                    async start(controller) {
                        try {
                            while (true) {
                                if (isAborted()) {
                                    reader.cancel().catch(() => {})
                                    controller.error(new Error('Model download aborted'))
                                    break
                                }
                                const { done, value } = await reader.read()
                                if (done) {
                                    controller.close()
                                    break
                                }
                                totalBytesDownloaded += value.length
                                reportProgress({
                                    loaded: totalBytesDownloaded,
                                    total: totalSize,
                                    file: file.repo + '/' + file.name,
                                    fileIndex: i + 1,
                                    totalFiles,
                                })
                                controller.enqueue(value)
                            }
                        } catch (err) {
                            controller.error(err)
                        }
                    },
                    cancel() {
                        reader.cancel().catch(() => {})
                    },
                })

                const responseToCache = new Response(stream, {
                    status: res.status,
                    statusText: res.statusText,
                    headers: res.headers,
                })

                await this.cache.put(url, responseToCache)
            }

            if (!(await this.cache.hasCache())) {
                throw new Error('Model download completed with missing or incomplete files')
            }
        } finally {
            this.isDownloadingFlag = false
            this.abortController = null
        }
    }
}
