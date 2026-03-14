import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface HeadingVector {
  sin: number; // east
  cos: number; // north
}

@Injectable({ providedIn: 'root' })
export class CompassService implements OnDestroy {
  readonly heading$ = new BehaviorSubject<HeadingVector | null>(null);
  readonly available$ = new BehaviorSubject<boolean>(false);

  private bound = this.onOrientation.bind(this);

  private smoothSin = 0;
  private smoothCos = 0;
  private hasFirst = false;

  private readonly SMOOTH = 0.15;

  constructor(private zone: NgZone) {}

  async start(): Promise<boolean> {
    this.stop();
    this.reset();

    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
      return false;
    }

    const DOE = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };

    if (typeof DOE.requestPermission === 'function') {
      try {
        const permission = await DOE.requestPermission();
        if (permission !== 'granted') return false;
      } catch {
        return false;
      }
    }

    // deviceorientation is the event Safari uses for webkitCompassHeading.
    // On other browsers we will filter for e.absolute === true inside the handler.
    window.addEventListener('deviceorientation', this.bound as EventListener, true);

    // Wait only for a real absolute heading.
    const available = await new Promise<boolean>((resolve) => {
      const timeout = window.setTimeout(() => resolve(false), 2500);

      const sub = this.available$.subscribe((ok) => {
        if (ok) {
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
    window.removeEventListener('deviceorientation', this.bound as EventListener, true);
    this.available$.next(false);
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private reset(): void {
    this.smoothSin = 0;
    this.smoothCos = 0;
    this.hasFirst = false;
    this.heading$.next(null);
    this.available$.next(false);
  }

  private onOrientation(
    e: DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number }
  ): void {
    let headingDeg: number | null = null;

    // iOS Safari: this is the real compass heading, clockwise from north.
    if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) {
      headingDeg = normalizeDeg(e.webkitCompassHeading);
    }
    // Other browsers: accept only Earth-referenced readings.
    else if (e.absolute === true && typeof e.alpha === 'number' && Number.isFinite(e.alpha)) {
      headingDeg = normalizeDeg(360 - e.alpha);
    } else {
      // Ignore relative / arbitrary-frame readings.
      return;
    }

    const rad = headingDeg * Math.PI / 180;
    const s = Math.sin(rad);
    const c = Math.cos(rad);

    if (!this.hasFirst) {
      this.smoothSin = s;
      this.smoothCos = c;
      this.hasFirst = true;
    } else {
      this.smoothSin = this.SMOOTH * s + (1 - this.SMOOTH) * this.smoothSin;
      this.smoothCos = this.SMOOTH * c + (1 - this.SMOOTH) * this.smoothCos;
    }

    const len = Math.hypot(this.smoothSin, this.smoothCos);
    if (len < 1e-6) return;

    const value: HeadingVector = {
      sin: this.smoothSin / len,
      cos: this.smoothCos / len,
    };

    // Usually better for Angular consumers than runOutsideAngular here.
    this.zone.run(() => {
      this.available$.next(true);
      this.heading$.next(value);
    });
  }
}

function normalizeDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}