/**
 * ITU-R BS.1770-4 / EBU R128 loudness measurement and normalization for Whisper ASR.
 *
 * Implemented in pure TypeScript (Float32Array operations) without any dependencies
 * on Web Audio API, making it fully portable across Web Worker, Service Worker,
 * Offscreen Document, and Node.js/Vitest environments.
 */

export interface BiquadCoefficients {
    b0: number
    b1: number
    b2: number
    a1: number
    a2: number
}

/**
 * Calculates second-order IIR (Biquad) filter coefficients using the Audio EQ Cookbook formulas.
 */
export function calculateHighShelfCoefficients(
    gainDb: number,
    q: number,
    fc: number,
    sampleRate: number,
): BiquadCoefficients {
    const a = Math.pow(10, gainDb / 40)
    const w0 = (2 * Math.PI * fc) / sampleRate
    const cosW0 = Math.cos(w0)
    const sinW0 = Math.sin(w0)
    const alpha = sinW0 / (2 * q)

    const sqrtA = Math.sqrt(a)
    const b0 = a * (a + 1 + (a - 1) * cosW0 + 2 * sqrtA * alpha)
    const b1 = -2 * a * (a - 1 + (a + 1) * cosW0)
    const b2 = a * (a + 1 + (a - 1) * cosW0 - 2 * sqrtA * alpha)
    const a0 = a + 1 - (a - 1) * cosW0 + 2 * sqrtA * alpha
    const a1 = 2 * (a - 1 - (a + 1) * cosW0)
    const a2 = a + 1 - (a - 1) * cosW0 - 2 * sqrtA * alpha

    return {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    }
}

export function calculateHighPassCoefficients(q: number, fc: number, sampleRate: number): BiquadCoefficients {
    const w0 = (2 * Math.PI * fc) / sampleRate
    const cosW0 = Math.cos(w0)
    const sinW0 = Math.sin(w0)
    const alpha = sinW0 / (2 * q)

    const b0 = (1 + cosW0) / 2
    const b1 = -(1 + cosW0)
    const b2 = (1 + cosW0) / 2
    const a0 = 1 + alpha
    const a1 = -2 * cosW0
    const a2 = 1 - alpha

    return {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0,
    }
}

/**
 * Applies a biquad filter using Direct Form II Transposed to an input Float32Array.
 */
export function applyBiquadFilter(
    input: Float32Array,
    coeffs: BiquadCoefficients,
    output?: Float32Array,
): Float32Array {
    const out = output ?? new Float32Array(input.length)
    let z1 = 0
    let z2 = 0
    const { b0, b1, b2, a1, a2 } = coeffs

    for (let i = 0; i < input.length; i++) {
        const x = input[i]
        const y = b0 * x + z1
        z1 = b1 * x - a1 * y + z2
        z2 = b2 * x - a2 * y
        out[i] = y
    }

    return out
}

/**
 * K-weighting filter cascade (Stage 1: High-shelf pre-filter + Stage 2: RLB high-pass filter)
 * according to ITU-R BS.1770-4.
 */
export class KWeightingFilter {
    private readonly stage1: BiquadCoefficients
    private readonly stage2: BiquadCoefficients

    constructor(sampleRate = 16000) {
        // Stage 1: High-shelf pre-filter (+4 dB, Q=1/sqrt(2), fc=1500 Hz)
        this.stage1 = calculateHighShelfCoefficients(4.0, 1 / Math.SQRT2, 1500.0, sampleRate)
        // Stage 2: RLB high-pass filter (Q=0.5, fc=38 Hz)
        this.stage2 = calculateHighPassCoefficients(0.5, 38.0, sampleRate)
    }

    apply(input: Float32Array): Float32Array {
        // Stage 1 output
        const temp = applyBiquadFilter(input, this.stage1)
        // Stage 2 output (in-place on temp buffer)
        return applyBiquadFilter(temp, this.stage2, temp)
    }
}

// Pre-instantiated K-weighting filter for 16kHz (standard Whisper sample rate)
const defaultKFilter16k = new KWeightingFilter(16000)

