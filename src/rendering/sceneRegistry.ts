/**
 * Module-level access to the live Three.js renderer/scene/camera for imperative features
 * (screenshot capture). Set by the Scene component; cleared on unmount.
 */
import type * as THREE from 'three';

/** The subset of OrbitControls used imperatively (camera framing in diagnostics/tests). */
export interface CameraControlsHandle {
  target: THREE.Vector3;
  minDistance: number;
  maxDistance: number;
  minPolarAngle: number;
  maxPolarAngle: number;
  update: () => void;
}

export interface SceneHandles {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** Orbit controls of the default camera, when mounted. */
  controls: CameraControlsHandle | null;
}

let handles: SceneHandles | null = null;
let controls: CameraControlsHandle | null = null;

export function registerScene(next: Omit<SceneHandles, 'controls'> | null): void {
  handles = next ? { ...next, controls } : null;
}

export function registerCameraControls(next: CameraControlsHandle | null): void {
  controls = next;
  if (handles) handles.controls = next;
}

export function getSceneHandles(): SceneHandles | null {
  return handles;
}
