/**
 * The 3D scene: React Three Fiber canvas, simulation loop and all rendered objects.
 *
 * Frame order (useFrame priorities):
 *   1. simulation update (drops → chemistry → fluid/mixing/surface)
 *   2. background pass (scene without liquid/glass → FBO used for refraction)
 *   3. default render (R3F)
 */
import { OrbitControls, useFBO } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { SimulationManager } from '../simulation/SimulationManager';
import { useExperimentStore } from '../state/experimentStore';
import { dropAudio } from '../utils/audio';
import { reportRuntimeProblem } from '../utils/diagnostics';
import { recordFrame } from '../utils/devHook';
import { Burette } from './Burette';
import { LabEnvironment } from './Environment';
import { Flask, GLASS_LAYER } from './Flask';
import { Lighting } from './Lighting';
import { LIQUID_LAYER, Liquid } from './Liquid';
import { registerScene } from './sceneRegistry';
import { SimulationContext } from './SimulationContext';
import { useCameraStream } from './useCameraStream';

function FlaskAssembly({ manager, background }: { manager: SimulationManager; background: THREE.Texture }) {
  const group = useRef<THREE.Group>(null);
  const flask = useExperimentStore((s) => s.flask);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const stir = manager.stir;
    g.position.set(stir.offsetX, 0, stir.offsetZ);
    // Tilt away from the orbit centre: rotate about the horizontal axis perpendicular to the offset.
    const axisX = -Math.sin(stir.phase);
    const axisZ = Math.cos(stir.phase);
    g.quaternion.setFromAxisAngle(new THREE.Vector3(axisX, 0, axisZ).normalize(), stir.tiltRad);
  });
  return (
    <group ref={group}>
      <Flask profile={flask} />
      <Liquid background={background} />
    </group>
  );
}

function CameraRig() {
  const flask = useExperimentStore((s) => s.flask);
  const { camera } = useThree();
  const controls = useRef<{ target: THREE.Vector3; update: () => void } | null>(null);
  useEffect(() => {
    const h = flask.spec.height;
    const target = new THREE.Vector3(0, h * 0.9, 0);
    camera.position.set(h * 2.1, h * 1.5, h * 3.3);
    camera.lookAt(target);
    if (controls.current) {
      controls.current.target.copy(target);
      controls.current.update();
    }
  }, [flask, camera]);
  const h = flask.spec.height;
  return (
    <OrbitControls
      ref={controls as never}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={h * 1.2}
      maxDistance={h * 9}
      minPolarAngle={0.35}
      maxPolarAngle={Math.PI / 2 - 0.05}
      target={[0, h * 0.9, 0]}
    />
  );
}

function SceneContent() {
  const { gl, scene, camera, size } = useThree();
  const flaskInitial = useExperimentStore.getState().flask;
  const video = useCameraStream();

  const manager = useMemo(() => {
    const store = useExperimentStore.getState();
    return new SimulationManager(gl, flaskInitial, {
      onDropImpact: (volumeML, impact) => {
        const accepted = useExperimentStore.getState().addTitrant(volumeML);
        if (accepted) dropAudio.playDrop(impact.drop.fullRadius, impact.speed);
        return accepted;
      },
      onShaderError: (error) => {
        reportRuntimeProblem('shader', error);
        store.pushToast('A simulation shader failed to compile. The fluid simulation is unavailable in this browser.', 'error');
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl]);

  useEffect(() => {
    registerScene({ gl, scene, camera });
    return () => {
      registerScene(null);
      manager.dispose();
    };
  }, [gl, scene, camera, manager]);

  // Reset the simulation whenever the experiment is reset/reconfigured.
  useEffect(() => {
    let last = useExperimentStore.getState().resetVersion;
    return useExperimentStore.subscribe((s) => {
      if (s.resetVersion !== last) {
        last = s.resetVersion;
        manager.reset();
      }
    });
  }, [manager]);

  // Pause-aware timing: ignore the gap when the tab was hidden.
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) manager.notifyResumed();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [manager]);

  // Automatic quality: after a warm-up, sustained slow frames switch to the low-quality rig.
  const frameSamples = useRef<number[]>([]);
  const lastFrameTime = useRef(0);
  const quality = useExperimentStore((s) => s.renderQuality);
  useEffect(() => {
    gl.setPixelRatio(quality === 'low' ? 1 : Math.min(window.devicePixelRatio, 2));
  }, [gl, quality]);

  // Background render target for the liquid's refraction (half resolution, quarter in low quality).
  const fboScale = quality === 'low' ? 0.25 : 0.5;
  const background = useFBO(Math.max(2, Math.floor(size.width * fboScale)), Math.max(2, Math.floor(size.height * fboScale)), {
    depthBuffer: true,
    stencilBuffer: false,
    type: THREE.HalfFloatType,
  });

  useFrame((state, delta) => {
    if (document.hidden) return;
    const s = useExperimentStore.getState();
    if (s.muted !== dropAudio.muted) dropAudio.muted = s.muted;
    const liquidVolumeML = s.currentState ? s.currentState.totalVolumeML : s.analyteVolumeML;
    manager.update({
      dt: delta,
      titrating: s.isTitrating,
      stirring: s.isStirring,
      allowDrops: !s.limitReached && s.chemistryError === null,
      dropRateHz: s.dropRateHz,
      dropVolumeML: s.dropVolumeML,
      liquidVolumeML,
      flask: s.flask,
    });
    recordFrame(manager);
    const now = performance.now();
    if (lastFrameTime.current > 0) {
      const frame = now - lastFrameTime.current;
      if (frame < 5000) frameSamples.current.push(frame);
      if (frameSamples.current.length >= 12) {
        const avg = frameSamples.current.reduce((a, b) => a + b, 0) / frameSamples.current.length;
        frameSamples.current = [];
        const store = useExperimentStore.getState();
        if (avg > 90 && store.renderQuality === 'high') store.setRenderQuality('low');
        else if (avg < 20 && store.renderQuality === 'low') store.setRenderQuality('high');
      }
    }
    lastFrameTime.current = now;
    void state;
  }, -2);

  useFrame(({ gl: renderer, scene: sc, camera: cam }) => {
    const previous = cam.layers.mask;
    cam.layers.enableAll();
    cam.layers.disable(LIQUID_LAYER);
    cam.layers.disable(GLASS_LAYER);
    const target = renderer.getRenderTarget();
    renderer.setRenderTarget(background);
    renderer.clear();
    renderer.render(sc, cam);
    renderer.setRenderTarget(target);
    cam.layers.mask = previous;
  }, -1);

  // The default camera must see every layer.
  useEffect(() => {
    camera.layers.enableAll();
  }, [camera]);

  return (
    <SimulationContext.Provider value={manager}>
      <Lighting />
      <LabEnvironment video={video} />
      <Burette />
      <FlaskAssembly manager={manager} background={background.texture} />
      <CameraRig />
    </SimulationContext.Provider>
  );
}

export function Scene() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      gl={{
        antialias: true,
        alpha: false,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: false,
        stencil: false,
      }}
      camera={{ fov: 34, near: 0.01, far: 30, position: [0.36, 0.27, 0.6] }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.0;
        gl.shadowMap.type = THREE.PCFSoftShadowMap;
        gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      }}
      style={{ position: 'absolute', inset: 0 }}
      data-testid="scene-canvas"
    >
      <SceneContent />
    </Canvas>
  );
}
