import {
  Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, Output, EventEmitter,
} from '@angular/core';

const WINDOW_MS = 10_000;
const DEG       = Math.PI / 180;

interface Point  { t: number; v: number; }   // v is display-range 0–360
interface Series {
  name:    string;
  color:   string;
  data:    Point[];
  lastRaw: number;
  scale:   (raw: number) => number;   // raw value → 0–360 for canvas
}

// ── series definition ──────────────────────────────────────────────────────
// alpha:  0…360  → shown as-is
// beta: −180…180 → shifted +180 → 0…360
// gamma:  −90…90 → shifted+scaled × 2 → 0…360
const SERIES: Omit<Series, 'data' | 'lastRaw'>[] = [
  { name: 'doa α',     color: '#ff4444', scale: v => v          },
  { name: 'doa β',     color: '#ff9900', scale: v => v + 180    },
  { name: 'doa γ',     color: '#ffd700', scale: v => (v + 90)*2 },
  { name: 'doa hdg✦',  color: '#ff99cc', scale: v => v          },  // tilt-comp
  { name: 'do α',      color: '#4499ff', scale: v => v          },
  { name: 'do β',      color: '#44ee88', scale: v => v + 180    },
  { name: 'do γ',      color: '#cc44ff', scale: v => (v + 90)*2 },
  { name: 'webkit ✦',  color: '#00e5ff', scale: v => v          },
];

@Component({
  selector: 'app-sensor-plot',
  standalone: true,
  template: `
    <canvas #c></canvas>
    <button class="back" (click)="close.emit()">← Back</button>
  `,
  styles: [`
    :host {
      display: block; position: fixed; inset: 0; background: #0a0a0a;
      touch-action: none; overflow: hidden;
    }
    canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
    .back {
      position: absolute; top: max(env(safe-area-inset-top,0px), 0.5rem);
      right: 0.75rem; z-index: 20;
      background: rgba(255,255,255,0.12); color: #fff; border: none;
      padding: 0.4rem 0.85rem; border-radius: 20px; font-size: 0.85rem; cursor: pointer;
    }
  `],
})
export class SensorPlotComponent implements AfterViewInit, OnDestroy {

  @Output() close = new EventEmitter<void>();
  @ViewChild('c', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>;

  private series: Series[] = SERIES.map(s => ({ ...s, data: [], lastRaw: NaN }));
  private rafId  = 0;
  private onAbs!: EventListener;
  private onRel!: EventListener;

  ngAfterViewInit(): void {
    const canvas = this.canvasRef.nativeElement;
    const resize = () => {
      canvas.width  = canvas.clientWidth  * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
    };
    resize();
    new ResizeObserver(resize).observe(canvas);

    this.onAbs = ev => {
      const e = ev as DeviceOrientationEvent;
      const t = Date.now();
      if (e.alpha !== null) this.push(0, e.alpha, t);
      if (e.beta  !== null) this.push(1, e.beta,  t);
      if (e.gamma !== null) this.push(2, e.gamma, t);
      if (e.alpha !== null && e.beta !== null && e.gamma !== null) {
        const h = this.tiltHeading(e.alpha, e.beta, e.gamma);
        if (Number.isFinite(h)) this.push(3, h, t);
      }
    };

    this.onRel = ev => {
      const e = ev as DeviceOrientationEvent & { webkitCompassHeading?: number };
      const t = Date.now();
      if (e.alpha !== null) this.push(4, e.alpha, t);
      if (e.beta  !== null) this.push(5, e.beta,  t);
      if (e.gamma !== null) this.push(6, e.gamma, t);
      if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading))
        this.push(7, e.webkitCompassHeading, t);
    };

