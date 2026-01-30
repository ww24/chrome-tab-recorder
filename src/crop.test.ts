
import { alignRegion } from './crop'

const createMockFrame = (codedWidth: number, codedHeight: number): VideoFrame => ({
    codedWidth,
    codedHeight,
}) as unknown as VideoFrame

describe('alignRegion', () => {
    it('should return the region as-is when it fits within the frame', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 100, y: 100, width: 800, height: 600 }

        const result = alignRegion(frame, region)

        expect(result).toEqual({
            x: 100,
            y: 100,
            width: 800,
            height: 600,
        })
    })

    it('should clamp x to frame.codedWidth - 1 when x exceeds bounds', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 2000, y: 100, width: 800, height: 600 }

        const result = alignRegion(frame, region)

        expect(result).toEqual({
            x: 1919,
            y: 100,
            width: 1, // 1920 - 1919 = 1
            height: 600,
        })
    })

    it('should clamp y to frame.codedHeight - 1 when y exceeds bounds', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 100, y: 1200, width: 800, height: 600 }

        const result = alignRegion(frame, region)

        expect(result).toEqual({
            x: 100,
            y: 1079,
            width: 800,
            height: 1, // 1080 - 1079 = 1
        })
    })

    it('should handle region at origin (0, 0) with full frame size', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 0, y: 0, width: 1920, height: 1080 }

        const result = alignRegion(frame, region)

        expect(result).toEqual({
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        })
    })

    it('should handle small frame dimensions', () => {
        const frame = createMockFrame(100, 100)
        const region = { x: 50, y: 50, width: 30, height: 30 }

        const result = alignRegion(frame, region)

        expect(result).toEqual({
            x: 50,
            y: 50,
            width: 30,
            height: 30,
        })
    })

    it('should clamp width when region extends beyond frame width', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 1800, y: 100, width: 200, height: 600 }

        const result = alignRegion(frame, region)

        expect(result).toEqual({
            x: 1800,
            y: 100,
            width: 120, // 1920 - 1800 = 120
            height: 600,
        })
    })

    it('should clamp height when region extends beyond frame height', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 100, y: 900, width: 800, height: 300 }

        const result = alignRegion(frame, region)

        expect(result).toEqual({
            x: 100,
            y: 900,
            width: 800,
            height: 180, // 1080 - 900 = 180
        })
    })

    it('should handle x at exact boundary (codedWidth - 1)', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 1919, y: 100, width: 100, height: 600 }

        const result = alignRegion(frame, region)

        expect(result).toEqual({
            x: 1919,
            y: 100,
            width: 1,
            height: 600,
        })
    })

    it('should handle y at exact boundary (codedHeight - 1)', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 100, y: 1079, width: 800, height: 100 }

        const result = alignRegion(frame, region)

        expect(result).toEqual({
            x: 100,
            y: 1079,
            width: 800,
            height: 1,
        })
    })

    it('should clamp negative x to 0', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: -100, y: 100, width: 800, height: 600 }

        const result = alignRegion(frame, region)

        expect(result).toEqual({
            x: 0,
            y: 100,
            width: 800,
            height: 600,
        })
    })

    it('should clamp negative y to 0', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: 100, y: -50, width: 800, height: 600 }

        const result = alignRegion(frame, region)

        expect(result).toEqual({
            x: 100,
            y: 0,
            width: 800,
            height: 600,
        })
    })

    it('should clamp both negative x and y to 0', () => {
        const frame = createMockFrame(1920, 1080)
        const region = { x: -200, y: -150, width: 800, height: 600 }

        const result = alignRegion(frame, region)

        expect(result).toEqual({
            x: 0,
            y: 0,
            width: 800,
            height: 600,
        })
    })
})
