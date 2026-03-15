import { Component, OnInit } from '@angular/core';
import { GeoService } from './services/geo.service';
import { CompassService } from './services/compass.service';
import { ArViewComponent } from './ar-view/ar-view.component';
import { SensorPlotComponent } from './sensor-plot/sensor-plot.component';

type AppState    = 'splash' | 'loading' | 'ar' | 'error' | 'debug';
type CompassProbe = 'checking' | 'absolute' | 'ios-needs-permission' | 'none';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ArViewComponent, SensorPlotComponent],
  template: `
    @if (state === 'ar') {
      <app-ar-view [bearing]="bearing" [distLabel]="distLabel" />
    }

    @if (state === 'debug') {
      <app-sensor-plot (close)="state = 'splash'" />
    }

    @if (state !== 'ar' && state !== 'debug') {
      <div class="overlay">
        <div class="card">
          <div class="icon">🕍</div>
          <h1>Jerusalem Arrow</h1>
          <p>A golden arrow will appear on the floor, always pointing toward Jerusalem — no matter where you are on Earth.</p>

          <!-- Compass probe status chip -->
          <div class="chip" [class]="'chip--' + compassProbe">
            @switch (compassProbe) {
              @case ('checking') {
                <span class="dot dot--spin"></span> Detecting compass…
              }
              @case ('absolute') {
                <span class="dot dot--ok"></span> Absolute compass detected
              }
              @case ('ios-needs-permission') {
                <span class="dot dot--warn"></span> Compass: permission required on first tap
              }
              @case ('none') {
                <span class="dot dot--err"></span> No absolute compass — app may not work correctly
              }
            }
          </div>

          @if (state === 'splash' || state === 'error') {
            <button (click)="start()" class="btn">
              {{ state === 'error' ? 'Try Again' : 'Begin' }}
            </button>

          }

          @if (state === 'loading') {
            <div class="spinner-wrap">
              <div class="spinner"></div>
              <span>{{ loadingMsg }}</span>
            </div>
          }

          @if (errorMsg) {
            <p class="error-msg">{{ errorMsg }}</p>
          }
        </div>
      </div>
    }
  `,
  styles: [`
    :host { display: block; }

    .overlay {
      position: fixed; inset: 0;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0, 0, 0, 0.88);
      font-family: -apple-system, BlinkMacSystemFont, sans-serif;
      z-index: 100;
    }

    .card {
      display: flex; flex-direction: column; align-items: center;
      text-align: center; color: #fff; padding: 2.5rem; max-width: 340px; gap: 0.9rem;
    }

    .icon { font-size: 3.5rem; }

    h1 { font-size: 1.8rem; font-weight: 700; letter-spacing: -0.5px; margin: 0; }

    p { color: rgba(255,255,255,0.65); line-height: 1.6; font-size: 0.95rem; margin: 0; }

    /* compass probe chip */
    .chip {
      display: flex; align-items: center; gap: 0.45rem;
      font-size: 0.8rem; padding: 0.35rem 0.8rem; border-radius: 20px;
      border: 1px solid transparent;
    }
    .chip--checking  { color: rgba(255,255,255,0.5);  border-color: rgba(255,255,255,0.15); }
    .chip--absolute  { color: #4ade80; border-color: rgba(74,222,128,0.35);
                       background: rgba(74,222,128,0.08); }
    .chip--ios-needs-permission { color: #fbbf24; border-color: rgba(251,191,36,0.35);
                       background: rgba(251,191,36,0.08); }
    .chip--none      { color: #f87171; border-color: rgba(248,113,113,0.35);
                       background: rgba(248,113,113,0.08); }

    .dot {
      display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0;
    }
    .dot--ok   { background: #4ade80; }
    .dot--warn { background: #fbbf24; }
    .dot--err  { background: #f87171; }
    .dot--spin {
      border: 2px solid rgba(255,255,255,0.3); border-top-color: #fff;
      border-radius: 50%; animation: spin 0.8s linear infinite;
    }

    .btn {
      margin-top: 0.5rem;
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: #fff; border: none; padding: 0.85rem 2.5rem;
      border-radius: 50px; font-size: 1.05rem; font-weight: 600; cursor: pointer;
      box-shadow: 0 4px 20px rgba(37, 99, 235, 0.5);
    }

    .btn-debug {
      background: none; color: rgba(255,255,255,0.35); border: 1px solid rgba(255,255,255,0.2);
      padding: 0.5rem 1.5rem; border-radius: 50px; font-size: 0.85rem; cursor: pointer;
    }

    .spinner-wrap {
      display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
      color: rgba(255,255,255,0.7); font-size: 0.9rem;
    }

    .spinner {
      width: 36px; height: 36px;
      border: 3px solid rgba(255,255,255,0.2);
      border-top-color: #fff; border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .error-msg {
      color: #f87171; font-size: 0.88rem;
      background: rgba(220, 38, 38, 0.15);
      border: 1px solid rgba(220, 38, 38, 0.4);
      border-radius: 10px; padding: 0.6rem 0.9rem; margin: 0;
    }
  `],
})
export class App implements OnInit {

