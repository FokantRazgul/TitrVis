/**
 * Laboratory environment: table, white paper under the flask, and the scene background.
 */
import { Environment as DreiEnvironment, Lightformer } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import * as THREE from 'three';
import { useExperimentStore } from '../state/experimentStore';
import { LIGHTING_PRESETS } from './lightingPresets';

interface LabEnvironmentProps {
  /** Video texture for camera mode (null when unavailable). */
  video: THREE.VideoTexture | null;
}

export function LabEnvironment({ video }: LabEnvironmentProps) {
  const lightingMode = useExperimentStore((s) => s.lightingMode);
  const flask = useExperimentStore((s) => s.flask);
  const { scene } = useThree();

  useEffect(() => {
    const preset = LIGHTING_PRESETS[lightingMode];
    if (lightingMode === 3 && video) {
      scene.background = video;
    } else {
      scene.background = preset.background.clone();
    }
    return () => {
      scene.background = null;
    };
  }, [lightingMode, scene, video]);

  const tableY = -0.03;
  const studio = lightingMode === 2;

  return (
    <group>
      {/* Table top */}
      <mesh position={[0, tableY - 0.02, 0]} receiveShadow>
        <boxGeometry args={[2.4, 0.04, 1.4]} />
        <meshStandardMaterial color={studio ? 0x2a2c30 : 0x8d6e4d} roughness={studio ? 0.35 : 0.65} metalness={0.05} />
      </mesh>
      {/* White paper under the flask (standard practice to see the colour change) */}
      <mesh position={[0, tableY + 0.0005, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[Math.max(0.3, flask.spec.bodyDiameter * 2.6), Math.max(0.22, flask.spec.bodyDiameter * 2.0)]} />
        <meshStandardMaterial color={0xfafafa} roughness={0.9} metalness={0} />
      </mesh>
      {/* Back wall / backdrop */}
      <mesh position={[0, 0.6, -0.7]} receiveShadow>
        <planeGeometry args={[3.2, 1.8]} />
        <meshStandardMaterial color={studio ? 0x101114 : 0xe4e9ef} roughness={0.95} metalness={0} />
      </mesh>
      {/* Procedural environment map for reflections (no external assets) */}
      <DreiEnvironment frames={1} resolution={128} background={false}>
        {studio ? (
          <>
            <Lightformer intensity={6} rotation-x={Math.PI / 2} position={[0, 4, -1]} scale={[8, 3, 1]} />
            <Lightformer intensity={3} rotation-y={Math.PI / 2} position={[-5, 1, 0]} scale={[6, 2, 1]} color="#dfe8ff" />
            <Lightformer intensity={1} rotation-y={-Math.PI / 2} position={[5, 1, 0]} scale={[4, 2, 1]} color="#ffe2c8" />
          </>
        ) : (
          <>
            <Lightformer intensity={2.5} rotation-x={Math.PI / 2} position={[0, 5, 0]} scale={[10, 10, 1]} color="#f6f9ff" />
            <Lightformer intensity={1.2} rotation-y={Math.PI / 2} position={[-5, 2, 0]} scale={[8, 4, 1]} color="#dfe9f5" />
            <Lightformer intensity={0.9} rotation-y={-Math.PI / 2} position={[5, 2, 0]} scale={[8, 4, 1]} color="#fff3e2" />
            <Lightformer intensity={0.4} rotation-x={-Math.PI / 2} position={[0, -2, 0]} scale={[10, 10, 1]} color="#8a7a66" />
          </>
        )}
      </DreiEnvironment>
    </group>
  );
}
