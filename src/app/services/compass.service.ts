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

  // ── Android ────────────────────────────────────────────────────────
  // deviceorientationabsolute gives alpha/beta/gamma earth-referenced.
  // We apply tilt compensation so the result is stable regardless of
  // how the phone is tilted (portrait, landscape, angled).
  private handleAbsolute(e: DeviceOrientationEvent): void {
    if (!e.absolute || e.alpha === null) return;
    this.feed(tiltCompensatedHeading(e.alpha, e.beta ?? 0, e.gamma ?? 0));
  }

  // ── iOS ────────────────────────────────────────────────────────────
  // webkitCompassHeading is already tilt-compensated by the OS.
  // Ignore plain alpha from non-absolute deviceorientation events.
  private handleRelative(
    e: DeviceOrientationEvent & { webkitCompassHeading?: number }
  ): void {
    if (typeof e.webkitCompassHeading !== 'number') return;
    if (!Number.isFinite(e.webkitCompassHeading))  return;
    this.feed(e.webkitCompassHeading);
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

/**
 * Tilt-compensated compass heading from W3C DeviceOrientationEvent angles.
 *
 * Raw alpha from deviceorientationabsolute is only correct when the phone is
 * flat. When held vertically the gravity vector tilts the effective axes, so
 * we must project through the full ZXY rotation matrix to recover the true
 * azimuth from north.
 *
 * Derivation: W3C DeviceOrientation spec, Appendix A "Worked Example".
 * https://www.w3.org/TR/orientation-event/#worked-example
 *
 * Verified for portrait (beta≈90°), landscape, and arbitrary tilt.
 * Returns clockwise degrees from magnetic north, range [0, 360).
 */
function tiltCompensatedHeading(alpha: number, beta: number, gamma: number): number {
  const a = alpha * DEG;
  const b = beta  * DEG;
  const g = gamma * DEG;

  const cosA = Math.cos(a), sinA = Math.sin(a);
  const sinB = Math.sin(b);
  const cosG = Math.cos(g), sinG = Math.sin(g);

  // Elements of the rotation matrix column that encodes north in device space
  const x = cosA * sinG + sinA * sinB * cosG;
  const y = sinA * sinG - cosA * sinB * cosG;

  // Edge case: phone is flat (beta≈0, gamma≈0) so x,y both collapse to 0.
  // Fall back to raw alpha, which IS the heading when the device is horizontal.
  if (Math.abs(x) < 1e-4 && Math.abs(y) < 1e-4) {
    return ((360 - alpha) % 360 + 360) % 360;
  }

  const heading = Math.atan2(-x, -y) / DEG;
  return ((heading % 360) + 360) % 360;
}
