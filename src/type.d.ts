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
        minWidth?: number;
        minHeight?: number;
        minFrameRate?: number;
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
