export interface TripMapProps {
  route?: { latitude: number; longitude: number }[];
  height?: number;
  pickup: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  androidEnabled?: boolean;
  iosEnabled?: boolean;
  synthetic?: boolean;
  /** Fill a parent map viewport instead of rendering an inline map card. */
  fill?: boolean;
  /** Space occupied by controls/status above the map's useful framing area. */
  topInset?: number;
  /** Overlay compact controls over a full-screen map. */
  floating?: boolean;
  bottomInset?: number;
  /** Keep a fresh driver marker in view until the rider pans or shows the full trip. */
  followDriver?: boolean;
  driver?: { coordinate: { latitude: number; longitude: number }; sampledAt: string };
}
