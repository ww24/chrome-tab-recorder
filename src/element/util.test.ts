import { deepMerge, roundToEven, clampCoordinate, clampDimension } from './util'

describe('deepMerge', () => {
    test('empty object & empty object', () => {
        const actual = deepMerge({}, {})
        expect(actual).toStrictEqual({})
    })

    test('empty object & null', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const actual = deepMerge({}, null as any)
        expect(actual).toStrictEqual({})
    })

    test('simple objects', () => {
        const actual = deepMerge({ a: 0, b: 2 }, { a: 1, c: 3 })
        expect(actual).toStrictEqual({ a: 1, b: 2, c: 3 })
    })

    test('nested objects', () => {
        const actual = deepMerge({
            a: { a1: 1 }, c: { c1: 3 }, d: 'd',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any, {
            a: { a2: 2 }, c: { c1: 4 }, d: {}
        })
        expect(actual).toStrictEqual({
            a: { a1: 1, a2: 2 }, c: { c1: 4 }, d: {}
        })
    })

    test('null behavior', () => {
        const actual = deepMerge({
            a: { a1: 1 }, c: { c1: 3 }, d: 'd',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any, {
            a: { a1: null, a2: null }, c: null, d: null
        })
        expect(actual).toStrictEqual({
            a: { a1: 1 }, c: { c1: 3 }, d: 'd'
        })
    })
})

describe('roundToEven', () => {
    test('even numbers stay unchanged', () => {
        expect(roundToEven(0)).toBe(0)
        expect(roundToEven(2)).toBe(2)
        expect(roundToEven(100)).toBe(100)
        expect(roundToEven(-4)).toBe(-4)
    })

    test('odd numbers are rounded to nearest even', () => {
        expect(roundToEven(1)).toBe(2)
        expect(roundToEven(3)).toBe(4)
        expect(roundToEven(99)).toBe(100)
        expect(roundToEven(-1)).toBe(-0)
        expect(roundToEven(-3)).toBe(-2)
    })

    test('decimal values are rounded to nearest even', () => {
        expect(roundToEven(0.5)).toBe(0)
        expect(roundToEven(1.5)).toBe(2)
        expect(roundToEven(2.5)).toBe(2)
        expect(roundToEven(3.5)).toBe(4)
        expect(roundToEven(4.9)).toBe(4)
        expect(roundToEven(5.1)).toBe(6)
    })
})

describe('clampCoordinate', () => {
    test('positive values stay unchanged', () => {
        expect(clampCoordinate(0)).toBe(0)
        expect(clampCoordinate(1)).toBe(1)
        expect(clampCoordinate(100)).toBe(100)
    })

    test('negative values are clamped to 0', () => {
        expect(clampCoordinate(-1)).toBe(0)
        expect(clampCoordinate(-100)).toBe(0)
        expect(clampCoordinate(-0.5)).toBe(0)
    })
})

describe('clampDimension', () => {
    test('values above minValue stay unchanged', () => {
        expect(clampDimension(1)).toBe(1)
        expect(clampDimension(100)).toBe(100)
        expect(clampDimension(10, 5)).toBe(10)
    })

    test('values at or below 0 are clamped to default minValue (1)', () => {
        expect(clampDimension(0)).toBe(1)
        expect(clampDimension(-1)).toBe(1)
        expect(clampDimension(-100)).toBe(1)
    })

    test('values below custom minValue are clamped', () => {
        expect(clampDimension(5, 10)).toBe(10)
        expect(clampDimension(0, 10)).toBe(10)
        expect(clampDimension(-5, 10)).toBe(10)
    })
})
