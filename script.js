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

        const [rmsIntensity,peakIntensity] = computeRMSintensity(currentAudioBuffer);
        
        const canvas = document.getElementById('canvas');
        canvas.width = 1000;
        canvas.height = 500;
        showStatus(`RMS amplitude: ${rmsIntensity.toFixed(6)} (${(20*Math.log10(rmsIntensity)).toFixed(2)} dBFS)  Peak Intensity ${peakIntensity.toFixed(6)} (${(20*Math.log10(peakIntensity)).toFixed(2)} dBFS)`);
        
    } catch (error) {
        showStatus('Error: ' + error.message);
        console.log(error);
    }
});

function computeRMSintensity(audioBuffer){
    const channelData = audioBuffer.getChannelData(0);
    const N = channelData.length;

    let sumSq = 0;
    let maxAmplitude = 0;
    for(let i = 0; i < N; i++){
        const x = channelData[i];
        sumSq += x * x;
        if (Math.abs(x) > maxAmplitude){
            maxAmplitude = Math.abs(x);
        }
    }

    const meanSq = sumSq / N;
    const rms = Math.sqrt(meanSq);

    return [rms,maxAmplitude];
}