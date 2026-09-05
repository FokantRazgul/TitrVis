/**
 * Device camera access for lighting mode 3. Requests the stream when the mode is active,
 * stops it when leaving. Failure (no permission, no device, insecure context) falls back to
 * laboratory lighting with a notification and never throws.
 */
import { useEffect, useState } from 'react';
import * as THREE from 'three';
import { useExperimentStore } from '../state/experimentStore';

export function useCameraStream(): THREE.VideoTexture | null {
  const lightingMode = useExperimentStore((s) => s.lightingMode);
  const [texture, setTexture] = useState<THREE.VideoTexture | null>(null);

  useEffect(() => {
    if (lightingMode !== 3) {
      setTexture(null);
      return;
    }
    let cancelled = false;
    let stream: MediaStream | null = null;
    let video: HTMLVideoElement | null = null;
    let tex: THREE.VideoTexture | null = null;
    const store = useExperimentStore.getState();
    const fail = (reason: string) => {
      if (cancelled) return;
      store.setCameraLightingAvailable(false);
      store.pushToast(`Camera lighting unavailable (${reason}). Laboratory lighting kept.`, 'warning');
      store.setLightingMode(1);
    };
    if (typeof navigator === 'undefined' || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      fail('no camera API');
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = s;
        video = document.createElement('video');
        video.srcObject = s;
        video.muted = true;
        video.playsInline = true;
        return video.play().then(() => {
          if (cancelled || !video) return;
          tex = new THREE.VideoTexture(video);
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.mapping = THREE.EquirectangularReflectionMapping;
          setTexture(tex);
          store.setCameraLightingAvailable(true);
        });
      })
      .catch((error: unknown) => {
        const name = error instanceof Error ? error.name : 'error';
        fail(name === 'NotAllowedError' ? 'permission denied' : name === 'NotFoundError' ? 'no camera found' : name);
      });
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
      if (video) {
        video.pause();
        video.srcObject = null;
      }
      tex?.dispose();
    };
  }, [lightingMode]);

  return texture;
}
