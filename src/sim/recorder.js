/**
 * Records the viewport to a WebM video using the browser's own encoder —
 * MediaRecorder over canvas.captureStream(). No server, no ffmpeg.
 */
import { bus, T } from '../core/bus.js';
import { download } from '../io/io.js';
import { store } from '../core/doc.js';

export function recordingSupported() {
  return typeof MediaRecorder !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function';
}

function pickMime() {
  const options = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ];
  for (const m of options) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

/**
 * Play the timeline from 0 to `duration` while capturing each frame.
 * Resolves once the file has been handed to the browser.
 */
export function recordTimeline(viewport, sim, { fps = 30, onProgress = null } = {}) {
  return new Promise((resolve, reject) => {
    if (!recordingSupported()) { reject(new Error('This browser cannot record canvas video')); return; }

    const canvas = viewport.renderer.domElement;
    const stream = canvas.captureStream(0);
    const track = stream.getVideoTracks()[0];
    const mime = pickMime();
    let rec;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 12_000_000 } : undefined);
    } catch (e) { reject(e); return; }

    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    rec.onerror = (e) => reject(e.error || new Error('Recording failed'));
    rec.onstop = () => {
      const ext = mime.includes('mp4') ? '.mp4' : '.webm';
      const blob = new Blob(chunks, { type: mime || 'video/webm' });
      const name = (store.doc.meta.name || 'simulation').replace(/[^\w\-]+/g, '-').toLowerCase();
      download(`${name}${ext}`, blob, blob.type);
      resolve(blob);
    };

    const wasPlaying = sim.playing;
    sim.pause();
    const duration = sim.sim.duration;
    const total = Math.max(1, Math.round(duration * fps));
    let frame = 0;

    rec.start();
    bus.emit(T.STATUS, 'Recording…');

    const step = () => {
      if (frame > total) {
        track.requestFrame?.();
        setTimeout(() => { rec.stop(); if (wasPlaying) sim.play(); }, 220);
        return;
      }
      sim.seek((frame / total) * duration);
      viewport._renderFrame();
      track.requestFrame?.();
      if (onProgress) onProgress(frame / total);
      frame++;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}
