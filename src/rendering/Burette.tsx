/**
 * Burette, stand and the in-flight titrant drops (instanced spheres updated every frame from
 * the drop system).
 */
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useExperimentStore } from '../state/experimentStore';
import { useSimulationManager } from './SimulationContext';

const MAX_DROPS = 24;

function buildGraduationTexture(): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = 'rgba(40,40,40,0.9)';
  ctx.fillStyle = 'rgba(40,40,40,0.9)';
  ctx.font = '20px sans-serif';
  for (let i = 0; i <= 50; i++) {
    const y = 40 + (i / 50) * 940;
    const major = i % 5 === 0;
    ctx.lineWidth = major ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(8, y);
    ctx.lineTo(major ? 44 : 26, y);
    ctx.stroke();
    if (major) ctx.fillText(String(i), 52, y + 7);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

export function Burette() {
  const manager = useSimulationManager();
  const flask = useExperimentStore((s) => s.flask);
  const dropsRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const graduations = useMemo(() => buildGraduationTexture(), []);
  const tipY = flask.spec.height + 0.035;
  const buretteLength = 0.2;
  const buretteRadius = 0.0065;
  const standHeight = tipY + buretteLength + 0.06;
  const standX = -flask.spec.bodyDiameter / 2 - 0.09;

  const glass = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        transmission: 0.9,
        roughness: 0.08,
        metalness: 0,
        ior: 1.5,
        thickness: 0.002,
        transparent: false,
      }),
    [],
  );
  const dropMaterial = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: 0xf3f9ff,
        roughness: 0.05,
        metalness: 0,
        transmission: 0.85,
        ior: 1.33,
        thickness: 0.002,
        transparent: true,
        opacity: 0.95,
      }),
    [],
  );
  useEffect(() => {
    return () => {
      glass.dispose();
      dropMaterial.dispose();
      graduations?.dispose();
    };
  }, [glass, dropMaterial, graduations]);

  useFrame(() => {
    const mesh = dropsRef.current;
    if (!mesh) return;
    const drops = manager.drops.activeDrops;
    let count = 0;
    for (const drop of drops) {
      if (count >= MAX_DROPS) break;
      if (drop.radius <= 0) continue;
      dummy.position.set(drop.x, drop.y, drop.z);
      // Falling drops stretch along the motion direction; pendant drops hang as teardrops.
      const stretch = drop.state === 'falling' ? 1 + Math.min(0.5, Math.abs(drop.vy) * 0.18) : drop.state === 'pendant' ? 1.15 : 0.8;
      dummy.scale.set(drop.radius, drop.radius * stretch, drop.radius);
      dummy.updateMatrix();
      mesh.setMatrixAt(count, dummy.matrix);
      count++;
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  });

  const tip = manager.tipPosition;

  return (
    <group>
      {/* Stand: base plate, rod, clamp arm */}
      <mesh position={[standX, 0.006, 0]} castShadow receiveShadow>
        <boxGeometry args={[0.16, 0.012, 0.1]} />
        <meshStandardMaterial color={0x2b2f36} roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[standX, standHeight / 2, 0]} castShadow>
        <cylinderGeometry args={[0.006, 0.006, standHeight, 24]} />
        <meshStandardMaterial color={0x9aa3ad} roughness={0.35} metalness={0.8} />
      </mesh>
      <mesh position={[(standX + tip.x) / 2, tipY + buretteLength * 0.55, 0]} castShadow>
        <boxGeometry args={[Math.abs(tip.x - standX), 0.012, 0.014]} />
        <meshStandardMaterial color={0x3b4048} roughness={0.5} metalness={0.5} />
      </mesh>
      <mesh position={[tip.x, tipY + buretteLength * 0.55, 0]} castShadow>
        <torusGeometry args={[buretteRadius + 0.004, 0.003, 12, 32]} />
        <meshStandardMaterial color={0x3b4048} roughness={0.5} metalness={0.5} />
      </mesh>
      {/* Burette tube */}
      <mesh position={[tip.x, tipY + 0.03 + buretteLength / 2, tip.z]} material={glass} castShadow>
        <cylinderGeometry args={[buretteRadius, buretteRadius, buretteLength, 32, 1, true]} />
      </mesh>
      {/* Titrant column inside the burette */}
      <mesh position={[tip.x, tipY + 0.03 + buretteLength / 2, tip.z]}>
        <cylinderGeometry args={[buretteRadius * 0.82, buretteRadius * 0.82, buretteLength * 0.96, 24]} />
        <meshPhysicalMaterial color={0xeef7ff} transmission={0.9} roughness={0.1} ior={1.33} thickness={0.01} />
      </mesh>
      {/* Graduation strip */}
      {graduations && (
        <mesh position={[tip.x + buretteRadius * 0.98, tipY + 0.03 + buretteLength / 2, tip.z]} rotation={[0, Math.PI / 2, 0]}>
          <planeGeometry args={[buretteRadius * 1.6, buretteLength * 0.92]} />
          <meshBasicMaterial map={graduations} transparent depthWrite={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* Stopcock and tip */}
      <mesh position={[tip.x, tipY + 0.022, tip.z]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.004, 0.004, 0.02, 16]} />
        <meshStandardMaterial color={0x3f8fd8} roughness={0.4} />
      </mesh>
      <mesh position={[tip.x, tipY + 0.011, tip.z]} material={glass}>
        <cylinderGeometry args={[0.0022, buretteRadius * 0.6, 0.026, 24, 1, true]} />
      </mesh>
      {/* Drops */}
      <instancedMesh ref={dropsRef} args={[undefined, undefined, MAX_DROPS]} material={dropMaterial} frustumCulled={false} castShadow>
        <sphereGeometry args={[1, 20, 16]} />
      </instancedMesh>
    </group>
  );
}
