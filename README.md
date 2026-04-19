# RMS Audio Analyzer

A browser-based audio analysis tool that computes RMS intensity, peak levels, and spectral content of audio files — all client-side with no uploads required.

**Live demo:** [https://EvanCornell.github.io/AudioAnalyzerBasic/](https://EvanCornell.github.io/AudioAnalyzerBasic/)

## Features

- **Total signal analysis** — RMS amplitude and peak amplitude for the full track, reported in linear scale and dBFS
- **Frequency band analysis** — Add custom frequency bands (Hz) to measure RMS and peak levels per band, with relative dB level vs. the total signal
- **Peak Band Finder** — Sweeps a band of N octaves across 20 Hz–20 kHz to find where RMS energy is highest
- **Spectrum Analyzer** — Interactive PSD (power spectral density) graph with a draggable analysis band; shows band RMS in dBFS and relative level
- **Frequency weighting** — Z (flat), A, B, and C weighting curves

## Supported Formats

Any format supported by your browser's Web Audio API: WAV, MP3, OGG, FLAC, AAC, and more.

## Usage

1. Open `index.html` in a browser (or visit the live demo link above)
2. Upload an audio file using the file picker
3. Results appear automatically in the **Results** section
4. Optionally:
   - Add frequency bands in the **Frequency Bands** section to compare specific ranges
   - Use the **Peak Band Finder** to locate the loudest frequency region by octave width
   - Interact with the **Spectrum Analyzer** graph — drag the band edges or center to explore different frequency regions
   - Switch weighting curves to apply A/B/C-weighting to all measurements

## How It Works

Audio is decoded entirely in the browser using the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API). No data is sent to a server.

- **RMS** is computed directly on PCM samples: `sqrt(mean(x²))`
- **Band-limited RMS** uses a biquad bandpass filter centered at the geometric mean of the band edges
- **PSD** is computed via FFT (see `psd.js`) and displayed on a log-frequency axis
- **Frequency weighting** applies IIR filter coefficients for standard A/B/C curves before analysis

## Project Structure

```
index.html   — UI layout
script.js    — Main analysis logic, UI wiring, spectrum analyzer
psd.js       — FFT-based power spectral density, band power queries, frequency weighting
style.css    — Styles
```
