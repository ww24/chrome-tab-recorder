import type { FileSystemHandlePermissionDescriptor } from '../type'

export function formatNum(num: number, dig: number) {
    return num.toLocaleString('en-US', {
        maximumFractionDigits: dig,
        minimumFractionDigits: dig,
    })
}

export function formatRate(rate: number, dig: number) {
    return rate.toLocaleString('en-US', {
        style: 'percent',
        maximumFractionDigits: dig,
        minimumFractionDigits: dig,
    })
}

export async function checkFileHandlePermission(handle: FileSystemHandle) {
    const options: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' }
    return (await handle.queryPermission(options) === 'granted')
        || (await handle.requestPermission(options) === 'granted')
}

/* eslint @typescript-eslint/no-explicit-any: 0 */
export function deepMerge<T>(obj1: T, obj2: T): T {
    const res = { ...obj1 }
    for (const k in obj2) {
        if (!Object.hasOwn(obj2 as object, k)) continue
        if (obj1[k] instanceof Object && obj2[k] instanceof Object) {
            res[k] = deepMerge(obj1[k], obj2[k])
        } else if (obj2[k] != null) {
            res[k] = obj2[k]
        }
    }
    return res
}