/**
 * Measures the integrated loudness (in LUFS) of a 16kHz mono audio buffer
 * according to ITU-R BS.1770-4 with dual-pass gating.
 *
 * @param pcm 16kHz mono Float32Array (-1.0 to 1.0)
 * @param sampleRate Default is 16000
 * @returns Integrated loudness in LUFS. Returns -Infinity for pure silence.
 */
export function measureLoudness(pcm: Float32Array, sampleRate = 16000): number {
    if (pcm.length === 0) return -Infinity

    const kFilter = sampleRate === 16000 ? defaultKFilter16k : new KWeightingFilter(sampleRate)
    const filtered = kFilter.apply(pcm)

    // ITU-R BS.1770: 400ms rectangular gating block with 75% overlap (100ms hop)
    const blockLength = Math.round(0.4 * sampleRate) // 6400 samples at 16kHz
    const hopSize = Math.round(0.1 * sampleRate) // 1600 samples at 16kHz

    // Short signal fallback (< 400ms): measure single full-window mean-square
    if (filtered.length < blockLength) {
        let sumSquares = 0
        for (let i = 0; i < filtered.length; i++) {
            sumSquares += filtered[i] * filtered[i]
        }
        const ms = sumSquares / filtered.length
        if (ms <= 1e-12) return -Infinity
        return -0.691 + 10 * Math.log10(ms)
    }

    const numBlocks = Math.floor((filtered.length - blockLength) / hopSize) + 1
    const blockMeanSquares = new Float64Array(numBlocks)

    for (let b = 0; b < numBlocks; b++) {
        const start = b * hopSize
        let sum = 0
        for (let i = 0; i < blockLength; i++) {
            const s = filtered[start + i]
            sum += s * s
        }
        blockMeanSquares[b] = sum / blockLength
    }

    // Pass 1: Absolute threshold gating (-70 LUFS)
    // -70 LUFS corresponds to MS = 10^((-70 + 0.691) / 10) ≈ 1.172e-7
    const absThresholdMs = Math.pow(10, (-70 + 0.691) / 10)
    let pass1Sum = 0
    let pass1Count = 0

    for (let b = 0; b < numBlocks; b++) {
        const ms = blockMeanSquares[b]
        if (ms > absThresholdMs) {
            pass1Sum += ms
            pass1Count++
        }
    }

    if (pass1Count === 0) {
        return -Infinity
    }

    // Pass 2: Relative threshold gating (Gamma_r = L_avg - 10 LU)
    const avgPass1Ms = pass1Sum / pass1Count
    const avgPass1Lufs = -0.691 + 10 * Math.log10(avgPass1Ms)
    const relThresholdLufs = avgPass1Lufs - 10.0
    const relThresholdMs = Math.pow(10, (relThresholdLufs + 0.691) / 10)

    let pass2Sum = 0
    let pass2Count = 0

    for (let b = 0; b < numBlocks; b++) {
        const ms = blockMeanSquares[b]
        if (ms > absThresholdMs && ms > relThresholdMs) {
            pass2Sum += ms
            pass2Count++
        }
    }

    if (pass2Count === 0) {
        return avgPass1Lufs
    }

    const finalMs = pass2Sum / pass2Count
    return -0.691 + 10 * Math.log10(finalMs)
}

export interface LoudnessNormalizationOptions {
    /** Target integrated loudness in LUFS. Default is -20.0 (optimal for Whisper ASR). */
    targetLufs?: number
    /** Maximum peak amplitude to prevent clipping (0.0 to 1.0). Default is 0.95. */
    maxPeak?: number
    /** Maximum gain boost in dB to avoid excessive noise floor amplification. Default is 18.0 dB. */
    maxGainDb?: number
    /** Minimum loudness in LUFS to be considered speech. Below this, audio is treated as silence. Default is -60.0 LUFS. */
    minLufs?: number
    /** Sample rate of input PCM. Default is 16000. */
    sampleRate?: number
    /** If true, normalizes input array in-place without allocating a new Float32Array. Default is false. */
    inPlace?: boolean
}

/**
 * Normalizes the loudness of a 16kHz mono Float32Array PCM buffer to a target LUFS
 * with safety limiters to avoid clipping and excessive noise boost.
 *
 * @param pcm 16kHz mono Float32Array
 * @param options Normalization configuration
 * @returns Normalized Float32Array
 */