  state: AppState      = 'splash';
  compassProbe: CompassProbe = 'checking';
  loadingMsg = '';
  errorMsg   = '';
  bearing    = 0;
  distLabel  = '';

  constructor(private geo: GeoService, private compass: CompassService) {
    (screen.orientation as any)?.lock?.('portrait').catch(() => {});
  }

  ngOnInit(): void {
    this.probeCompass();
  }

  async start(): Promise<void> {
    this.errorMsg = '';
    this.state    = 'loading';

    // 1. GPS
    this.loadingMsg = 'Getting your location…';
    let pos: GeolocationPosition;
    try {
      pos = await this.geo.getPosition();
    } catch {
      this.errorMsg = 'Location permission required. Please allow location access.';
      this.state    = 'error';
      return;
    }

    const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    this.bearing   = this.geo.bearing(here);
    const km       = Math.round(this.geo.distanceKm(here));
    this.distLabel = `Jerusalem · ${km.toLocaleString()} km away`;

    // 2. Compass
    this.loadingMsg = 'Starting compass…';
    const hasCompass = await this.compass.start();
    if (!hasCompass) {
      this.errorMsg = 'No compass detected. This app requires a device with a magnetometer (e.g. a smartphone).';
      this.state    = 'error';
      return;
    }

    // 3. Show AR
    this.state = 'ar';
  }

  // ── Compass capability probe ────────────────────────────────────────────
  // Runs silently on the splash screen without requesting any permission.
  // iOS 13+: DeviceOrientationEvent.requestPermission exists → we know a
  //   hardware compass may be present but can't fire events without asking.
  // Android / desktop: listen for 3 s; absolute data arrives → green.
  private async probeCompass(): Promise<void> {
    if (typeof DeviceOrientationEvent === 'undefined') {
      this.compassProbe = 'none';
      return;
    }

    // iOS requires an explicit user-gesture permission before any events fire
    const DOE = DeviceOrientationEvent as any;
    if (typeof DOE.requestPermission === 'function') {
      this.compassProbe = 'ios-needs-permission';
      return;
    }

    // Non-iOS: listen for absolute data for up to 3 seconds
    const found = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => { cleanup(); resolve(false); }, 3000);

      const onAbsolute = () => { clearTimeout(timer); cleanup(); resolve(true); };

      const onRelative = (ev: Event) => {
        const e = ev as DeviceOrientationEvent & { webkitCompassHeading?: number };
        if (e.absolute === true || typeof e.webkitCompassHeading === 'number') {
          clearTimeout(timer); cleanup(); resolve(true);
        }
      };

      const cleanup = () => {
        window.removeEventListener('deviceorientationabsolute', onAbsolute, true);
        window.removeEventListener('deviceorientation',         onRelative, true);
      };

      window.addEventListener('deviceorientationabsolute', onAbsolute, true);
      window.addEventListener('deviceorientation',         onRelative, true);
    });

    this.compassProbe = found ? 'absolute' : 'none';
  }
}
