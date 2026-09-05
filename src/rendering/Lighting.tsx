/**
 * Lighting rigs for the three modes. Camera mode reuses the laboratory rig; the video feed is
 * applied as background/environment by LabEnvironment.
 */
import { useExperimentStore } from '../state/experimentStore';

export function Lighting() {
  const mode = useExperimentStore((s) => s.lightingMode);
  const flask = useExperimentStore((s) => s.flask);
  const quality = useExperimentStore((s) => s.renderQuality);
  const shadowSize = quality === 'low' ? 1024 : 2048;
  const h = flask.spec.height;
  if (mode === 2) {
    return (
      <group>
        <ambientLight intensity={0.08} />
        <spotLight
          position={[0.6 * h * 6, 3.2 * h * 3, 0.5 * h * 6]}
          angle={0.5}
          penumbra={0.6}
          intensity={40}
          distance={0}
          decay={2}
          castShadow
          shadow-mapSize={[shadowSize, shadowSize]}
          shadow-bias={-0.0003}
          color="#ffffff"
        />
        <spotLight position={[-1.2, 0.8, 0.9]} angle={0.7} penumbra={0.9} intensity={6} decay={2} color="#8fa3c2" />
        <directionalLight position={[0.2, 0.6, -1.2]} intensity={1.5} color="#ffd9b8" />
      </group>
    );
  }
  return (
    <group>
      <hemisphereLight args={['#cfdbe8', '#7a6a58', 0.9]} />
      <ambientLight intensity={0.25} />
      <directionalLight
        position={[0.9, 1.7, 0.7]}
        intensity={2.8}
        color="#fff6e8"
        castShadow
        shadow-mapSize={[shadowSize, shadowSize]}
        shadow-bias={-0.0003}
        shadow-camera-left={-0.6}
        shadow-camera-right={0.6}
        shadow-camera-top={0.6}
        shadow-camera-bottom={-0.6}
        shadow-camera-near={0.1}
        shadow-camera-far={6}
      />
      <directionalLight position={[-1.4, 0.8, 1.2]} intensity={0.8} color="#9fb3c8" />
    </group>
  );
}
