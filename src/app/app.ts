import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

export interface HeadingVector {
  sin: number;
  cos: number;
}

export type CompassStatus =
  | 'unsupported'
  | 'permission-denied'
  | 'blocked'
  | 'relative-only'
  | 'absolute-ready'
  | 'no-events';

@Injectable({ providedIn: 'root' })
export class CompassService implements OnDestroy {
  readonly heading$ = new BehaviorSubject<HeadingVector | null>(null);
  readonly status$ = new BehaviorSubject<CompassStatus>('unsupported');

  private bound = this.onOrientation.bind(this);

  private smoothSin = 0;
  private smoothCos = 0;
  private hasFirst = false;

  private sawAnyEvent = false;
  private sawRelative = false;
  private sawAbsolute = false;

  private readonly SMOOTH = 0.15;

  constructor(private zone: NgZone) {}

  async start(): Promise<CompassStatus> {
    this.stop();
    this.reset();

    if (typeof window === 'undefined' || typeof DeviceOrientationEvent === 'undefined') {
      this.status$.next('unsupported');
      return 'unsupported';
    }

    // iOS path
    const DOE = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
      requestPermission?: (absolute?: boolean) => Promise<'granted' | 'denied'>;
    };

    if (typeof DOE.requestPermission === 'function') {
      try {
        const result = await DOE.requestPermission(true);
        if (result !== 'granted') {
          this.status$.next('permission-denied');
          return 'permission-denied';
        }
      } catch {
        this.status$.next('permission-denied');
        return 'permission-denied';
      }
    }

    window.addEventListener('deviceorientation', this.bound as EventListener, true);
    window.addEventListener('deviceorientationabsolute', this.bound as EventListener, true);

    const status = await new Promise<CompassStatus>((resolve) => {
      const timeout = window.setTimeout(() => {
        if (this.sawAbsolute) return resolve('absolute-ready');
        if (this.sawRelative) return resolve('relative-only');
        if (this.sawAnyEvent) return resolve('blocked');
        resolve('no-events');
      }, 3000);

      const sub = this.status$.subscribe((s) => {
        if (s === 'absolute-ready') {
          clearTimeout(timeout);
          sub.unsubscribe();
          resolve(s);
        }
      });
    });

    this.status$.next(status);

    if (status !== 'absolute-ready' && status !== 'relative-only') {
      this.stop();
    }

    return status;
  }

  stop(): void {
    window.removeEventListener('deviceorientation', this.bound as EventListener, true);
    window.removeEventListener('deviceorientationabsolute', this.bound as EventListener, true);
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private reset(): void {
    this.smoothSin = 0;
    this.smoothCos = 0;
    this.hasFirst = false;

    this.sawAnyEvent = false;
    this.sawRelative = false;
    this.sawAbsolute = false;

    this.heading$.next(null);
    this.status$.next('unsupported');
  }

  private onOrientation(
    e: DeviceOrientationEvent & { webkitCompassHeading?: number }
  ): void {
    this.sawAnyEvent = true;

    let headingDeg: number | null = null;

    // iOS Safari: real compass
    if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) {
      headingDeg = normalize(e.webkitCompassHeading);
      this.sawAbsolute = true;
    }
    // Android / other browsers: absolute Earth-referenced reading
    else if (e.absolute === true && typeof e.alpha === 'number' && Number.isFinite(e.alpha)) {
      headingDeg = normalize(360 - e.alpha);
      this.sawAbsolute = true;
    }
    // Relative-only orientation exists, but not a true compass heading
    else if (typeof e.alpha === 'number' && Number.isFinite(e.alpha)) {
      this.sawRelative = true;
      if (this.status$.value !== 'absolute-ready') {
        this.zone.run(() => this.status$.next('relative-only'));
      }
      return;
    } else {
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

    this.zone.run(() => {
      this.status$.next('absolute-ready');
      this.heading$.next({
        sin: this.smoothSin / len,
        cos: this.smoothCos / len,
      });
    });
  }
}

function normalize(deg: number): number {
  return ((deg % 360) + 360) % 360;
}