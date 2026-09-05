/**
 * Minimal full-screen render-pass helper on top of the Three.js WebGLRenderer. Each pass is
 * a RawShaderMaterial (GLSL ES 3.00) rendered onto a float render target. Shader compile and
 * link logs are checked explicitly in development builds.
 */

import * as THREE from 'three';
import common from '../../shaders/fluid/common.glsl?raw';
import quadVert from '../../shaders/fluid/quad.vert.glsl?raw';
import { IS_DEV } from '../../utils/diagnostics';

export class ShaderCompileError extends Error {
  constructor(name: string, log: string) {
    super(`Shader "${name}" failed to compile/link:\n${log}`);
    this.name = 'ShaderCompileError';
  }
}

export type ShaderErrorListener = (error: ShaderCompileError) => void;

/**
 * Route Three.js shader compile/link failures to a listener. Three reports them through
 * `renderer.debug.onShaderError` when `checkShaderErrors` is enabled; we enable checking in
 * every build so that a broken simulation shader is never silently replaced by nothing.
 */
export function installShaderErrorHandler(renderer: THREE.WebGLRenderer, listener: ShaderErrorListener): () => void {
  const previousCheck = renderer.debug.checkShaderErrors;
  const previousHandler = renderer.debug.onShaderError;
  renderer.debug.checkShaderErrors = true;
  renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
    const programLog = gl.getProgramInfoLog(program) ?? '';
    const vertexLog = gl.getShaderInfoLog(vertexShader) ?? '';
    const fragmentLog = gl.getShaderInfoLog(fragmentShader) ?? '';
    const materialName = (program as unknown as { name?: string }).name ?? 'unknown program';
    const error = new ShaderCompileError(materialName, `program: ${programLog}\nvertex: ${vertexLog}\nfragment: ${fragmentLog}`);
    if (IS_DEV) {
      // eslint-disable-next-line no-console
      console.error(error.message);
    }
    listener(error);
  };
  return () => {
    renderer.debug.checkShaderErrors = previousCheck;
    renderer.debug.onShaderError = previousHandler;
  };
}

/** Preferred float texture type for simulation targets (FloatType when renderable, else HalfFloat). */
export function pickFloatType(renderer: THREE.WebGLRenderer): THREE.TextureDataType {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const hasFloat = Boolean(gl.getExtension('EXT_color_buffer_float'));
  return hasFloat ? THREE.FloatType : THREE.HalfFloatType;
}

export function createFloatTarget(size: number, type: THREE.TextureDataType): THREE.WebGLRenderTarget {
  const target = new THREE.WebGLRenderTarget(size, size, {
    type,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    generateMipmaps: false,
  });
  target.texture.name = 'simulation';
  return target;
}

export class PingPong {
  read: THREE.WebGLRenderTarget;
  write: THREE.WebGLRenderTarget;
  constructor(size: number, type: THREE.TextureDataType) {
    this.read = createFloatTarget(size, type);
    this.write = createFloatTarget(size, type);
  }
  swap(): void {
    const t = this.read;
    this.read = this.write;
    this.write = t;
  }
  dispose(): void {
    this.read.dispose();
    this.write.dispose();
  }
}

export interface PassUniforms {
  [name: string]: THREE.IUniform;
}

/** A full-screen pass: a quad with a raw GLSL3 fragment shader. */
export class GpuPass {
  readonly material: THREE.RawShaderMaterial;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.OrthographicCamera;
  private readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.BufferGeometry;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    readonly name: string,
    fragmentSource: string,
    uniforms: PassUniforms,
  ) {
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: quadVert,
      fragmentShader: `${common}\n${fragmentSource}`,
      uniforms,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    this.material.name = name;
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }

  get uniforms(): PassUniforms {
    return this.material.uniforms;
  }

  /** Render the pass into `target`. */
  render(target: THREE.WebGLRenderTarget): void {
    const renderer = this.renderer;
    renderer.setRenderTarget(target);
    renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.material.dispose();
    this.geometry.dispose();
  }
}

/** Save/restore the renderer state around simulation passes so scene rendering is unaffected. */
export function withSimulationState(renderer: THREE.WebGLRenderer, fn: () => void): void {
  const previousTarget = renderer.getRenderTarget();
  const previousAutoClear = renderer.autoClear;
  const previousXr = renderer.xr.enabled;
  const scissorTest = renderer.getScissorTest();
  renderer.autoClear = false;
  renderer.xr.enabled = false;
  renderer.setScissorTest(false);
  try {
    fn();
  } finally {
    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;
    renderer.xr.enabled = previousXr;
    renderer.setScissorTest(scissorTest);
  }
}
