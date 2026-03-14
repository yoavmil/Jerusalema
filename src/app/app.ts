import { Component } from '@angular/core';
import { GeoService } from './services/geo.service';
import { CompassService } from './services/compass.service';
import { ArViewComponent } from './ar-view/ar-view.component';

type AppState = 'splash' | 'loading' | 'ar' | 'error';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ArViewComponent],
  template: `
    @if (state === 'ar') {
      <app-ar-view [bearing]="bearing" [distLabel]="distLabel" />
    }

    @if (state !== 'ar') {
      <div class="overlay">
        <div class="card">
          <div class="icon">🕍</div>
          <h1>Jerusalem Arrow</h1>
          <p>A golden arrow will appear on the floor, always pointing toward Jerusalem — no matter where you are on Earth.</p>

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

    .btn {
      margin-top: 0.5rem;
      background: linear-gradient(135deg, #2563eb, #1d4ed8);
      color: #fff; border: none; padding: 0.85rem 2.5rem;
      border-radius: 50px; font-size: 1.05rem; font-weight: 600; cursor: pointer;
      box-shadow: 0 4px 20px rgba(37, 99, 235, 0.5);
    }

    .spinner-wrap {
      display: flex; flex-direction: column; align-items: center; gap: 0.75rem;
      color: rgba(255,255,255,0.7); font-size: 0.9rem;
    }

    .spinner {
      width: 36px; height: 36px;
      border: 3px solid rgba(255,255,255,0.2);
      border-top-color: #fff;
      border-radius: 50%;
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
export class App {

  state: AppState = 'splash';
  loadingMsg = '';
  errorMsg   = '';
  bearing    = 0;
  distLabel  = '';

  constructor(private geo: GeoService, private compass: CompassService) {}

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
}
