//Audio Context
const audioContext = new AudioContext();
let currentAudioBuffer = null;

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

// Peak octave band finder
function findPeakBand() {
    if (!currentAudioBuffer) {
        showStatus('Load an audio file first.', 'error');
        return;
    }

    const octaves = Number(document.getElementById('octaveWidth').value);
    if (!octaves || octaves <= 0) {
        showStatus('Enter a valid octave width (e.g. 1).', 'error');
        return;
    }

    showStatus('Sweeping bands...', 'loading');

    const halfOct = octaves / 2;
    const minF = 20;
    const maxF = 20000;

    // Sweep center frequencies in log space
    const steps = 200;
    const logMin = Math.log2(minF * Math.pow(2, halfOct));
    const logMax = Math.log2(maxF / Math.pow(2, halfOct));

    if (logMin >= logMax) {
        showStatus('Octave width too large for 20–20k range.', 'error');
        return;
    }

    let bestRms = -1;
    let bestF1 = 0;
    let bestF2 = 0;
    let bestPeak = 0;

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
    }

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