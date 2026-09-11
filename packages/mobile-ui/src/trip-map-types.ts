export interface TripMapProps {
  pickup: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  androidEnabled?: boolean;
  iosEnabled?: boolean;
  synthetic?: boolean;
  /** Fill a parent map viewport instead of rendering an inline map card. */
  fill?: boolean;
  driver?: { coordinate: { latitude: number; longitude: number }; sampledAt: string };
}
