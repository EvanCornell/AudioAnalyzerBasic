import { computePSD, queryBandPower } from './psd.js';

//Audio Context
const audioContext = new AudioContext();
let currentAudioBuffer = null;
let currentPSD = null;

// Band list
const bands = [];

//Status message
function showStatus(message, type = 'loading'){
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = 'status visible ' + type;
}

// Band management
function addBand() {
    const f1Input = document.getElementById('lowerFrequency');
    const f2Input = document.getElementById('upperFrequency');
    const f1 = Number(f1Input.value);
    const f2 = Number(f2Input.value);

    if (!f1 || !f2 || f1 >= f2) {
        showStatus('Enter valid frequencies (lower < upper).', 'error');
        return;
    }

    bands.push({ f1, f2 });
    f1Input.value = '';
    f2Input.value = '';
    f1Input.focus();
    renderBandChips();

    if (currentAudioBuffer) {
        analyzeAndRender();
    }
}

function removeBand(index) {
    bands.splice(index, 1);
    renderBandChips();

    if (currentAudioBuffer) {
        analyzeAndRender();
    }
}

function renderBandChips() {
    const container = document.getElementById('bandList');
    container.innerHTML = '';
    bands.forEach((band, i) => {
        const chip = document.createElement('span');
        chip.className = 'band-chip';
        chip.innerHTML = `${band.f1} – ${band.f2} Hz<button onclick="removeBand(${i})">&times;</button>`;
        container.appendChild(chip);
    });
}

// Wire up Add button and Enter key
document.getElementById('addBandBtn').addEventListener('click', addBand);
document.getElementById('upperFrequency').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') addBand();
});
document.getElementById('lowerFrequency').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') addBand();
});

// Progress bar helpers
function showProgress(pct) {
    const bar = document.getElementById('progressBar');
    const fill = document.getElementById('progressFill');
    const text = document.getElementById('progressText');
    bar.style.display = 'block';
    fill.style.width = pct + '%';
    text.textContent = Math.round(pct) + '%';
}

function hideProgress() {
    document.getElementById('progressBar').style.display = 'none';
}

// Yield to browser so it can repaint
function yieldToUI() {
    return new Promise(resolve => setTimeout(resolve, 0));
}

// Peak octave band finder
let sweepRunning = false;

async function findPeakBand() {
    if (sweepRunning) return;
    if (!currentAudioBuffer) {
        showStatus('Load an audio file first.', 'error');
        return;
    }

    const octaves = Number(document.getElementById('octaveWidth').value);
    if (!octaves || octaves <= 0) {
        showStatus('Enter a valid octave width (e.g. 1).', 'error');
        return;
    }

    sweepRunning = true;
    document.getElementById('findPeakBtn').disabled = true;
    showStatus('Sweeping bands...', 'loading');
    showProgress(0);

    const halfOct = octaves / 2;
    const minF = 20;
    const maxF = 20000;

    const steps = 200;
    const logMin = Math.log2(minF * Math.pow(2, halfOct));
    const logMax = Math.log2(maxF / Math.pow(2, halfOct));

    if (logMin >= logMax) {
        showStatus('Octave width too large for 20–20k range.', 'error');
        hideProgress();
        sweepRunning = false;
        document.getElementById('findPeakBtn').disabled = false;
        return;
    }

    let bestRms = -1;
    let bestF1 = 0;
    let bestF2 = 0;
    let bestPeak = 0;

    const BATCH = 5; // process 5 steps before yielding

    for (let i = 0; i <= steps; i++) {
        const logFc = logMin + (logMax - logMin) * (i / steps);
        const fc = Math.pow(2, logFc);
        const f1 = fc / Math.pow(2, halfOct);
        const f2 = fc * Math.pow(2, halfOct);

        const [rms, peak] = computeBandRMS(currentAudioBuffer, f1, f2);
        if (rms > bestRms) {
            bestRms = rms;
            bestPeak = peak;
            bestF1 = f1;
            bestF2 = f2;
        }

        // Yield every BATCH steps to let the browser repaint
        if (i % BATCH === 0) {
            showProgress((i / steps) * 100);
            await yieldToUI();
        }
    }

    showProgress(100);

    // Display result
    document.getElementById('peakBandLabel').textContent =
        `${Math.round(bestF1)} – ${Math.round(bestF2)} Hz`;
    document.getElementById('peakBandRms').textContent = bestRms.toFixed(6);
    document.getElementById('peakBandRmsDb').textContent =
        (20 * Math.log10(bestRms)).toFixed(2) + ' dB';
    document.getElementById('peakBandPeak').textContent = bestPeak.toFixed(6);
    document.getElementById('peakBandPeakDb').textContent =
        (20 * Math.log10(bestPeak)).toFixed(2) + ' dB';
    document.getElementById('peakBandResult').style.display = 'block';

    hideProgress();
    sweepRunning = false;
    document.getElementById('findPeakBtn').disabled = false;
    showStatus('Peak band found.', 'success');
}

