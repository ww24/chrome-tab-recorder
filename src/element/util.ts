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
export function deepMerge<T extends object, P extends Partial<T>>(obj1: T, obj2: P): T {
    const res = { ...obj1 }
    for (const k in obj2) {
        if (!Object.hasOwn(obj2 as object, k)) continue
        const key = k as unknown as keyof T
        const val1 = obj1[key]
        const val2 = obj2[k as keyof P]
        if (val1 instanceof Object && val2 instanceof Object) {
            res[key] = deepMerge(val1 as any, val2 as any)
        } else if (val2 != null) {
            res[key] = val2 as any
        }
    }
    return res
}

/**
 * Round a number to the nearest even value.
 * This is required for VideoFrame which requires x, y offsets to be even numbers.
 */
export function roundToEven(value: number): number {
    return Math.round(value / 2) * 2
}

/**
 * Clamp a coordinate value to be non-negative (>= 0).
 * x and y coordinates must not be negative.
 */
export function clampCoordinate(value: number): number {
    return Math.max(0, value)
}

/**
 * Clamp a dimension value to be positive (>= 1).
 * width and height must be greater than 0.
 */
export function clampDimension(value: number, minValue: number = 1): number {
    return Math.max(minValue, value)
}
