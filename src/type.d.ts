declare global {
    interface Window {
        // Experimental. https://developer.mozilla.org/ja/docs/Web/API/Window/showDirectoryPicker
        showDirectoryPicker: (option: ShowDirectoryPickerOptions) => Promise<FileSystemDirectoryHandle>;
    }
    interface FileSystemDirectoryHandle {
        // https://developer.mozilla.org/ja/docs/Web/API/FileSystemDirectoryHandle/entries
        entries: () => AsyncIterable<[string, FileSystemFileHandle]>;
    }
    interface FileSystemHandle {
        // Experimental. https://developer.mozilla.org/ja/docs/Web/API/FileSystemHandle/queryPermission
        queryPermission: (opts: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
        // Experimental. https://developer.mozilla.org/ja/docs/Web/API/FileSystemHandle/requestPermission
        requestPermission: (opts: FileSystemHandlePermissionDescriptor) => Promise<PermissionState>;
    }
    interface MediaTrackConstraints {
        mandatory?: MediaTrackConstraintsMandatory;
    }
    interface MediaTrackConstraintsMandatory {
        chromeMediaSource: string;
        chromeMediaSourceId: string;
        maxWidth?: number;
        maxHeight?: number;
        maxFrameRate?: number;
        minWidth?: number;
        minHeight?: number;
        minFrameRate?: number;
    }
    // Extend ImageCapture with grabFrame method
    interface ImageCapture {
        grabFrame(): Promise<ImageBitmap>;
    }
    // Extend Uint8Array with Base64 methods
    interface Uint8Array {
        toBase64(): string;
    }
    interface Uint8ArrayConstructor {
        fromBase64(base64: string): Uint8Array<ArrayBuffer>;
    }
}

export interface ShowDirectoryPickerOptions {
    id?: string;
    mode?: 'read' | 'readwrite';
    startIn?: 'desktop' | 'documents' | 'downloads' | 'music' | 'pictures' | 'videos';
}

export interface FileSystemHandlePermissionDescriptor {
    mode: 'read' | 'readwrite';
}

export function getMediaStreamId(options: chrome.tabCapture.GetMediaStreamOptions): Promise<string>;