document.getElementById('findPeakBtn').addEventListener('click', findPeakBand);
document.getElementById('octaveWidth').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') findPeakBand();
});

// Analysis + rendering
function analyzeAndRender() {
    const [rmsIntensity, peakIntensity] = computeRMSintensityAudioBuffer(currentAudioBuffer);

    // Total signal
    document.getElementById('rmsValue').textContent = rmsIntensity.toFixed(6);
    document.getElementById('rmsDb').textContent = (20 * Math.log10(rmsIntensity)).toFixed(2) + ' dB';
    document.getElementById('peakValue').textContent = peakIntensity.toFixed(6);
    document.getElementById('peakDb').textContent = (20 * Math.log10(peakIntensity)).toFixed(2) + ' dB';

    // Remove old dynamic band blocks
    const grid = document.getElementById('resultsGrid');
    grid.querySelectorAll('.band-result-block').forEach(el => el.remove());

    // Compute and render each band
    bands.forEach(band => {
        const [rms, peak] = computeBandRMS(currentAudioBuffer, band.f1, band.f2);
        const rmsDb = (20 * Math.log10(rms)).toFixed(2);
        const peakDb = (20 * Math.log10(peak)).toFixed(2);

        const block = document.createElement('div');
        block.className = 'result-block band-result-block';
        block.innerHTML = `
            <h3>${band.f1} – ${band.f2} Hz</h3>
            <div class="result-row">
                <span class="result-label">RMS Amplitude</span>
                <span class="result-value">${rms.toFixed(6)}</span>
            </div>
            <div class="result-row">
                <span class="result-label">RMS (dBFS)</span>
                <span class="result-value">${rmsDb} dB</span>
            </div>
            <div class="result-row">
                <span class="result-label">Peak Amplitude</span>
                <span class="result-value">${peak.toFixed(6)}</span>
            </div>
            <div class="result-row">
                <span class="result-label">Peak (dBFS)</span>
                <span class="result-value">${peakDb} dB</span>
            </div>
        `;
        grid.appendChild(block);
    });

    document.getElementById('resultsCard').style.display = 'block';
    showStatus('Analysis complete.', 'success');
}

//file input handler
document.getElementById('fileInput').addEventListener('change',async function(e) {
    const file = e.target.files[0];
    if(!file) return;

    document.getElementById('fileName').textContent = file.name;
    showStatus('Loading audio file...');

    try {
        const arrayBuffer = await file.arrayBuffer();
        showStatus('Decoding audio...');

        currentAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        showStatus('Analyzing...');

        analyzeAndRender();

    } catch (error) {
        showStatus('Error: ' + error.message, 'error');
        console.log(error);
    }
});

function computeRMSintensity(samples){
    const N = samples.length;

    let sumSq = 0;
    let maxAmplitude = 0;
    for(let i = 0; i < N; i++){
        const x = samples[i];
        sumSq += x * x;
        if (Math.abs(x) > maxAmplitude){
            maxAmplitude = Math.abs(x);
        }
    }

    const meanSq = sumSq / N;
    const rms = Math.sqrt(meanSq);

    return [rms,maxAmplitude];
}

function computeRMSintensityAudioBuffer(audioBuffer){
    const channelData = audioBuffer.getChannelData(0);
    return computeRMSintensity(channelData);
}

function computeBandLimitedRMSintensity(samples){
    const N = samples.length;

    let sumSq = 0;
    let maxAmplitude = 0;
    for(let i = 0; i < N; i++){
        const x = samples[i];
        sumSq += x * x;
        if (Math.abs(x) > maxAmplitude){
            maxAmplitude = Math.abs(x);
        }
    }

    const meanSq = sumSq / N;
    const rms = Math.sqrt(meanSq);

    return [rms,maxAmplitude];
}

