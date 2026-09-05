/**
 * Liquid body (side wall + deformable free surface) rendered with the liquid shader.
 * All chemical inputs (bulk absorbance, local colour LUT) come from the store's visual state;
 * spatial inputs (volumetric mixing atlas, surface heights/normals) from the simulation manager.
 */

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import liquidFrag from '../shaders/liquid/liquid.frag.glsl?raw';
import liquidVert from '../shaders/liquid/liquid.vert.glsl?raw';
import volumeGlsl from '../shaders/mixing/volume.glsl?raw';
import { useExperimentStore } from '../state/experimentStore';
import { LOCAL_LUT_SIZE } from '../state/visualState';
import { useSimulationManager } from './SimulationContext';
import { LIGHTING_PRESETS } from './lightingPresets';

/** Layer used to exclude the liquid from the background render pass. */
export const LIQUID_LAYER = 1;

interface LiquidProps {
  background: THREE.Texture;
}

const SURFACE_N = 64;
/** Ray-march steps through the volumetric mixing field per liquid pixel. */
const MARCH_STEPS = { high: 12, low: 6 } as const;
const SIDE_SEGMENTS = 72;
const SIDE_RINGS = 40;

export function Liquid({ background }: LiquidProps) {
  const manager = useSimulationManager();
  const { gl } = useThree();
  const sideMesh = useRef<THREE.Mesh>(null);
  const surfaceMesh = useRef<THREE.Mesh>(null);
  const lastHeight = useRef(-1);
  const lastRadius = useRef(-1);

  const lutData = useMemo(() => new Float32Array(LOCAL_LUT_SIZE * 4).fill(1), []);
  const lutTexture = useMemo(() => {
    const tex = new THREE.DataTexture(lutData, LOCAL_LUT_SIZE, 1, THREE.RGBAFormat, THREE.FloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }, [lutData]);

  const uniforms = useMemo(
    () => ({
      uBackground: { value: background },
      uVolume: { value: manager.mixing.texture },
      uVolumeTexel: { value: 1 / manager.mixing.tileResolution },
      uRefRadius: { value: manager.mixing.geometry.refRadius },
      uRadiusTop: { value: manager.mixing.geometry.radiusTop },
      uRadiusBottom: { value: manager.mixing.geometry.radiusBottom },
      uLut: { value: lutTexture },
      uBulkAbsorbance: { value: new THREE.Vector3(0, 0, 0) },
      uReferencePathCm: { value: 4 },
      uSurfaceRadius: { value: 0.03 },
      uLiquidTop: { value: 0.02 },
      uFloorY: { value: 0 },
      uSkyColour: { value: new THREE.Color(0.75, 0.82, 0.9) },
      uHorizonColour: { value: new THREE.Color(0.9, 0.9, 0.9) },
      uGroundColour: { value: new THREE.Color(0.35, 0.3, 0.25) },
      uLight0Dir: { value: new THREE.Vector3(0.5, 0.8, 0.4).normalize() },
      uLight0Colour: { value: new THREE.Color(1, 1, 1) },
      uLight1Dir: { value: new THREE.Vector3(-0.6, 0.5, 0.6).normalize() },
      uLight1Colour: { value: new THREE.Color(0.6, 0.6, 0.65) },
      uScatter: { value: 0.18 },
      uOpacityFloor: { value: 1.0 },
      uInverseModel: { value: new THREE.Matrix4() },
      uIsSurface: { value: 0 },
      uRefractionStrength: { value: 0.05 },
      uEnvIntensity: { value: 2.6 },
      uMarchSteps: { value: MARCH_STEPS.high as number },
    }),
    [background, lutTexture, manager],
  );

  const sideMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: liquidVert,
        fragmentShader: `${volumeGlsl}\n${liquidFrag}`,
        uniforms,
        side: THREE.FrontSide,
        transparent: false,
        toneMapped: true,
      }),
    [uniforms],
  );
  const surfaceMaterial = useMemo(() => {
    const m = sideMaterial.clone();
    m.uniforms = { ...uniforms, uIsSurface: { value: 1 } };
    m.side = THREE.DoubleSide;
    return m;
  }, [sideMaterial, uniforms]);

  // Surface grid geometry: N×N plane, positions updated each frame from the wave simulation.
  const surfaceGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const n = SURFACE_N;
    const positions = new Float32Array(n * n * 3);
    const normals = new Float32Array(n * n * 3);
    const indices: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      for (let i = 0; i < n - 1; i++) {
        const a = j * n + i;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geom.setIndex(indices);
    return geom;
  }, []);

  const sideGeometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    const positions = new Float32Array((SIDE_RINGS + 1) * (SIDE_SEGMENTS + 1) * 3);
    const normals = new Float32Array((SIDE_RINGS + 1) * (SIDE_SEGMENTS + 1) * 3);
    const indices: number[] = [];
    for (let r = 0; r < SIDE_RINGS; r++) {
      for (let s = 0; s < SIDE_SEGMENTS; s++) {
        const a = r * (SIDE_SEGMENTS + 1) + s;
        const b = a + 1;
        const c = a + SIDE_SEGMENTS + 1;
        const d = c + 1;
        // Counter-clockwise seen from outside so that the outward normals are the front faces.
        indices.push(a, c, b, b, c, d);
      }
    }
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geom.setIndex(indices);
    return geom;
  }, []);

  useEffect(() => {
    return () => {
      surfaceGeometry.dispose();
      sideGeometry.dispose();
      sideMaterial.dispose();
      surfaceMaterial.dispose();
      lutTexture.dispose();
    };
  }, [surfaceGeometry, sideGeometry, sideMaterial, surfaceMaterial, lutTexture]);

  /**
   * Rebuild the side wall: a lathe of the inner profile whose top ring follows the sloshing free
   * surface at the rim, so the wall and the surface mesh meet without a seam while the liquid
   * climbs the wall or tilts relative to the flask.
   */
  const rebuildSide = (height: number, surfaceRadius: number) => {
    const flask = useExperimentStore.getState().flask;
    const surf = manager.surface;
    const pos = sideGeometry.getAttribute('position') as THREE.BufferAttribute;
    const nor = sideGeometry.getAttribute('normal') as THREE.BufferAttribute;
    const inset = 0.0002; // sit just inside the glass wall
    const rimRadius = Math.max(0, surfaceRadius - 0.00015);
    for (let s = 0; s <= SIDE_SEGMENTS; s++) {
      const a = (s / SIDE_SEGMENTS) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const rimHeight = Math.max(1e-4, height + surf.heightAt(rimRadius * ca, rimRadius * sa));
      for (let r = 0; r <= SIDE_RINGS; r++) {
        const y = (rimHeight * r) / SIDE_RINGS;
        const radius = Math.max(0, flask.innerRadius(Math.max(y, 1e-4)) - inset);
        // Slope of the profile for the normal.
        const dy = 1e-4;
        const dr = (flask.innerRadius(Math.max(y + dy, 1e-4)) - flask.innerRadius(Math.max(y - dy, 1e-4))) / (2 * dy);
        const idx = r * (SIDE_SEGMENTS + 1) + s;
        pos.setXYZ(idx, radius * ca, y, radius * sa);
        const nx = ca;
        const ny = -dr;
        const nz = sa;
        const len = Math.hypot(nx, ny, nz) || 1;
        nor.setXYZ(idx, nx / len, ny / len, nz / len);
      }
    }
    // Bottom rings: the floor is closed by collapsing ring 0 to the centre (disc) — the floor is
    // hidden by the glass base, but it must exist so the body appears solid from below.
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    sideGeometry.computeBoundingSphere();
  };

  useFrame(() => {
    const state = useExperimentStore.getState();
    const visual = state.visualState;
    const height = manager.liquidHeight;
    const radius = manager.surfaceRadius;
    const preset = LIGHTING_PRESETS[state.lightingMode];

    // Shared uniforms (both materials reference the same objects except uIsSurface).
    uniforms.uMarchSteps.value = state.renderQuality === 'low' ? MARCH_STEPS.low : MARCH_STEPS.high;
    uniforms.uVolume.value = manager.mixing.texture;
    uniforms.uVolumeTexel.value = 1 / manager.mixing.tileResolution;
    uniforms.uRefRadius.value = manager.mixing.geometry.refRadius;
    uniforms.uRadiusTop.value = manager.mixing.geometry.radiusTop;
    uniforms.uRadiusBottom.value = manager.mixing.geometry.radiusBottom;
    uniforms.uSurfaceRadius.value = radius;
    uniforms.uLiquidTop.value = height;
    uniforms.uSkyColour.value.copy(preset.sky);
    uniforms.uHorizonColour.value.copy(preset.horizon);
    uniforms.uGroundColour.value.copy(preset.ground);
    uniforms.uLight0Dir.value.copy(preset.keyDirection);
    uniforms.uLight0Colour.value.copy(preset.keyColour);
    uniforms.uLight1Dir.value.copy(preset.fillDirection);
    uniforms.uLight1Colour.value.copy(preset.fillColour);
    if (visual) {
      uniforms.uBulkAbsorbance.value.set(...visual.liquidAbsorbanceRGB);
      const path = state.currentState?.indicator?.pathLengthCm ?? 4;
      uniforms.uReferencePathCm.value = path;
      const data = lutData;
      for (let k = 0; k < LOCAL_LUT_SIZE; k++) {
        const c = visual.localColourLUT[Math.min(k, visual.localColourLUT.length - 1)];
        data[k * 4] = c.linear[0];
        data[k * 4 + 1] = c.linear[1];
        data[k * 4 + 2] = c.linear[2];
        data[k * 4 + 3] = 1;
      }
      lutTexture.needsUpdate = true;
    }
    if (sideMesh.current) {
      uniforms.uInverseModel.value.copy(sideMesh.current.matrixWorld).invert();
    }

    // The wall follows the rim of the free surface every frame (cheap: 41 × 73 vertices).
    rebuildSide(height, radius);
    lastHeight.current = height;
    lastRadius.current = radius;

    // Surface mesh from the wave simulation.
    const surf = manager.surface;
    const pos = surfaceGeometry.getAttribute('position') as THREE.BufferAttribute;
    const nor = surfaceGeometry.getAttribute('normal') as THREE.BufferAttribute;
    const n = SURFACE_N;
    const inset = 0.00015;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        let x = (-1 + (2 * i) / (n - 1)) * (radius - inset);
        let z = (-1 + (2 * j) / (n - 1)) * (radius - inset);
        // Clamp points outside the disc onto the rim so that the triangle fan follows the wall.
        const rr = Math.hypot(x, z);
        if (rr > radius - inset) {
          const k = (radius - inset) / rr;
          x *= k;
          z *= k;
        }
        pos.setXYZ(idx, x, height + surf.height[idx], z);
        nor.setXYZ(idx, surf.normals[idx * 3], surf.normals[idx * 3 + 1], surf.normals[idx * 3 + 2]);
      }
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    surfaceGeometry.computeBoundingSphere();
    void gl;
  });

  return (
    <group>
      <mesh ref={sideMesh} geometry={sideGeometry} material={sideMaterial} layers={LIQUID_LAYER} frustumCulled={false} />
      <mesh ref={surfaceMesh} geometry={surfaceGeometry} material={surfaceMaterial} layers={LIQUID_LAYER} frustumCulled={false} />
    </group>
  );
}
