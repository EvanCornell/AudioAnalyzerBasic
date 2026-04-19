// ============================================================
// psd.js — FFT-based Power Spectral Density (Welch's method)
// ============================================================

// Radix-2 Cooley-Tukey FFT (iterative, in-place)
// real[] and imag[] are modified in place. Length must be power of 2.
function fft(real, imag) {
    const N = real.length;
    // Bit-reversal permutation
    for (let i = 1, j = 0; i < N; i++) {
        let bit = N >> 1;
        while (j & bit) {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if (i < j) {
            let tmp = real[i]; real[i] = real[j]; real[j] = tmp;
            tmp = imag[i]; imag[i] = imag[j]; imag[j] = tmp;
        }
    }
    // FFT butterfly
    for (let len = 2; len <= N; len <<= 1) {
        const halfLen = len >> 1;
        const angle = -2 * Math.PI / len;
        const wR = Math.cos(angle);
        const wI = Math.sin(angle);
        for (let i = 0; i < N; i += len) {
            let curR = 1, curI = 0;
            for (let j = 0; j < halfLen; j++) {
                const a = i + j;
                const b = a + halfLen;
                const tR = curR * real[b] - curI * imag[b];
                const tI = curR * imag[b] + curI * real[b];
                real[b] = real[a] - tR;
                imag[b] = imag[a] - tI;
                real[a] += tR;
                imag[a] += tI;
                const nextR = curR * wR - curI * wI;
                curI = curR * wI + curI * wR;
                curR = nextR;
            }
        }
    }
}

// --- Frequency weighting curves (IEC 61672-1) ---
// Each returns un-normalized linear amplitude gain for frequency f (Hz).

function weightA(f) {
    if (f <= 0) return 0;
    const f2 = f * f;
    return (12194 * 12194 * f2 * f2) /
        ((f2 + 20.6 * 20.6) * Math.sqrt((f2 + 107.7 * 107.7) * (f2 + 737.9 * 737.9)) * (f2 + 12194 * 12194));
}

function weightB(f) {
    if (f <= 0) return 0;
    const f2 = f * f;
    return (12194 * 12194 * f2 * f) /
        ((f2 + 20.6 * 20.6) * Math.sqrt(f2 + 158.5 * 158.5) * (f2 + 12194 * 12194));
}

function weightC(f) {
    if (f <= 0) return 0;
    const f2 = f * f;
    return (12194 * 12194 * f2) /
        ((f2 + 20.6 * 20.6) * (f2 + 12194 * 12194));
}

// Normalization constants (gain at 1000 Hz → unity)
const _normA = weightA(1000);
const _normB = weightB(1000);
const _normC = weightC(1000);

function getWeightingGain(f, type) {
    switch (type) {
        case 'A': return weightA(f) / _normA;
        case 'B': return weightB(f) / _normB;
        case 'C': return weightC(f) / _normC;
        default:  return 1.0;
    }
}

// Inverse FFT via conjugate trick: conjugate → fft → conjugate → scale by 1/N
function ifft(real, imag) {
    const N = real.length;
    for (let i = 0; i < N; i++) imag[i] = -imag[i];
    fft(real, imag);
    for (let i = 0; i < N; i++) {
        real[i] /= N;
        imag[i] = -imag[i] / N;
    }
}

/**
 * Apply frequency weighting to PCM samples using overlap-add FFT filtering.
 * @param {Float32Array} samples - input PCM samples (mono)
 * @param {number} sampleRate
 * @param {string} weightType - 'A', 'B', 'C', or 'Z'
 * @returns {Float32Array} weighted samples (same length)
 */
export function applyFrequencyWeighting(samples, sampleRate, weightType) {
    if (weightType === 'Z') return samples;

    const totalN = samples.length;
    const segmentLen = 8192;
    const fftSize = segmentLen * 2; // zero-pad to avoid circular convolution
    const output = new Float32Array(totalN);

    // Pre-compute weighting gains per bin
    const gains = new Float64Array(fftSize);
    const binWidth = sampleRate / fftSize;
    for (let k = 0; k <= fftSize / 2; k++) {
        gains[k] = getWeightingGain(k * binWidth, weightType);
    }
    // Mirror for negative frequencies
    for (let k = fftSize / 2 + 1; k < fftSize; k++) {
        gains[k] = gains[fftSize - k];
    }

    const real = new Float64Array(fftSize);
    const imag = new Float64Array(fftSize);

    for (let start = 0; start < totalN; start += segmentLen) {
        const end = Math.min(start + segmentLen, totalN);
        const count = end - start;

        for (let i = 0; i < count; i++) real[i] = samples[start + i];
        for (let i = count; i < fftSize; i++) real[i] = 0;
        for (let i = 0; i < fftSize; i++) imag[i] = 0;

        fft(real, imag);

        for (let k = 0; k < fftSize; k++) {
            real[k] *= gains[k];
            imag[k] *= gains[k];
        }

        ifft(real, imag);

        const addEnd = Math.min(start + fftSize, totalN);
        for (let i = 0; i < addEnd - start; i++) {
            output[start + i] += real[i];
        }
    }

    return output;
}

// Hann window coefficients (cached per size)
const hannCache = {};
function hannWindow(N) {
    if (hannCache[N]) return hannCache[N];
    const w = new Float32Array(N);
    for (let i = 0; i < N; i++) {
        w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (N - 1)));
    }
    hannCache[N] = w;
    return w;
}

