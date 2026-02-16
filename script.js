//Audio Context
const audioContext = new AudioContext();
let currentAudioBuffer= null;

//Status message
function showStatus(message){
    const status = document.getElementById('status');
    status.textContent = message;
    status.style.display = 'block';
}

//file input handler
document.getElementById('fileInput').addEventListener('change',async function(e) {
    const file = e.target.files[0];
    if(!file) return;

    showStatus('Loading audio file...');
    try {
        
        const arrayBuffer = await file.arrayBuffer();
        showStatus('Decoding audio');

        currentAudioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        showStatus('Computing spectrum...');

        const [rmsIntensity,peakIntensity] = computeRMSintensityAudioBuffer(currentAudioBuffer);
        
        const f1 = Number(document.getElementById('lowerFrequency').value);
        const f2 = Number(document.getElementById('upperFrequency').value);

        const [rmsBandIntensity,peakBandIntensity] = computeBandRMS(currentAudioBuffer, f1, f2);

        showStatus(`BandLimited RMS amplitude: ${rmsBandIntensity.toFixed(6)} (${(20*Math.log10(rmsBandIntensity)).toFixed(2)} dBFS) Peak Band Intensity ${peakBandIntensity.toFixed(6)} (${(20*Math.log10(peakBandIntensity)).toFixed(2)} dBFS)
           Total RMS amplitude: ${rmsIntensity.toFixed(6)} (${(20*Math.log10(rmsIntensity)).toFixed(2)} dBFS)  Peak Intensity ${peakIntensity.toFixed(6)} (${(20*Math.log10(peakIntensity)).toFixed(2)} dBFS)`);




    } catch (error) {
        showStatus('Error: ' + error.message);
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