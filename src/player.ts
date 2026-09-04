import '@material/web/icon/icon'
import '@material/web/button/filled-tonal-button'
import '@material/web/button/text-button'
import '@material/web/dialog/dialog'
import '@material/web/switch/switch'
import type { MdDialog } from '@material/web/dialog/dialog'
import { MdSwitch } from '@material/web/switch/switch'
import { applyTheme } from './theme'
import { Settings } from './element/settings'
import { recordingApi } from './api_client'

import { t } from './i18n'
import { parseWebVTT, findActiveCue } from './transcription/vtt'

export type SubtitlePosition = 'bottom' | 'overlay'
export const SUBTITLE_POS_STORAGE_KEY = 'player_subtitle_position'

interface ConfirmDialogOptions {
    headline: string
    message: string
    confirmLabel: string
    cancelLabel: string
    icon?: string
    destructive?: boolean
}

function showConfirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
    const dialog = document.getElementById('confirm-dialog') as MdDialog | null
    if (!dialog) return Promise.resolve(false)

    const headlineEl = document.getElementById('confirm-dialog-headline')
    const messageEl = document.getElementById('confirm-dialog-message')
    const iconEl = document.getElementById('confirm-dialog-icon')
    const confirmBtn = document.getElementById('confirm-dialog-confirm-btn')
    const cancelBtn = document.getElementById('confirm-dialog-cancel-btn')

    if (headlineEl) headlineEl.textContent = options.headline
    if (messageEl) messageEl.textContent = options.message
    if (iconEl) iconEl.textContent = options.icon ?? 'delete_outline'
    if (confirmBtn) confirmBtn.textContent = options.confirmLabel
    if (cancelBtn) cancelBtn.textContent = options.cancelLabel

    if (options.destructive) {
        dialog.classList.add('destructive')
    } else {
        dialog.classList.remove('destructive')
    }

    return new Promise(resolve => {
        const onClose = () => {
            dialog.removeEventListener('close', onClose)
            resolve(dialog.returnValue === 'confirm')
        }
        dialog.addEventListener('close', onClose)
        dialog.show()
    })
}

