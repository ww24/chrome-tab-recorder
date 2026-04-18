import { formatNum, formatRate, deepMerge, roundToEven, clampCoordinate, clampDimension } from '../../src/element/util'

describe('formatNum', () => {
    test('formats integer with specified decimal places', () => {
        expect(formatNum(1, 0)).toBe('1')
        expect(formatNum(1, 2)).toBe('1.00')
        expect(formatNum(0, 3)).toBe('0.000')
    })

    test('formats decimal with specified decimal places', () => {
        expect(formatNum(1.5, 1)).toBe('1.5')
        expect(formatNum(1.456, 2)).toBe('1.46')
        expect(formatNum(1.999, 2)).toBe('2.00')
    })

    test('formats large numbers with commas', () => {
        expect(formatNum(1000, 0)).toBe('1,000')
        expect(formatNum(1234567.89, 2)).toBe('1,234,567.89')
    })

    test('formats negative numbers', () => {
        expect(formatNum(-1, 2)).toBe('-1.00')
        expect(formatNum(-1234.5, 1)).toBe('-1,234.5')
    })
})

describe('formatRate', () => {
    test('formats rate as percentage with specified decimal places', () => {
        expect(formatRate(0, 0)).toBe('0%')
        expect(formatRate(1, 0)).toBe('100%')
        expect(formatRate(0.5, 0)).toBe('50%')
    })

    test('formats rate with decimal places', () => {
        expect(formatRate(0.1234, 2)).toBe('12.34%')
        expect(formatRate(0.1, 1)).toBe('10.0%')
        expect(formatRate(1, 2)).toBe('100.00%')
    })

    test('formats rate greater than 1', () => {
        expect(formatRate(1.5, 0)).toBe('150%')
    })

    test('formats negative rate', () => {
        expect(formatRate(-0.1, 1)).toBe('-10.0%')
    })
})

describe('deepMerge', () => {
    test('empty object & empty object', () => {
        const actual = deepMerge({}, {})
        expect(actual).toStrictEqual({})
    })

    test('empty object & null', () => {
        const actual = deepMerge({}, null as any)
        expect(actual).toStrictEqual({})
    })

    test('simple objects', () => {
        const actual = deepMerge({ a: 0, b: 2 }, { a: 1, c: 3 })
        expect(actual).toStrictEqual({ a: 1, b: 2, c: 3 })
    })

    test('nested objects', () => {
        const actual = deepMerge(
            {
                a: { a1: 1 },
                c: { c1: 3 },
                d: 'd',
            } as any,
            {
                a: { a2: 2 },
                c: { c1: 4 },
                d: {},
            },
        )
        expect(actual).toStrictEqual({
            a: { a1: 1, a2: 2 },
            c: { c1: 4 },
            d: {},
        })
    })

    test('null behavior', () => {
        const actual = deepMerge(
            {
                a: { a1: 1 },
                c: { c1: 3 },
                d: 'd',
            } as any,
            {
                a: { a1: null, a2: null },
                c: null,
                d: null,
            },
        )
        expect(actual).toStrictEqual({
            a: { a1: 1 },
            c: { c1: 3 },
            d: 'd',
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
