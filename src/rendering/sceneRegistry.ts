/**
 * Module-level access to the live Three.js renderer/scene/camera for imperative features
 * (screenshot capture). Set by the Scene component; cleared on unmount.
 */
import type * as THREE from 'three';

export interface SceneHandles {
  gl: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
}

let handles: SceneHandles | null = null;

export function registerScene(next: SceneHandles | null): void {
  handles = next;
}

export function getSceneHandles(): SceneHandles | null {
  return handles;
}
