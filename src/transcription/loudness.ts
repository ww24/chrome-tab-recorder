/**
 * ITU-R BS.1770-4 / EBU R128 loudness measurement and normalization for ASR.
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
 * Calculates second-order IIR (Biquad) filter coefficients using Audio EQ Cookbook formulas.
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
        const temp = applyBiquadFilter(input, this.stage1)
        return applyBiquadFilter(temp, this.stage2, temp)
    }
}

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
    /** Target integrated loudness in LUFS. Default is -20.0 (optimal for ASR). */
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

    let currentPeak = 0
    for (let i = 0; i < pcm.length; i++) {
        const abs = Math.abs(pcm[i])
        if (abs > currentPeak) currentPeak = abs
    }

    if (currentPeak === 0) {
        return inPlace ? pcm : new Float32Array(pcm)
    }

    const currentLufs = measureLoudness(pcm, sampleRate)
    if (!isFinite(currentLufs) || currentLufs < minLufs) {
        return inPlace ? pcm : new Float32Array(pcm)
    }

    const deltaLufs = targetLufs - currentLufs
    const maxGainLinear = Math.pow(10, maxGainDb / 20)
    let gain = Math.pow(10, deltaLufs / 20)

    if (gain > maxGainLinear) {
        gain = maxGainLinear
    }

    if (currentPeak * gain > maxPeak) {
        gain = maxPeak / currentPeak
    }

    if (Math.abs(gain - 1.0) < 0.01) {
        return inPlace ? pcm : new Float32Array(pcm)
    }

    const out = inPlace ? pcm : new Float32Array(pcm.length)
    for (let i = 0; i < pcm.length; i++) {
        out[i] = pcm[i] * gain
    }

    return out
}
