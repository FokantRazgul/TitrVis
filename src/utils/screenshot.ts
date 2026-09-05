/**
 * Screenshot capture: renders the live 3D scene into the WebGL canvas, copies it to a 2D canvas
 * and composes the key experiment data (a HUD with substances, pH, volume and the titration
 * curve image from Plotly) on top, then downloads a PNG. Nothing is faked: the scene pixels
 * come from an explicit render call issued right before reading the canvas, which is the
 * correct approach when preserveDrawingBuffer is off.
 */

import { getSceneHandles } from '../rendering/sceneRegistry';
import { downloadBlob, timestampForFilename } from './export';

export interface ScreenshotOverlay {
  lines: string[];
  /** PNG data URL of the titration graph, if available. */
  graphDataUrl?: string;
  dark: boolean;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('graph image failed to load'));
    img.src = src;
  });
}

/** Render the scene and return the composed PNG as a Blob (null when WebGL is unavailable). */
export async function captureScreenshot(overlay: ScreenshotOverlay, includeOverlay = true): Promise<Blob | null> {
  const handles = getSceneHandles();
  if (!handles) return null;
  const { gl, scene, camera } = handles;
  // Render synchronously so the drawing buffer holds the current frame when we read it.
  gl.render(scene, camera);
  const source = gl.domElement;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0);

  if (includeOverlay) {
    const scale = Math.max(1, canvas.width / 1400);
    const pad = 18 * scale;
    const lineHeight = 22 * scale;
    ctx.font = `${14 * scale}px system-ui, sans-serif`;
    const width = Math.max(...overlay.lines.map((l) => ctx.measureText(l).width)) + pad * 2;
    const height = overlay.lines.length * lineHeight + pad * 1.5;
    ctx.fillStyle = overlay.dark ? 'rgba(20,22,28,0.78)' : 'rgba(255,255,255,0.82)';
    ctx.fillRect(pad, pad, width, height);
    ctx.fillStyle = overlay.dark ? '#f2f4f8' : '#111318';
    overlay.lines.forEach((line, i) => ctx.fillText(line, pad * 2, pad * 1.4 + lineHeight * (i + 0.6)));
    if (overlay.graphDataUrl) {
      try {
        const img = await loadImage(overlay.graphDataUrl);
        const gw = Math.min(canvas.width * 0.32, img.width);
        const gh = (gw / img.width) * img.height;
        ctx.fillStyle = overlay.dark ? 'rgba(20,22,28,0.85)' : 'rgba(255,255,255,0.9)';
        ctx.fillRect(canvas.width - gw - pad * 1.5, pad, gw + pad, gh + pad);
        ctx.drawImage(img, canvas.width - gw - pad, pad * 1.5, gw, gh);
      } catch {
        // The graph inset is optional; the scene capture is still valid.
      }
    }
  }
  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'));
}

export async function downloadScreenshot(overlay: ScreenshotOverlay): Promise<boolean> {
  const blob = await captureScreenshot(overlay);
  if (!blob) return false;
  return downloadBlob(blob, `titrvis-${timestampForFilename()}.png`);
}
