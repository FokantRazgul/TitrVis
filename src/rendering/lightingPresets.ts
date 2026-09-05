/**
 * Lighting presets shared by the Three.js lights and the liquid shader's procedural
 * environment so that reflections on the liquid match the visible lighting mode.
 */
import * as THREE from 'three';
import type { LightingMode } from '../state/experimentStore';

export interface LightingPreset {
  name: string;
  background: THREE.Color;
  sky: THREE.Color;
  horizon: THREE.Color;
  ground: THREE.Color;
  keyDirection: THREE.Vector3;
  keyColour: THREE.Color;
  fillDirection: THREE.Vector3;
  fillColour: THREE.Color;
}

const linear = (hex: number) => new THREE.Color(hex).convertSRGBToLinear();

export const LIGHTING_PRESETS: Record<LightingMode, LightingPreset> = {
  1: {
    name: 'Laboratory',
    background: linear(0xdfe6ee),
    sky: linear(0xcfdbe8),
    horizon: linear(0xf2f2f0),
    ground: linear(0x8a7a66),
    keyDirection: new THREE.Vector3(0.45, 0.85, 0.35).normalize(),
    keyColour: linear(0xfff6e8),
    fillDirection: new THREE.Vector3(-0.7, 0.4, 0.6).normalize(),
    fillColour: linear(0x9fb3c8),
  },
  2: {
    name: 'Studio',
    background: linear(0x14161a),
    sky: linear(0x2a2d33),
    horizon: linear(0xf7f7f7),
    ground: linear(0x0c0c0e),
    keyDirection: new THREE.Vector3(0.6, 0.7, 0.4).normalize(),
    keyColour: linear(0xffffff),
    fillDirection: new THREE.Vector3(-0.8, 0.3, 0.5).normalize(),
    fillColour: linear(0x7d8fa8),
  },
  3: {
    name: 'Camera',
    background: linear(0x8a8f96),
    sky: linear(0xb7bcc4),
    horizon: linear(0xe6e6e6),
    ground: linear(0x5a5248),
    keyDirection: new THREE.Vector3(0.45, 0.85, 0.35).normalize(),
    keyColour: linear(0xfff6e8),
    fillDirection: new THREE.Vector3(-0.7, 0.4, 0.6).normalize(),
    fillColour: linear(0x9fb3c8),
  },
};
