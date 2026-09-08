import { Card, Copy } from './index';
import type { TripMapProps } from './trip-map-types';
export function TripMap({ synthetic }: TripMapProps) {
  return (
    <Card>
      <Copy kind="label">TRIP MAP</Copy>
      <Copy kind="muted">
        The interactive trip map is available in the iOS and Android apps. Your route details are below.
      </Copy>
      {synthetic && <Copy kind="muted">Synthetic pickup and destination.</Copy>}
    </Card>
  );
}
