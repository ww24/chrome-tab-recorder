abstract class ConfigStorage {
    abstract set(key: string, value: object): void
    abstract get(key: string): object | null
}

export class ExtensionSyncStorage extends ConfigStorage {
    public constructor() {
        super()
    }

    public async set(key: string, value: object) {
        await chrome.storage.sync.set({ [key]: value })
    }

    public async get(key: string): Promise<object | null> {
        return (await chrome.storage.sync.get(key))[key] as (object | null)
    }
}

export class WebLocalStorage extends ConfigStorage {
    public constructor() {
        super()
    }

    public set(key: string, value: object) {
        const data = JSON.stringify(value)
        localStorage.setItem(key, data)
    }

    public get(key: string): object | null {
        const data = localStorage.getItem(key)
        if (data == null) return null
        return JSON.parse(data)
    }
}