function makeBandpassBiquad(sampleRate, f0, Q) {
    const w0 = 2 * Math.PI * f0 / sampleRate;
    const cosw0 = Math.cos(w0);
    const sinw0 = Math.sin(w0);
    const alpha = sinw0 / (2 * Q);

    // Band-pass (constant skirt gain, peak gain = Q)
    const b0 =  alpha;
    const b1 =  0;
    const b2 = -alpha;
    const a0 =  1 + alpha;
    const a1 = -2 * cosw0;
    const a2 =  1 - alpha;

    return {
        b0: b0 / a0,
        b1: b1 / a0,
        b2: b2 / a0,
        a1: a1 / a0,
        a2: a2 / a0
    };
}

function applyBiquad(input, coeffs) {
    const output = new Float32Array(input.length);

    let x1 = 0, x2 = 0;
    let y1 = 0, y2 = 0;

    for (let i = 0; i < input.length; i++) {
        const x0 = input[i];

        const y0 =
            coeffs.b0 * x0 +
            coeffs.b1 * x1 +
            coeffs.b2 * x2 -
            coeffs.a1 * y1 -
            coeffs.a2 * y2;

        output[i] = y0;

        x2 = x1; x1 = x0;
        y2 = y1; y1 = y0;
    }

    return output;
}

function computeBandRMS(audioBuffer, f1, f2) {
    const sampleRate = audioBuffer.sampleRate;
    const input = audioBuffer.getChannelData(0);

    const f0 = Math.sqrt(f1 * f2);
    const Q  = f0 / (f2 - f1);

    const biquad = makeBandpassBiquad(sampleRate, f0, Q);
    const filtered = applyBiquad(input, biquad);

    return computeRMSintensity(filtered);
}

// ============================================================
// Spectrum Analyzer — PSD graph + draggable band
// ============================================================

const MIN_F = 20;
const MAX_F = 20000;
const GRAPH_PAD = { top: 20, right: 20, bottom: 45, left: 55 };

// Band state
let bandF1 = 200;
let bandF2 = 400;

// Drag state
let dragMode = null; // 'left' | 'right' | 'center' | null
let dragStartX = 0;
let dragStartF1 = 0;
let dragStartF2 = 0;

// Canvas + elements
const psdCanvas = document.getElementById('psdCanvas');
const ctx = psdCanvas.getContext('2d');

// --- Frequency <-> pixel mapping (log scale) ---
function freqToX(f) {
    const plotW = psdCanvas.width - GRAPH_PAD.left - GRAPH_PAD.right;
    const logRatio = Math.log10(f / MIN_F) / Math.log10(MAX_F / MIN_F);
    return GRAPH_PAD.left + logRatio * plotW;
}

function xToFreq(x) {
    const plotW = psdCanvas.width - GRAPH_PAD.left - GRAPH_PAD.right;
    const logRatio = (x - GRAPH_PAD.left) / plotW;
    return MIN_F * Math.pow(MAX_F / MIN_F, logRatio);
}

function dbToY(db, dbMin, dbMax) {
    const plotH = psdCanvas.height - GRAPH_PAD.top - GRAPH_PAD.bottom;
    const ratio = (db - dbMax) / (dbMin - dbMax);
    return GRAPH_PAD.top + ratio * plotH;
}