export function normalizeLoudness(pcm: Float32Array, options: LoudnessNormalizationOptions = {}): Float32Array {
    if (pcm.length === 0) {
        return options.inPlace ? pcm : new Float32Array(0)
    }

    const targetLufs = options.targetLufs ?? -20.0
    const maxPeak = options.maxPeak ?? 0.95
    const maxGainDb = options.maxGainDb ?? 18.0
    const minLufs = options.minLufs ?? -60.0
    const sampleRate = options.sampleRate ?? 16000
    const inPlace = options.inPlace ?? false

    // Measure input peak amplitude
    let currentPeak = 0
    for (let i = 0; i < pcm.length; i++) {
        const abs = Math.abs(pcm[i])
        if (abs > currentPeak) currentPeak = abs
    }

    // Pure silence check
    if (currentPeak === 0) {
        return inPlace ? pcm : new Float32Array(pcm)
    }

    // Measure current loudness
    const currentLufs = measureLoudness(pcm, sampleRate)

    // If audio is below noise floor threshold, do not boost noise
    if (!isFinite(currentLufs) || currentLufs < minLufs) {
        return inPlace ? pcm : new Float32Array(pcm)
    }

    // Calculate required gain in linear scale
    const deltaLufs = targetLufs - currentLufs
    const maxGainLinear = Math.pow(10, maxGainDb / 20)
    let gain = Math.pow(10, deltaLufs / 20)

    // Clamp maximum boost to avoid amplifying background noise
    if (gain > maxGainLinear) {
        gain = maxGainLinear
    }

    // Limiter: prevent clipping beyond maxPeak
    if (currentPeak * gain > maxPeak) {
        gain = maxPeak / currentPeak
    }

    // If gain is essentially 1.0 (within 0.1 dB), skip processing
    if (Math.abs(gain - 1.0) < 0.01) {
        return inPlace ? pcm : new Float32Array(pcm)
    }

    const out = inPlace ? pcm : new Float32Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) {
        out[i] = pcm[i] * gain
    }

    return out
}

/**
 * Stateful Biquad filter preserving z1, z2 state across arbitrary streaming chunks.
 */
export class StreamingBiquadFilter {
    private z1 = 0
    private z2 = 0

    constructor(private readonly coeffs: BiquadCoefficients) {}

    apply(input: Float32Array, output?: Float32Array): Float32Array {
        const out = output ?? new Float32Array(input.length)
        const { b0, b1, b2, a1, a2 } = this.coeffs
        for (let i = 0; i < input.length; i++) {
            const x = input[i]
            const y = b0 * x + this.z1
            this.z1 = b1 * x - a1 * y + this.z2
            this.z2 = b2 * x - a2 * y
            out[i] = y
        }
        return out
    }

    reset(): void {
        this.z1 = 0
        this.z2 = 0
    }
}

/**
 * Stateful K-weighting filter cascade preserving state across arbitrary streaming chunks.
 */
export class StreamingKWeightingFilter {
    private readonly stage1: StreamingBiquadFilter
    private readonly stage2: StreamingBiquadFilter

    constructor(sampleRate = 16000) {
        const c1 = calculateHighShelfCoefficients(4.0, 1 / Math.SQRT2, 1500.0, sampleRate)
        const c2 = calculateHighPassCoefficients(0.5, 38.0, sampleRate)
        this.stage1 = new StreamingBiquadFilter(c1)
        this.stage2 = new StreamingBiquadFilter(c2)
    }

    apply(input: Float32Array): Float32Array {
        const temp = this.stage1.apply(input)
        return this.stage2.apply(temp, temp)
    }

    reset(): void {
        this.stage1.reset()
        this.stage2.reset()
    }
}

/**
 * Measures the integrated loudness (in LUFS) of an audio stream chunk-by-chunk
 * according to ITU-R BS.1770-4 with O(1) memory overhead.
 */
export class StreamingLoudnessMeasurer {
    private readonly filter: StreamingKWeightingFilter
    private readonly blockLength: number // 6400 samples (400ms at 16kHz)
    private readonly hopSize: number // 1600 samples (100ms at 16kHz)
    private slidingBuffer: Float64Array
    private slidingBufferLen = 0
    private blockMeanSquares: number[] = []
    private peak = 0
    private totalSamples = 0
    private shortSignalSumSquares = 0

