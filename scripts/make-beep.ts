/**
 * Generate assets/beep.wav: a 1 kHz tone of 120 ms followed by 280 ms of silence.
 * Played in a loop, that gives 2.5 beeps per second, in step with the 2.5 Hz flash.
 *
 *   npm run make-beep
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SAMPLE_RATE = 44_100;
const FREQUENCY_HZ = 1000;
const TONE_MS = 120;
const SILENCE_MS = 280;
const FADE_MS = 5; // short fade in/out: an abrupt start or stop sounds like a click
const VOLUME = 0.8;

const toneSamples = Math.round((SAMPLE_RATE * TONE_MS) / 1000);
const totalSamples = toneSamples + Math.round((SAMPLE_RATE * SILENCE_MS) / 1000);
const fadeSamples = Math.round((SAMPLE_RATE * FADE_MS) / 1000);

// WAV = 44-byte header + 16-bit signed little-endian PCM, mono.
const dataBytes = totalSamples * 2;
const wav = Buffer.alloc(44 + dataBytes);
wav.write('RIFF', 0, 'ascii');
wav.writeUInt32LE(36 + dataBytes, 4);
wav.write('WAVE', 8, 'ascii');
wav.write('fmt ', 12, 'ascii');
wav.writeUInt32LE(16, 16); // fmt chunk size
wav.writeUInt16LE(1, 20); // PCM
wav.writeUInt16LE(1, 22); // mono
wav.writeUInt32LE(SAMPLE_RATE, 24);
wav.writeUInt32LE(SAMPLE_RATE * 2, 28); // bytes per second
wav.writeUInt16LE(2, 32); // bytes per sample frame
wav.writeUInt16LE(16, 34); // bits per sample
wav.write('data', 36, 'ascii');
wav.writeUInt32LE(dataBytes, 40);

for (let i = 0; i < totalSamples; i++) {
  let value = 0;
  if (i < toneSamples) {
    const fade = Math.min(1, i / fadeSamples, (toneSamples - 1 - i) / fadeSamples);
    value = Math.sin((2 * Math.PI * FREQUENCY_HZ * i) / SAMPLE_RATE) * VOLUME * fade;
  }
  wav.writeInt16LE(Math.round(value * 32767), 44 + i * 2);
}

const out = join(__dirname, '..', 'assets', 'beep.wav');
writeFileSync(out, wav);
console.log(`Wrote ${out} (${TONE_MS} ms tone + ${SILENCE_MS} ms silence, ${wav.length} bytes)`);