/**
 * Compute PSD using Welch's method.
 * @param {AudioBuffer} audioBuffer
 * @returns {{ freqs: Float64Array, power: Float64Array, cumPower: Float64Array, totalRmsDb: number, sampleRate: number }}
 */
export function computePSD(audioBuffer) {
    const sampleRate = audioBuffer.sampleRate;
    const samples = audioBuffer.getChannelData(0);
    const totalN = samples.length;

    // Choose FFT size: 8192 for short files, 16384 for longer
    const fftSize = totalN >= 32768 ? 16384 : 8192;
    const hopSize = fftSize >> 1; // 50% overlap
    const hann = hannWindow(fftSize);

    const numBins = (fftSize >> 1) + 1; // DC to Nyquist
    const avgPower = new Float64Array(numBins);

    // Compute window power for normalization
    let windowPowerSum = 0;
    for (let i = 0; i < fftSize; i++) windowPowerSum += hann[i] * hann[i];

    const real = new Float64Array(fftSize);
    const imag = new Float64Array(fftSize);

    let numSegments = 0;

    for (let start = 0; start + fftSize <= totalN; start += hopSize) {
        // Apply window
        for (let i = 0; i < fftSize; i++) {
            real[i] = samples[start + i] * hann[i];
            imag[i] = 0;
        }

        fft(real, imag);

        // Accumulate one-sided power spectrum
        // DC component
        avgPower[0] += (real[0] * real[0] + imag[0] * imag[0]);
        // Positive frequencies (doubled for one-sided)
        for (let k = 1; k < numBins - 1; k++) {
            avgPower[k] += 2 * (real[k] * real[k] + imag[k] * imag[k]);
        }
        // Nyquist
        const ny = numBins - 1;
        avgPower[ny] += (real[ny] * real[ny] + imag[ny] * imag[ny]);

        numSegments++;
    }

    // If file is shorter than one FFT window, zero-pad
    if (numSegments === 0) {
        for (let i = 0; i < fftSize; i++) {
            real[i] = i < totalN ? samples[i] * hann[i] : 0;
            imag[i] = 0;
        }
        fft(real, imag);
        avgPower[0] = real[0] * real[0] + imag[0] * imag[0];
        for (let k = 1; k < numBins - 1; k++) {
            avgPower[k] = 2 * (real[k] * real[k] + imag[k] * imag[k]);
        }
        const ny = numBins - 1;
        avgPower[ny] = real[ny] * real[ny] + imag[ny] * imag[ny];
        numSegments = 1;
    }

    // Normalize: average segments, scale by window power and sample rate
    const scale = 1 / (numSegments * windowPowerSum);
    for (let k = 0; k < numBins; k++) {
        avgPower[k] *= scale;
    }

    // Frequency array
    const freqs = new Float64Array(numBins);
    const binWidth = sampleRate / fftSize;
    for (let k = 0; k < numBins; k++) {
        freqs[k] = k * binWidth;
    }

    // Cumulative power (for fast band queries)
    // cumPower[i] = sum of power[0..i-1] * binWidth (power spectral density integrated)
    const cumPower = new Float64Array(numBins + 1);
    cumPower[0] = 0;
    for (let k = 0; k < numBins; k++) {
        cumPower[k + 1] = cumPower[k] + avgPower[k] * binWidth;
    }

    // Total RMS from PSD (Parseval's theorem: total power = integral of PSD)
    const totalPower = cumPower[numBins];
    const totalRmsDb = 10 * Math.log10(totalPower + 1e-30);

    return { freqs, power: avgPower, cumPower, totalRmsDb, sampleRate, binWidth, numBins };
}

/**
 * Query band power from pre-computed PSD using cumulative sum.
 * @param {object} psdData - result from computePSD
 * @param {number} f1 - lower frequency (Hz)
 * @param {number} f2 - upper frequency (Hz)
 * @returns {{ rms: number, rmsDb: number, relativeDb: number }}
 */
export function queryBandPower(psdData, f1, f2) {
    const { binWidth, numBins, cumPower, totalRmsDb } = psdData;

    // Map frequencies to bin indices (continuous for interpolation)
    const bin1 = Math.max(0, f1 / binWidth);
    const bin2 = Math.min(numBins, f2 / binWidth);

    // Integer bin range
    const i1 = Math.floor(bin1);
    const i2 = Math.min(Math.ceil(bin2), numBins);

    // Use cumulative sum for the integer range, then adjust edges
    let bandPower = cumPower[i2] - cumPower[i1];

    // Fractional edge correction (subtract partial bins)
    const frac1 = bin1 - i1;
    if (frac1 > 0 && i1 < numBins) {
        bandPower -= frac1 * psdData.power[i1] * binWidth;
    }
    const frac2 = i2 - bin2;
    if (frac2 > 0 && i2 > 0) {
        bandPower -= frac2 * psdData.power[i2 - 1] * binWidth;
    }

    bandPower = Math.max(bandPower, 1e-30);
    const rms = Math.sqrt(bandPower);
    const rmsDb = 10 * Math.log10(bandPower);
    const relativeDb = rmsDb - totalRmsDb;

    return { rms, rmsDb, relativeDb };
}
