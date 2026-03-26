import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export interface ViewerOptions {
  antialias?: boolean;
  background?: THREE.ColorRepresentation;
}

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;

  private container: HTMLElement | null = null;
  private animationId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(options: ViewerOptions = {}) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: options.antialias ?? true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(options.background ?? 0x1a1a2e);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
    this.camera.position.set(4, 3, 4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0.5, 0);

    this.buildDefaultScene();
  }

  /** Mount the renderer canvas into a container element. */
  mount(container: HTMLElement): void {
    if (this.container) this.unmount();
    this.container = container;
    container.appendChild(this.renderer.domElement);
    this.handleResize();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);

    this.startLoop();
  }

  /** Unmount the renderer, stop the loop, and clean up observers. */
  unmount(): void {
    this.stopLoop();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.renderer.domElement.remove();
    this.container = null;
  }

  /** Fully dispose of GPU resources. Call when the viewer is no longer needed. */
  dispose(): void {
    this.unmount();
    this.renderer.dispose();
    this.controls.dispose();
  }

  /** Add an object to the scene. */
  add(...objects: THREE.Object3D[]): void {
    for (const obj of objects) this.scene.add(obj);
  }

  /** Remove an object from the scene. */
  remove(...objects: THREE.Object3D[]): void {
    for (const obj of objects) this.scene.remove(obj);
  }

  /** Clear all non-light objects from the scene. */
  clearScene(): void {
    const toRemove = this.scene.children.filter((c) => !(c instanceof THREE.Light));
    for (const obj of toRemove) this.scene.remove(obj);
  }

  private startLoop(): void {
    const tick = (): void => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.animationId = requestAnimationFrame(tick);
    };
    tick();
  }

  private stopLoop(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
  }

  private handleResize(): void {
    if (!this.container) return;
    const { clientWidth: w, clientHeight: h } = this.container;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private buildDefaultScene(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);

    const directional = new THREE.DirectionalLight(0xffffff, 1.0);
    directional.position.set(5, 8, 4);
    directional.castShadow = true;
    directional.shadow.mapSize.set(1024, 1024);
    this.scene.add(directional);
  }
}
