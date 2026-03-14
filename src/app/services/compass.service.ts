import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/** Smoothed compass direction as a unit vector in the horizontal plane.
 *  sin = east component, cos = north component (clockwise-from-north convention). */
export interface HeadingVector { sin: number; cos: number; }

@Injectable({ providedIn: 'root' })
export class CompassService implements OnDestroy {

  readonly heading$ = new BehaviorSubject<HeadingVector | null>(null);

  private bound = this.onOrientation.bind(this);

  // Low-pass filter on the unit-vector components — never touches angle arithmetic
  private smoothSin = 0;
  private smoothCos = 0;
  private hasFirst  = false;
  private readonly SMOOTH = 0.1; // 0 = frozen, 1 = raw

  constructor(private zone: NgZone) {}

  /**
   * Requests iOS permission, starts listening, then waits up to 2 s for a
   * real heading reading. Returns true if the compass is working, false if
   * the device has no compass (e.g. a desktop PC).
   */
  async start(): Promise<boolean> {
    if (typeof DeviceOrientationEvent === 'undefined') return false;

    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DOE.requestPermission === 'function') {
      try { await DOE.requestPermission(); } catch { return false; }
    }

    window.addEventListener('deviceorientationabsolute', this.bound as EventListener, true);
    window.addEventListener('deviceorientation',         this.bound as EventListener, true);

    // Wait up to 2 s for a real reading to confirm compass is available
    const available = await new Promise<boolean>(resolve => {
      const timeout = setTimeout(() => resolve(false), 2000);
      const sub = this.heading$.subscribe(h => {
        if (h !== null) {
          clearTimeout(timeout);
          sub.unsubscribe();
          resolve(true);
        }
      });
    });

    if (!available) this.stop();
    return available;
  }

  stop(): void {
    window.removeEventListener('deviceorientationabsolute', this.bound as EventListener, true);
    window.removeEventListener('deviceorientation',         this.bound as EventListener, true);
  }

  ngOnDestroy(): void { this.stop(); }

  private onOrientation(e: DeviceOrientationEvent & { webkitCompassHeading?: number }): void {
    let headingDeg: number | null = null;

    if (e.webkitCompassHeading != null) {
      // iOS Safari — clockwise from magnetic north
      headingDeg = e.webkitCompassHeading;
    } else if (e.alpha != null) {
      // Android: alpha is counter-clockwise → flip to clockwise
      headingDeg = (360 - e.alpha) % 360;
    }

    if (headingDeg === null) return;

    // Convert to unit vector immediately — never work in angle space again
    const rad = (headingDeg * Math.PI) / 180;
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

    // Normalize so it stays a proper unit vector despite floating-point drift
    const len = Math.hypot(this.smoothSin, this.smoothCos);
    this.zone.runOutsideAngular(() =>
      this.heading$.next({ sin: this.smoothSin / len, cos: this.smoothCos / len })
    );
  }
}
