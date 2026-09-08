export interface TripMapProps {
  pickup: { latitude: number; longitude: number };
  destination: { latitude: number; longitude: number };
  androidEnabled?: boolean;
  iosEnabled?: boolean;
  synthetic?: boolean;
}
