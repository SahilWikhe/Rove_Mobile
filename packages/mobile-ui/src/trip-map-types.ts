export interface TripMapProps {
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
  driver?: { coordinate: { latitude: number; longitude: number }; sampledAt: string };
}
