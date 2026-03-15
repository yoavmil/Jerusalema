import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface HeadingVector { sin: number; cos: number; }

const DEG = Math.PI / 180;

@Injectable({ providedIn: 'root' })
export class CompassService implements OnDestroy {

  readonly heading$   = new BehaviorSubject<HeadingVector | null>(null);
  readonly available$ = new BehaviorSubject<boolean>(false);

  // Two separate bound handlers so we can remove each independently
  private readonly onAbsolute = this.handleAbsolute.bind(this);
  private readonly onRelative = this.handleRelative.bind(this);

  // Low-pass filter state
  private smoothSin = 0;
  private smoothCos = 0;
  private hasFirst  = false;
  private readonly SMOOTH = 0.15;

  constructor(private zone: NgZone) {}

  async start(): Promise<boolean> {
    this.stop();
    this.reset();

    if (typeof DeviceOrientationEvent === 'undefined') return false;

    // iOS 13+ requires explicit permission
    const DOE = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };
    if (typeof DOE.requestPermission === 'function') {
      try {
        if (await DOE.requestPermission() !== 'granted') return false;
      } catch {
        return false;
      }
    }

    // Android: deviceorientationabsolute carries e.absolute=true + alpha/beta/gamma
    // iOS:     deviceorientation carries webkitCompassHeading (already tilt-compensated)
    window.addEventListener('deviceorientationabsolute', this.onAbsolute as EventListener, true);
    window.addEventListener('deviceorientation',         this.onRelative as EventListener, true);

    const available = await new Promise<boolean>(resolve => {
      const t = setTimeout(() => resolve(false), 3000);
      const sub = this.available$.subscribe(ok => {
        if (ok) { clearTimeout(t); sub.unsubscribe(); resolve(true); }
      });
    });

    if (!available) this.stop();
    return available;
  }

  stop(): void {
    window.removeEventListener('deviceorientationabsolute', this.onAbsolute as EventListener, true);
    window.removeEventListener('deviceorientation',         this.onRelative as EventListener, true);
    this.available$.next(false);
  }

  ngOnDestroy() { this.stop(); }

  // ── Android ───────────────────────────────────────────────────────
  // deviceorientationabsolute gives us absolute Euler angles (α,β,γ).
  // We reconstruct the camera direction (-Z in device frame) in world
  // coordinates using the full rotation matrix R = Rz(α)·Rx(β)·Ry(γ),
  // then project onto the horizontal plane to get the true azimuth.
  // This is correct at any phone tilt (no gimbal-lock at β≈90°).
  private handleAbsolute(e: DeviceOrientationEvent): void {
    if (e.alpha === null || e.beta === null || e.gamma === null) return;
    const h = this.tiltCompensatedHeading(e.alpha, e.beta, e.gamma);
    if (Number.isFinite(h)) this.feed(h);
  }

  // ── iOS + fallback ─────────────────────────────────────────────────
  // iOS Safari: webkitCompassHeading is OS-tilt-compensated — use directly.
  // Some Android builds fire deviceorientation with e.absolute=true
  // instead of the named deviceorientationabsolute event — handle those too.
  private handleRelative(
    e: DeviceOrientationEvent & { webkitCompassHeading?: number }
  ): void {
    if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) {
      this.feed(e.webkitCompassHeading);
    } else if (e.absolute === true && e.alpha !== null && e.beta !== null && e.gamma !== null) {
      const h = this.tiltCompensatedHeading(e.alpha, e.beta, e.gamma);
      if (Number.isFinite(h)) this.feed(h);
    }
    // else: relative reading — discard
  }

  // ── Tilt-compensated azimuth ───────────────────────────────────────
  // Projects the camera direction (-Z_device) into world coordinates via
  // R = Rz(α)·Rx(β)·Ry(γ)  (W3C intrinsic ZXY, device → world frame).
  // World axes: X = East, Y = North, Z = Up.
  // Returns clockwise-from-North degrees, or NaN when camera faces
  // nearly straight down (phone flat — heading is undefined).
  private tiltCompensatedHeading(aDeg: number, bDeg: number, gDeg: number): number {
    const a = aDeg * DEG, b = bDeg * DEG, g = gDeg * DEG;
    const sa = Math.sin(a), ca = Math.cos(a);
    const sb = Math.sin(b);
    const sg = Math.sin(g), cg = Math.cos(g);

    // Camera direction in world = R · [0, 0, -1]  →  -(third column of R)
    const east  = -(ca * sg + sa * cg * sb);
    const north =   ca * cg * sb - sa * sg;

    // If the horizontal component is negligible the phone is nearly flat;
    // heading is undefined so we skip the reading.
    if (Math.hypot(east, north) < 0.1) return NaN;

    return (Math.atan2(east, north) / DEG + 360) % 360;
  }

  // ── Shared filter ──────────────────────────────────────────────────
  private feed(headingDeg: number): void {
    const h   = ((headingDeg % 360) + 360) % 360;
    const rad = h * DEG;
    const s   = Math.sin(rad);
    const c   = Math.cos(rad);

    if (!this.hasFirst) {
      this.smoothSin = s;
      this.smoothCos = c;
      this.hasFirst  = true;
    } else {
      this.smoothSin = this.SMOOTH * s + (1 - this.SMOOTH) * this.smoothSin;
      this.smoothCos = this.SMOOTH * c + (1 - this.SMOOTH) * this.smoothCos;
    }

    const len = Math.hypot(this.smoothSin, this.smoothCos);
    if (len < 1e-6) return;

    this.zone.run(() => {
      this.available$.next(true);
      this.heading$.next({ sin: this.smoothSin / len, cos: this.smoothCos / len });
    });
  }

  private reset(): void {
    this.smoothSin = 0;
    this.smoothCos = 0;
    this.hasFirst  = false;
    this.heading$.next(null);
    this.available$.next(false);
  }
}