    constructor(private readonly sampleRate = 16000) {
        this.filter = new StreamingKWeightingFilter(sampleRate)
        this.blockLength = Math.round(0.4 * sampleRate)
        this.hopSize = Math.round(0.1 * sampleRate)
        this.slidingBuffer = new Float64Array(this.blockLength * 2)
    }

    feed(chunk: Float32Array): void {
        if (chunk.length === 0) return

        for (let i = 0; i < chunk.length; i++) {
            const abs = Math.abs(chunk[i])
            if (abs > this.peak) this.peak = abs
        }

        const filtered = this.filter.apply(chunk)

        for (let i = 0; i < filtered.length; i++) {
            this.shortSignalSumSquares += filtered[i] * filtered[i]
        }
        this.totalSamples += filtered.length

        let offset = 0
        while (offset < filtered.length) {
            const availableSpace = this.slidingBuffer.length - this.slidingBufferLen
            const toCopy = Math.min(filtered.length - offset, availableSpace)
            for (let j = 0; j < toCopy; j++) {
                this.slidingBuffer[this.slidingBufferLen + j] = filtered[offset + j]
            }
            this.slidingBufferLen += toCopy
            offset += toCopy

            while (this.slidingBufferLen >= this.blockLength) {
                let sum = 0
                for (let k = 0; k < this.blockLength; k++) {
                    const s = this.slidingBuffer[k]
                    sum += s * s
                }
                this.blockMeanSquares.push(sum / this.blockLength)

                this.slidingBuffer.copyWithin(0, this.hopSize, this.slidingBufferLen)
                this.slidingBufferLen -= this.hopSize
            }
        }
    }

    getPeak(): number {
        return this.peak
    }

    getTotalSamples(): number {
        return this.totalSamples
    }

    calculateLoudness(): number {
        if (this.totalSamples === 0) return -Infinity

        if (this.totalSamples < this.blockLength) {
            const ms = this.shortSignalSumSquares / this.totalSamples
            if (ms <= 1e-12) return -Infinity
            return -0.691 + 10 * Math.log10(ms)
        }

        if (this.blockMeanSquares.length === 0) return -Infinity

        const absThresholdMs = Math.pow(10, (-70 + 0.691) / 10)
        let pass1Sum = 0
        let pass1Count = 0

        for (let b = 0; b < this.blockMeanSquares.length; b++) {
            const ms = this.blockMeanSquares[b]
            if (ms > absThresholdMs) {
                pass1Sum += ms
                pass1Count++
            }
        }

        if (pass1Count === 0) return -Infinity

        const avgPass1Ms = pass1Sum / pass1Count
        const avgPass1Lufs = -0.691 + 10 * Math.log10(avgPass1Ms)
        const relThresholdLufs = avgPass1Lufs - 10.0
        const relThresholdMs = Math.pow(10, (relThresholdLufs + 0.691) / 10)

        let pass2Sum = 0
        let pass2Count = 0

        for (let b = 0; b < this.blockMeanSquares.length; b++) {
            const ms = this.blockMeanSquares[b]
            if (ms > absThresholdMs && ms > relThresholdMs) {
                pass2Sum += ms
                pass2Count++
            }
        }

        if (pass2Count === 0) return avgPass1Lufs

        const finalMs = pass2Sum / pass2Count
        return -0.691 + 10 * Math.log10(finalMs)
    }

    calculateGain(options: LoudnessNormalizationOptions = {}): number {
        const targetLufs = options.targetLufs ?? -20.0
        const maxPeak = options.maxPeak ?? 0.95
        const maxGainDb = options.maxGainDb ?? 18.0
        const minLufs = options.minLufs ?? -60.0

        if (this.peak === 0) return 1.0

        const currentLufs = this.calculateLoudness()
        if (!isFinite(currentLufs) || currentLufs < minLufs) {
            return 1.0
        }

        const deltaLufs = targetLufs - currentLufs
        const maxGainLinear = Math.pow(10, maxGainDb / 20)
        let gain = Math.pow(10, deltaLufs / 20)

        if (gain > maxGainLinear) gain = maxGainLinear
        if (this.peak * gain > maxPeak) gain = maxPeak / this.peak

        return gain
    }
}
