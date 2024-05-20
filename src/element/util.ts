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
    const options = { mode: 'readwrite' };
    return (await (handle as any).queryPermission(options) === 'granted')
        || (await (handle as any).requestPermission(options) === 'granted');
}
