import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class CompassService implements OnDestroy {

  /** Current compass heading in clockwise degrees from magnetic north (0–360). */
  readonly heading$ = new BehaviorSubject<number | null>(null);

  private bound = this.onOrientation.bind(this);

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

  ngOnDestroy(): void {
    this.stop();
  }

  private onOrientation(e: DeviceOrientationEvent & { webkitCompassHeading?: number }): void {
    let h: number | null = null;

    if (e.webkitCompassHeading != null) {
      // iOS Safari — clockwise from magnetic north, ready to use
      h = e.webkitCompassHeading;
    } else if (e.alpha != null) {
      // Android (absolute or relative): alpha increases counter-clockwise → flip
      h = (360 - e.alpha) % 360;
    }

    if (h !== null) {
      // Emit outside Angular zone; components subscribe and drive rendering themselves
      this.zone.runOutsideAngular(() => this.heading$.next(h));
    }
  }
}
