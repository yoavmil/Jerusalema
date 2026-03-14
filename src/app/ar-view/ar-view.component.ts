import {
  Component, ElementRef, Input, OnDestroy, AfterViewInit, ViewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import * as THREE from 'three';
import { CompassService, HeadingVector } from '../services/compass.service';

@Component({
  selector: 'app-ar-view',
  standalone: true,
  template: `
    <video #videoBg autoplay playsinline muted></video>
    <canvas #threeCanvas></canvas>

    <div class="hud">
      <span class="pill">{{ distLabel }}</span>
      <span class="pill">{{ compassLabel }}</span>
    </div>

    <div class="compass-wrap">
      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="30"
          fill="rgba(0,0,0,0.4)" stroke="rgba(255,255,255,0.2)" stroke-width="1"/>
        <text x="32" y="11"  text-anchor="middle" fill="#ef4444" font-size="9" font-weight="700" font-family="sans-serif">N</text>
        <text x="32" y="58"  text-anchor="middle" fill="white"   font-size="7" font-family="sans-serif">S</text>
        <text x="56" y="35"  text-anchor="middle" fill="white"   font-size="7" font-family="sans-serif">E</text>
        <text x="8"  y="35"  text-anchor="middle" fill="white"   font-size="7" font-family="sans-serif">W</text>
        <g [attr.transform]="'rotate(' + (-headingDeg) + ' 32 32)'">
          <polygon points="32,10 29,32 32,28 35,32" fill="#ef4444"/>
          <polygon points="32,54 29,32 32,36 35,32" fill="rgba(255,255,255,0.5)"/>
        </g>
      </svg>
    </div>
  `,
  styles: [`
    :host {
      display: block; position: fixed; inset: 0; overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    }

    video {
      position: absolute; inset: 0; width: 100%; height: 100%;
      object-fit: cover; z-index: 0;
    }

    canvas {
      position: absolute; inset: 0; width: 100%; height: 100%; z-index: 1;
    }

    .hud {
      position: absolute; top: env(safe-area-inset-top, 0); left: 0; right: 0;
      z-index: 10; display: flex; flex-direction: column;
      align-items: center; gap: 0.4rem; padding: 0.75rem; pointer-events: none;
    }

    .pill {
      background: rgba(0,0,0,0.45); backdrop-filter: blur(10px);
      color: #fff; padding: 0.35rem 0.9rem; border-radius: 20px;
      font-size: 0.82rem; white-space: nowrap;
    }

    .compass-wrap {
      position: absolute;
      bottom: calc(env(safe-area-inset-bottom, 0px) + 1.5rem);
      right: 1.2rem; z-index: 10; width: 64px; height: 64px;
      filter: drop-shadow(0 2px 6px rgba(0,0,0,0.6));
    }
  `],
})
export class ArViewComponent implements AfterViewInit, OnDestroy {

  @ViewChild('videoBg',     { static: true }) videoEl!: ElementRef<HTMLVideoElement>;
  @ViewChild('threeCanvas', { static: true }) canvasEl!: ElementRef<HTMLCanvasElement>;

  /** Bearing to Jerusalem in clockwise degrees from north (converted to vector on set). */
  @Input() set bearing(deg: number) {
    const rad = (deg * Math.PI) / 180;
    this.bearingVec = { sin: Math.sin(rad), cos: Math.cos(rad) };
    this.bearingDeg = deg;
  }
  /** Distance label text, e.g. "Jerusalem · 3 412 km away". */
  @Input() distLabel = '';

  compassLabel = 'Compass calibrating…';

  private bearingVec: HeadingVector = { sin: 0, cos: 1 };
  private bearingDeg = 0;
  private headingVec: HeadingVector = { sin: 0, cos: 1 };
  /** Heading in degrees — only used for template display, never for rotation math. */
  headingDeg = 0;

  private renderer!: THREE.WebGLRenderer;
  private scene!:    THREE.Scene;
  private camera!:   THREE.PerspectiveCamera;
  private arrow!:    THREE.Group;
  private glow!:     THREE.Mesh;
  private clock = new THREE.Clock();
  private rafId = 0;
  private sub!: Subscription;

  constructor(private compass: CompassService) {}

  async ngAfterViewInit(): Promise<void> {
    await this.startCamera();
    this.buildScene();
    this.sub = this.compass.heading$.subscribe(h => {
      if (h === null) return;
      this.headingVec = h;
      // Convert to degrees only for display labels
      this.headingDeg = (Math.atan2(h.sin, h.cos) * 180 / Math.PI + 360) % 360;
      this.compassLabel = `Bearing ${Math.round(this.bearingDeg)}°  ·  Heading ${Math.round(this.headingDeg)}°`;
    });
    this.animate();
    window.addEventListener('resize', this.onResize);
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    this.renderer?.dispose();
    this.sub?.unsubscribe();
  }

  // ── Camera feed ────────────────────────────────────────────────────
  private async startCamera(): Promise<void> {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    this.videoEl.nativeElement.srcObject = stream;
  }

  // ── Three.js scene ─────────────────────────────────────────────────
  private buildScene(): void {
    const canvas = this.canvasEl.nativeElement;
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(2, 6, 3);
    this.scene.add(sun);

    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 30);
    this.camera.position.set(0, 1.55, 0);
    this.camera.rotation.x = -25 * Math.PI / 180; // tilt down so floor is visible

    this.arrow = this.buildArrow();
    this.arrow.position.set(0, 0, -1.8); // 1.8 m ahead on the floor
    this.scene.add(this.arrow);
  }

  private buildArrow(): THREE.Group {
    const g = new THREE.Group();
    const gold = new THREE.MeshStandardMaterial({
      color: 0xffcc00, metalness: 0.55, roughness: 0.25, emissive: 0x3a2800,
    });

    // Shaft
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.55, 20), gold);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = -0.275;
    g.add(shaft);

    // Head
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.22, 20), gold);
    head.rotation.x = -Math.PI / 2;
    head.position.z = -0.66;
    g.add(head);

    // Tail feathers
    const featherMat = new THREE.MeshStandardMaterial({ color: 0xffee88, metalness: 0.3, roughness: 0.5 });
    for (const sign of [-1, 1]) {
      const feather = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.01, 0.14), featherMat);
      feather.position.set(sign * 0.06, 0, 0.02);
      g.add(feather);
    }

    // Glow ring on the floor
    this.glow = new THREE.Mesh(
      new THREE.RingGeometry(0.38, 0.48, 72),
      new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
    );
    this.glow.rotation.x = -Math.PI / 2;
    g.add(this.glow);

    // Center dot
    const dot = new THREE.Mesh(
      new THREE.CircleGeometry(0.045, 32),
      new THREE.MeshBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    );
    dot.rotation.x = -Math.PI / 2;
    g.add(dot);

    return g;
  }

  // ── Render loop ────────────────────────────────────────────────────
  private animate = (): void => {
    this.rafId = requestAnimationFrame(this.animate);
    const t = this.clock.getElapsedTime();

    // Rotate arrow to point toward Jerusalem using cross/dot products —
    // no angle arithmetic, no 0°/360° singularity possible.
    // cross(heading, bearing) = sin of the angle from heading to bearing
    // dot(heading, bearing)   = cos of that angle
    const { sin: hs, cos: hc } = this.headingVec;
    const { sin: bs, cos: bc } = this.bearingVec;
    this.arrow.rotation.y = Math.atan2(hs * bc - hc * bs, hc * bc + hs * bs);
    // Hover float
    this.arrow.position.y = Math.sin(t * 1.1) * 0.04;
    // Pulse glow
    (this.glow.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.15 * Math.sin(t * 2.2);

    this.renderer.render(this.scene, this.camera);
  };

  private onResize = (): void => {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  };
}
