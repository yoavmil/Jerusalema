import { Injectable } from '@angular/core';

export interface LatLng { lat: number; lng: number; }

const JERUSALEM: LatLng = { lat: 31.7683, lng: 35.2137 };

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

@Injectable({ providedIn: 'root' })
export class GeoService {

  /** Returns bearing in clockwise degrees from north (0–360). */
  bearing(from: LatLng, to: LatLng = JERUSALEM): number {
    const dL = toRad(to.lng - from.lng);
    const f1 = toRad(from.lat);
    const f2 = toRad(to.lat);
    const y = Math.sin(dL) * Math.cos(f2);
    const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dL);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  /** Returns great-circle distance in km. */
  distanceKm(from: LatLng, to: LatLng = JERUSALEM): number {
    const R = 6371;
    const dLat = toRad(to.lat - from.lat);
    const dLng = toRad(to.lng - from.lng);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Resolves with the device's current GPS position. */
  getPosition(): Promise<GeolocationPosition> {
    return new Promise((ok, fail) =>
      navigator.geolocation.getCurrentPosition(ok, fail, {
        enableHighAccuracy: true,
        timeout: 15_000,
      })
    );
  }
}
