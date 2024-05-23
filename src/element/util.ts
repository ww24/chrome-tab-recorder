import { FileSystemHandlePermissionDescriptor } from '../type';

export function formatNum(num: number, dig: number) {
    return num.toLocaleString('ja-JP', {
        maximumFractionDigits: dig,
        minimumFractionDigits: dig,
    });
}

export function formatRate(rate: number, dig: number) {
    return rate.toLocaleString('ja-JP', {
        style: 'percent',
        maximumFractionDigits: dig,
        minimumFractionDigits: dig,
    });
}

export async function checkFileHandlePermission(handle: FileSystemHandle) {
    const options: FileSystemHandlePermissionDescriptor = { mode: 'readwrite' };
    return (await handle.queryPermission(options) === 'granted')
        || (await handle.requestPermission(options) === 'granted');
}
