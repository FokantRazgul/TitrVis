/**
 * Erlenmeyer flask glass shell: a closed surface of revolution (outer profile up, inner
 * profile down) rendered with a physically based transmissive material.
 */
import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { FlaskProfile } from '../simulation/flaskGeometry';
import { useExperimentStore } from '../state/experimentStore';

/** Layer used to exclude the glass from the background render pass. */
export const GLASS_LAYER = 2;

interface FlaskProps {
  profile: FlaskProfile;
}

export function buildFlaskShellGeometry(profile: FlaskProfile, segments = 96): THREE.LatheGeometry {
  const points: THREE.Vector2[] = [];
  const spec = profile.spec;
  const wall = spec.wallThickness;
  const steps = 120;
  // Outer profile: bottom centre → rim (outer).
  points.push(new THREE.Vector2(0, 0));
  for (let i = 1; i <= steps; i++) {
    const h = (spec.height * i) / steps;
    points.push(new THREE.Vector2(profile.outerRadius(h), h));
  }
  // Rim: outer → inner at the top.
  const innerTop = profile.innerHeight;
  points.push(new THREE.Vector2(profile.innerRadius(innerTop) , spec.height));
  // Inner profile: rim → inner floor.
  for (let i = steps; i >= 1; i--) {
    const h = (innerTop * i) / steps;
    points.push(new THREE.Vector2(profile.innerRadius(h), h + wall));
  }
  points.push(new THREE.Vector2(0, wall));
  // Remove consecutive duplicates that would create degenerate faces.
  const clean = points.filter((p, i) => i === 0 || p.distanceTo(points[i - 1]) > 1e-6);
  return new THREE.LatheGeometry(clean, segments);
}

export function Flask({ profile }: FlaskProps) {
  const quality = useExperimentStore((s) => s.renderQuality);
  const geometry = useMemo(() => buildFlaskShellGeometry(profile), [profile]);
  const material = useMemo(
    () =>
      quality === 'low'
        ? new THREE.MeshPhysicalMaterial({
            // Low-quality fallback: alpha-blended glass without the transmission render pass.
            color: new THREE.Color(0xeaf3fa),
            roughness: 0.08,
            metalness: 0,
            ior: 1.5,
            transparent: true,
            opacity: 0.16,
            depthWrite: false,
            side: THREE.DoubleSide,
            specularIntensity: 1,
          })
        : new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0xffffff),
        transmission: 0.95,
        roughness: 0.05,
        metalness: 0,
        ior: 1.5,
        thickness: profile.spec.wallThickness * 2,
        attenuationColor: new THREE.Color(0xf4fbff),
        attenuationDistance: 0.6,
        specularIntensity: 1,
        envMapIntensity: 1,
        clearcoat: 0.1,
        clearcoatRoughness: 0.1,
        side: THREE.FrontSide,
      }),
    [profile, quality],
  );
  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
    };
  }, [geometry, material]);
  return <mesh geometry={geometry} material={material} layers={GLASS_LAYER} castShadow receiveShadow={false} />;
}
