import { deepMerge } from './util'

describe('deepMerge', () => {
    test('empty object & empty object', () => {
        const actual = deepMerge({}, {})
        expect(actual).toStrictEqual({})
    })

    test('empty object & null', () => {
        const actual = deepMerge({}, null)
        expect(actual).toStrictEqual({})
    })

    test('simple objects', () => {
        const actual = deepMerge({ a: 0, b: 2 }, { a: 1, c: 3 })
        expect(actual).toStrictEqual({ a: 1, b: 2, c: 3 })
    })

    test('nested objects', () => {
        const actual = deepMerge({
            a: { a1: 1 }, c: { c1: 3 }, d: 'd',
        }, {
            a: { a2: 2 }, c: { c1: 4 }, d: {}
        })
        expect(actual).toStrictEqual({
            a: { a1: 1, a2: 2 }, c: { c1: 4 }, d: {}
        })
    })
})