    window.addEventListener('deviceorientationabsolute', this.onAbs, true);
    window.addEventListener('deviceorientation',         this.onRel, true);
    this.loop();
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('deviceorientationabsolute', this.onAbs, true);
    window.removeEventListener('deviceorientation',         this.onRel, true);
  }

  // ── data helpers ─────────────────────────────────────────────────────────
  private push(idx: number, raw: number, t: number): void {
    const s = this.series[idx];
    s.lastRaw = raw;
    s.data.push({ t, v: s.scale(raw) });
    const cutoff = t - WINDOW_MS - 500;
    while (s.data.length > 1 && s.data[0].t < cutoff) s.data.shift();
  }

  private tiltHeading(a: number, b: number, g: number): number {
    const sa = Math.sin(a*DEG), ca = Math.cos(a*DEG);
    const sb = Math.sin(b*DEG);
    const sg = Math.sin(g*DEG), cg = Math.cos(g*DEG);
    const east  = -(ca*sg + sa*cg*sb);
    const north  =  ca*cg*sb - sa*sg;
    if (Math.hypot(east, north) < 0.1) return NaN;
    return (Math.atan2(east, north) / DEG + 360) % 360;
  }

  // ── render loop ──────────────────────────────────────────────────────────
  private loop = (): void => {
    this.rafId = requestAnimationFrame(this.loop);
    this.draw();
  };

  private draw(): void {
    const canvas = this.canvasRef.nativeElement;
    const W = canvas.width, H = canvas.height;
    const ctx = canvas.getContext('2d')!;
    const now = Date.now();
    const dpr = devicePixelRatio;

    ctx.clearRect(0, 0, W, H);

    // ── legend strip at top ──────────────────────────────────────────────
    const LEGEND_ROW_H = 18 * dpr;
    const LEGEND_ROWS  = Math.ceil(this.series.length / 2);
    const LEGEND_H     = LEGEND_ROWS * LEGEND_ROW_H + 6 * dpr;

    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(0, 0, W, LEGEND_H);

    ctx.font = `bold ${10.5 * dpr}px monospace`;
    for (let i = 0; i < this.series.length; i++) {
      const s   = this.series[i];
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x   = col * (W / 2) + 8 * dpr;
      const y   = row * LEGEND_ROW_H + 13 * dpr;
      ctx.fillStyle = s.color;
      const val = Number.isFinite(s.lastRaw) ? s.lastRaw.toFixed(1) : '---';
      ctx.fillText(`${s.name}: ${val}`, x, y);
    }

    // ── plot area ────────────────────────────────────────────────────────
    const PY = LEGEND_H;            // plot top y
    const PH = H - LEGEND_H;       // plot height

    // grid lines at display values 0, 90, 180, 270, 360
    // with axis labels showing raw values for alpha (shown as-is)
    // and equivalent beta/gamma values
    const GRID_LABELS: [number, string][] = [
      [  0, '0 / β−180 / γ−90'],
      [ 90, '90 / β−90 / γ−45'],
      [180, '180 / β0 / γ0'],
      [270, '270 / β90 / γ45'],
      [360, '360 / β180 / γ90'],
    ];
    ctx.font = `${8.5 * dpr}px monospace`;
    for (const [dv, label] of GRID_LABELS) {
      const y = PY + PH - (dv / 360) * PH;
      ctx.strokeStyle = 'rgba(255,255,255,0.1)';
      ctx.lineWidth = 1;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillText(label, 4, y - 2);
    }

    // vertical time-tick lines every 2 s
    ctx.font = `${8 * dpr}px monospace`;
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let dt = 2000; dt <= WINDOW_MS; dt += 2000) {
      const x = (1 - dt / WINDOW_MS) * W;
      ctx.strokeStyle = 'rgba(255,255,255,0.06)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, PY); ctx.lineTo(x, H); ctx.stroke();
      ctx.fillText(`-${dt/1000}s`, x + 2, H - 4);
    }

    // ── data series ──────────────────────────────────────────────────────
    for (const s of this.series) {
      if (s.data.length < 2) continue;
      ctx.strokeStyle = s.color;
      ctx.lineWidth   = 2 * dpr;
      ctx.setLineDash([]);
      ctx.beginPath();
      let first = true;
      for (const pt of s.data) {
        const x = (1 - (now - pt.t) / WINDOW_MS) * W;
        const y = PY + PH - (Math.max(0, Math.min(360, pt.v)) / 360) * PH;
        if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // "now" marker
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth   = 1;
    ctx.setLineDash([4 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.moveTo(W, PY); ctx.lineTo(W, H); ctx.stroke();
    ctx.setLineDash([]);
  }
}
