import './element/confirm'
import './element/settings'
import './element/recordList'
import './element/tab'
import { RecordList, Record } from './element/recordList'

document.addEventListener('DOMContentLoaded', () => {
    const recordsElem = document.getElementById('records') as RecordList;

    (async () => {
        const records = await listRecords()
        records.forEach(record => {
            recordsElem.addRecord(record)
        })
        await recordsElem.updateEstimate()
    })()
})

async function listRecords() {
    const opfsRoot = await navigator.storage.getDirectory()
    let result: Array<Record> = []
    for await (const [name, handle] of opfsRoot.entries()) {
        const file = await handle.getFile()
        result = result.concat({
            title: name,
            file: await handle.getFile(),
            size: file.size,
            selected: false,
        })
    }
    return result
}