async function initPlayer() {
    const config = Settings.getConfiguration()
    applyTheme(config.uiTheme)

    const params = new URLSearchParams(window.location.search)
    const fileName = params.get('file')
    if (!fileName) {
        const container = document.getElementById('player-container')
        if (container) container.innerHTML = '<div style="color: white; padding: 24px;">No file specified.</div>'
        return
    }

    const titleEl = document.getElementById('file-title')
    if (titleEl) titleEl.textContent = fileName
    document.title = `${fileName} - Player`

    const fileUrl = `/api/recordings/${encodeURIComponent(fileName)}`
    const isAudio = fileName.endsWith('.ogg') || fileName.endsWith('.aac') || fileName.endsWith('.flac')

    const playerContainer = document.getElementById('player-container')
    if (!playerContainer) return

    let mediaEl: HTMLVideoElement | HTMLAudioElement
    if (isAudio) {
        mediaEl = document.createElement('audio')
    } else {
        mediaEl = document.createElement('video')
        mediaEl.playsInline = true
    }
    mediaEl.controls = true
    mediaEl.autoplay = true
    mediaEl.src = fileUrl
    playerContainer.prepend(mediaEl)

    // Check for WebVTT transcript file
    const vttName = fileName.replace(/\.[^.]+$/, '.vtt')
    const vttUrl = `/api/recordings/${encodeURIComponent(vttName)}`

    try {
        const vttRes = await fetch(vttUrl)
        if (vttRes.ok) {
            const vttText = await vttRes.text()
            const cues = parseWebVTT(vttText)

            // Add track element
            const trackEl = document.createElement('track')
            trackEl.kind = 'subtitles'
            trackEl.src = vttUrl
            trackEl.srclang = 'ja'
            trackEl.label = 'Subtitles'
            trackEl.default = true
            mediaEl.appendChild(trackEl)

            // Setup subtitle controls
            const controlsContainer = document.getElementById('subtitle-controls')
            const subtitleSwitch = document.getElementById('subtitle-switch') as MdSwitch | null
            const positionSelect = document.getElementById('subtitle-position-select') as HTMLSelectElement | null
            const subtitleBar = document.getElementById('subtitle-bar')
            const subtitleTextEl = document.getElementById('subtitle-text')
            const subtitleLabel = document.getElementById('subtitle-switch-label')
            const positionLabel = document.getElementById('subtitle-position-label')

            if (subtitleLabel) subtitleLabel.textContent = t('playerSubtitles') || 'Subtitles'
            if (positionLabel) positionLabel.textContent = t('playerSubtitlePosition') || 'Position'
            if (positionSelect) {
                const optBottom = positionSelect.querySelector('option[value="bottom"]')
                const optOverlay = positionSelect.querySelector('option[value="overlay"]')
                if (optBottom) optBottom.textContent = t('playerSubtitleBelow') || 'Below video'
                if (optOverlay) optOverlay.textContent = t('playerSubtitleOverlay') || 'On video'
            }

            let currentPosition: SubtitlePosition =
                (localStorage.getItem(SUBTITLE_POS_STORAGE_KEY) as SubtitlePosition) || 'bottom'
            if (positionSelect) {
                positionSelect.value = currentPosition
            }

            const updateActiveSubtitle = () => {
                if (!subtitleTextEl || !subtitleBar || subtitleBar.style.display === 'none') {
                    return
                }
                const activeCue = findActiveCue(cues, mediaEl.currentTime)
                subtitleTextEl.textContent = activeCue ? activeCue.text : ''
            }

            const updateSubtitleVisibility = () => {
                const isEnabled = subtitleSwitch ? subtitleSwitch.selected : true
                const isFullscreen = document.fullscreenElement === mediaEl

                if (positionSelect) {
                    positionSelect.disabled = !isEnabled
                    const posContainer = document.getElementById('subtitle-position-container')
                    if (posContainer) posContainer.style.opacity = isEnabled ? '1' : '0.5'
                }

                if (!isEnabled) {
                    if (mediaEl.textTracks && mediaEl.textTracks.length > 0) {
                        mediaEl.textTracks[0].mode = 'hidden'
                    }
                    if (subtitleBar) subtitleBar.style.display = 'none'
                    return
                }

                if (isFullscreen || currentPosition === 'overlay') {
                    if (mediaEl.textTracks && mediaEl.textTracks.length > 0) {
                        mediaEl.textTracks[0].mode = 'showing'
                    }
                    if (subtitleBar) subtitleBar.style.display = 'none'
                } else {
                    if (mediaEl.textTracks && mediaEl.textTracks.length > 0) {
                        mediaEl.textTracks[0].mode = 'hidden'
                    }
                    if (subtitleBar) subtitleBar.style.display = 'flex'
                    updateActiveSubtitle()
                }
            }

            if (controlsContainer && subtitleSwitch) {
                controlsContainer.style.display = 'flex'
                subtitleSwitch.selected = true

                subtitleSwitch.addEventListener('input', updateSubtitleVisibility)

                if (positionSelect) {
                    positionSelect.addEventListener('change', () => {
                        currentPosition = positionSelect.value as SubtitlePosition
                        localStorage.setItem(SUBTITLE_POS_STORAGE_KEY, currentPosition)
                        updateSubtitleVisibility()
                    })
                }

                document.addEventListener('fullscreenchange', updateSubtitleVisibility)
                updateSubtitleVisibility()
            }

            mediaEl.addEventListener('timeupdate', updateActiveSubtitle)
            mediaEl.addEventListener('seeked', updateActiveSubtitle)

            // Setup download buttons
            const downloadPanel = document.getElementById('download-actions')
            const vttBtn = document.getElementById('download-vtt-btn')
            const srtBtn = document.getElementById('download-srt-btn')

            if (downloadPanel) downloadPanel.style.display = 'flex'

            if (vttBtn) {
                vttBtn.addEventListener('click', () => {
                    window.location.href = `${vttUrl}?download=true`
                })
            }

            if (srtBtn) {
                const srtName = fileName.replace(/\.[^.]+$/, '.srt')
                const srtUrl = `/api/recordings/${encodeURIComponent(srtName)}?download=true`
                srtBtn.addEventListener('click', () => {
                    window.location.href = srtUrl
                })
            }

            const deleteBtn = document.getElementById('delete-transcript-btn') as HTMLButtonElement | null
            const deleteLabel = document.getElementById('delete-transcript-label')
            if (deleteLabel) {
                deleteLabel.textContent = t('playerDeleteTranscript') || 'Delete Transcript'
            }

            if (deleteBtn) {
                deleteBtn.addEventListener('click', async () => {
                    const confirmed = await showConfirmDialog({
                        headline: t('playerDeleteTranscriptConfirmHeadline') || 'Delete Transcript',
                        message:
                            t('playerDeleteTranscriptConfirmDescription') ||
                            'Are you sure you want to delete the transcript? You can transcribe this recording again later.',
                        confirmLabel: t('playerDeleteTranscriptConfirmButton') || 'Delete',
                        cancelLabel: t('confirmCancelButton') || 'Cancel',
                        destructive: true,
                    })
                    if (!confirmed) return

                    try {
                        deleteBtn.disabled = true

                        // Remove subtitle track elements to release any file locks in the browser
                        const tracks = mediaEl.querySelectorAll('track')
                        tracks.forEach(track => {
                            track.src = ''
                            track.remove()
                        })

                        await recordingApi.deleteTranscript(fileName)
                        window.location.reload()
                    } catch (err) {
                        console.error('Failed to delete transcript:', err)
                        deleteBtn.disabled = false
                        alert(err instanceof Error ? err.message : String(err))
                    }
                })
            }

            // Setup transcript panel
            const transcriptSection = document.getElementById('transcript-section')
            const transcriptList = document.getElementById('transcript-list')
            const transcriptToggle = document.getElementById('transcript-toggle')
            const transcriptArrow = document.getElementById('transcript-arrow')

            if (transcriptSection && transcriptList) {
                if (cues.length > 0) {
                    transcriptSection.style.display = 'block'
                    transcriptList.innerHTML = cues
                        .map(
                            cue => `
                        <div class="transcript-item" data-start="${cue.start}">
                            <div class="transcript-time">${cue.timeText}</div>
                            <div class="transcript-text">${cue.text}</div>
                        </div>
                    `,
                        )
                        .join('')

                    // Click item to seek
                    transcriptList.querySelectorAll('.transcript-item').forEach(item => {
                        item.addEventListener('click', () => {
                            const start = Number.parseFloat(item.getAttribute('data-start') || '0')
                            mediaEl.currentTime = start
                            mediaEl.play()
                        })
                    })

                    // Highlight active item during playback
                    mediaEl.addEventListener('timeupdate', () => {
                        const curTime = mediaEl.currentTime
                        transcriptList.querySelectorAll('.transcript-item').forEach(item => {
                            const start = Number.parseFloat(item.getAttribute('data-start') || '0')
                            const nextStart = Number.parseFloat(
                                item.nextElementSibling?.getAttribute('data-start') || '999999',
                            )
                            if (curTime >= start && curTime < nextStart) {
                                item.style.backgroundColor = 'rgba(0, 106, 106, 0.12)'
                            } else {
                                item.style.backgroundColor = ''
                            }
                        })
                    })
                }

                if (transcriptToggle && transcriptArrow) {
                    let isOpen = true
                    transcriptToggle.addEventListener('click', () => {
                        isOpen = !isOpen
                        transcriptList.style.display = isOpen ? 'block' : 'none'
                        transcriptArrow.textContent = isOpen ? 'expand_more' : 'expand_less'
                    })
                }
            }
        }
    } catch (e) {
        console.warn('Transcript not available:', e)
    }
}

document.addEventListener('DOMContentLoaded', initPlayer)
