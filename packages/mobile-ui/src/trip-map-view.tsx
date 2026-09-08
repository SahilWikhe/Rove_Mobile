import { Card, Copy } from './index';
import type { TripMapProps } from './trip-map-types';
export function TripMap({ synthetic, driver }: TripMapProps) {
  return (
    <Card>
      <Copy kind="label">TRIP MAP</Copy>
      <Copy kind="muted">
        The interactive trip map is available in the iOS and Android apps. Your route details are below.
      </Copy>
      {driver && (
        <Copy kind="muted">
          Driver location last reported at {new Date(driver.sampledAt).toLocaleTimeString()}.
        </Copy>
      )}
      {synthetic && <Copy kind="muted">Synthetic pickup and destination.</Copy>}
    </Card>
  );
}