// --- Draw PSD graph ---
function drawPSD() {
    if (!currentPSD) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = psdCanvas.parentElement.getBoundingClientRect();
    const cssW = rect.width;
    const cssH = 300;
    psdCanvas.style.width = cssW + 'px';
    psdCanvas.style.height = cssH + 'px';
    psdCanvas.width = cssW * dpr;
    psdCanvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const w = cssW;
    const h = cssH;
    const plotL = GRAPH_PAD.left;
    const plotR = w - GRAPH_PAD.right;
    const plotT = GRAPH_PAD.top;
    const plotB = h - GRAPH_PAD.bottom;

    // Clear
    ctx.fillStyle = '#12121f';
    ctx.fillRect(0, 0, w, h);

    // Compute dB values for PSD curve
    const { freqs, power, numBins } = currentPSD;
    const psdDb = [];
    let dbMin = 0, dbMax = -200;
    for (let k = 1; k < numBins; k++) {
        const f = freqs[k];
        if (f < MIN_F || f > MAX_F) continue;
        const db = 10 * Math.log10(power[k] + 1e-30);
        psdDb.push({ f, db });
        if (db < dbMin) dbMin = db;
        if (db > dbMax) dbMax = db;
    }

    // Round dB range to nice 10dB steps
    dbMax = Math.ceil(dbMax / 10) * 10;
    dbMin = Math.floor(dbMin / 10) * 10;
    if (dbMax - dbMin < 20) dbMin = dbMax - 20;

    // Draw grid lines + Y labels
    ctx.strokeStyle = '#2a2a40';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#666';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let db = dbMin; db <= dbMax; db += 10) {
        const y = dbToY(db, dbMin, dbMax);
        ctx.beginPath();
        ctx.moveTo(plotL, y);
        ctx.lineTo(plotR, y);
        ctx.stroke();
        ctx.fillText(db + '', plotL - 8, y);
    }

    // X-axis labels (octave frequencies)
    const xLabels = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const f of xLabels) {
        const x = freqToX(f);
        if (x < plotL || x > plotR) continue;
        ctx.beginPath();
        ctx.moveTo(x, plotT);
        ctx.lineTo(x, plotB);
        ctx.stroke();
        const label = f >= 1000 ? (f / 1000) + 'k' : f + '';
        ctx.fillText(label, x, plotB + 6);
    }

    // Axis labels
    ctx.fillStyle = '#555';
    ctx.font = '11px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Frequency (Hz)', (plotL + plotR) / 2, plotB + 28);
    ctx.save();
    ctx.translate(14, (plotT + plotB) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('dBFS / Hz', 0, 0);
    ctx.restore();

    // Draw band overlay
    const bx1 = Math.max(plotL, freqToX(bandF1));
    const bx2 = Math.min(plotR, freqToX(bandF2));
    ctx.fillStyle = 'rgba(110, 142, 251, 0.15)';
    ctx.fillRect(bx1, plotT, bx2 - bx1, plotB - plotT);
    // Band edges
    ctx.strokeStyle = 'rgba(110, 142, 251, 0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(bx1, plotT); ctx.lineTo(bx1, plotB);
    ctx.moveTo(bx2, plotT); ctx.lineTo(bx2, plotB);
    ctx.stroke();

    // Draw PSD curve
    ctx.strokeStyle = '#6e8efb';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    let started = false;
    for (const pt of psdDb) {
        const x = freqToX(pt.f);
        const y = dbToY(pt.db, dbMin, dbMax);
        const cy = Math.max(plotT, Math.min(plotB, y));
        if (!started) { ctx.moveTo(x, cy); started = true; }
        else ctx.lineTo(x, cy);
    }
    ctx.stroke();

    // Plot border
    ctx.strokeStyle = '#3a3a55';
    ctx.lineWidth = 1;
    ctx.strokeRect(plotL, plotT, plotR - plotL, plotB - plotT);
}

// --- Update readout ---
function updateReadout() {
    if (!currentPSD) return;
    const result = queryBandPower(currentPSD, bandF1, bandF2);
    const octaves = Math.log2(bandF2 / bandF1);

    document.getElementById('readoutBand').textContent =
        `${Math.round(bandF1)} – ${Math.round(bandF2)} Hz (${octaves.toFixed(2)} oct)`;
    document.getElementById('readoutBandDb').textContent = result.rmsDb.toFixed(2);
    document.getElementById('readoutRelDb').textContent =
        (result.relativeDb >= 0 ? '+' : '') + result.relativeDb.toFixed(2);

    // Sync inputs
    document.getElementById('bandLower').value = Math.round(bandF1);
    document.getElementById('bandUpper').value = Math.round(bandF2);
    document.getElementById('bandOctaves').value = octaves.toFixed(2);
}

function refreshSpectrum() {
    drawPSD();
    updateReadout();
}

// --- Input controls ---
function onBandLowerInput() {
    let f1 = Number(document.getElementById('bandLower').value);
    if (!f1 || f1 < MIN_F) return;
    f1 = Math.min(f1, MAX_F - 1);

    if (document.getElementById('lockOctave').checked) {
        const oct = Number(document.getElementById('bandOctaves').value);
        bandF1 = f1;
        bandF2 = Math.min(f1 * Math.pow(2, oct), MAX_F);
    } else {
        bandF1 = f1;
        if (bandF1 >= bandF2) bandF2 = Math.min(bandF1 * 2, MAX_F);
    }
    refreshSpectrum();
}

function onBandUpperInput() {
    let f2 = Number(document.getElementById('bandUpper').value);
    if (!f2 || f2 < MIN_F) return;
    f2 = Math.min(f2, MAX_F);

    if (document.getElementById('lockOctave').checked) {
        const oct = Number(document.getElementById('bandOctaves').value);
        bandF2 = f2;
        bandF1 = Math.max(f2 / Math.pow(2, oct), MIN_F);
    } else {
        bandF2 = f2;
        if (bandF2 <= bandF1) bandF1 = Math.max(bandF2 / 2, MIN_F);
    }
    refreshSpectrum();
}

function onBandOctavesInput() {
    const oct = Number(document.getElementById('bandOctaves').value);
    if (!oct || oct <= 0) return;
    bandF2 = Math.min(bandF1 * Math.pow(2, oct), MAX_F);
    refreshSpectrum();
}

document.getElementById('bandLower').addEventListener('input', onBandLowerInput);
document.getElementById('bandUpper').addEventListener('input', onBandUpperInput);
document.getElementById('bandOctaves').addEventListener('input', onBandOctavesInput);

// --- Canvas drag interaction ---
const EDGE_THRESHOLD = 8; // pixels

function getCanvasX(e) {
    const rect = psdCanvas.getBoundingClientRect();
    return e.clientX - rect.left;
}

function hitTest(cx) {
    const lx = freqToX(bandF1);
    const rx = freqToX(bandF2);
    if (Math.abs(cx - lx) < EDGE_THRESHOLD) return 'left';
    if (Math.abs(cx - rx) < EDGE_THRESHOLD) return 'right';
    if (cx > lx + EDGE_THRESHOLD && cx < rx - EDGE_THRESHOLD) return 'center';
    return null;
}

psdCanvas.addEventListener('mousemove', function(e) {
    if (dragMode) return; // cursor set during drag
    const zone = hitTest(getCanvasX(e));
    if (zone === 'left' || zone === 'right') psdCanvas.style.cursor = 'ew-resize';
    else if (zone === 'center') psdCanvas.style.cursor = 'grab';
    else psdCanvas.style.cursor = 'default';
});

psdCanvas.addEventListener('mousedown', function(e) {
    const cx = getCanvasX(e);
    const zone = hitTest(cx);
    if (!zone) return;
    dragMode = zone;
    dragStartX = cx;
    dragStartF1 = bandF1;
    dragStartF2 = bandF2;
    if (zone === 'center') psdCanvas.style.cursor = 'grabbing';
    e.preventDefault();
});

window.addEventListener('mousemove', function(e) {
    if (!dragMode) return;
    const cx = getCanvasX(e);
    const locked = document.getElementById('lockOctave').checked;
    const octWidth = Math.log2(dragStartF2 / dragStartF1);

    if (dragMode === 'left') {
        let newF1 = Math.max(MIN_F, Math.min(xToFreq(cx), MAX_F));
        if (locked) {
            bandF1 = newF1;
            bandF2 = Math.min(newF1 * Math.pow(2, octWidth), MAX_F);
        } else {
            bandF1 = Math.min(newF1, bandF2 - 1);
        }
    } else if (dragMode === 'right') {
        let newF2 = Math.max(MIN_F, Math.min(xToFreq(cx), MAX_F));
        if (locked) {
            bandF2 = newF2;
            bandF1 = Math.max(newF2 / Math.pow(2, octWidth), MIN_F);
        } else {
            bandF2 = Math.max(newF2, bandF1 + 1);
        }
    } else if (dragMode === 'center') {
        const startFreq = xToFreq(dragStartX);
        const nowFreq = xToFreq(cx);
        const ratio = nowFreq / startFreq;
        let newF1 = dragStartF1 * ratio;
        let newF2 = dragStartF2 * ratio;
        // Clamp to range
        if (newF1 < MIN_F) { newF2 *= MIN_F / newF1; newF1 = MIN_F; }
        if (newF2 > MAX_F) { newF1 *= MAX_F / newF2; newF2 = MAX_F; }
        bandF1 = newF1;
        bandF2 = newF2;
    }

    refreshSpectrum();
});

window.addEventListener('mouseup', function() {
    if (dragMode) {
        dragMode = null;
        psdCanvas.style.cursor = 'default';
    }
});

// --- Integrate PSD computation into file load ---
const origAnalyzeAndRender = analyzeAndRender;

// Wrap analyzeAndRender to also compute PSD
analyzeAndRender = function() {
    origAnalyzeAndRender();

    showStatus('Computing spectrum...', 'loading');
    currentPSD = computePSD(currentAudioBuffer);
    document.getElementById('spectrumCard').style.display = 'block';
    refreshSpectrum();
    showStatus('Analysis complete.', 'success');
};

// Redraw on window resize
window.addEventListener('resize', function() {
    if (currentPSD) drawPSD();
});