import { readFileSync } from 'node:fs';
import { parseMapsStagingEnvironment } from './maps-staging-environment';
import { GoogleMapsProvider } from './google-maps';
import { inspectMapsStaging, MapsReadinessError } from './maps-staging-readiness';
const [filename, pickup, destination, confirmation] = process.argv.slice(2);
if (
  !filename ||
  !pickup ||
  !destination ||
  confirmation !== '--allow-billable-requests' ||
  process.argv.length !== 6
) {
  console.error(
    'Usage: pnpm maps:staging:check /path/to/ignored-staging.env "public pickup location" "public destination" --allow-billable-requests',
  );
  console.error(
    'Performs up to five Google Maps API requests, which may incur charges. Use public test locations.',
  );
  process.exitCode = 1;
} else {
  try {
    await inspectMapsStaging(
      parseMapsStagingEnvironment(readFileSync(filename, 'utf8')),
      { pickup, destination },
      (key, area) => new GoogleMapsProvider(key, area),
      true,
    );
    console.log('Staging address search, place details, service-area checks and driving route passed.');
    console.log(
      'No rides or database records created. Mobile map rendering, key restrictions, quotas and billing alerts need separate verification.',
    );
  } catch (error) {
    console.error(
      error instanceof MapsReadinessError ? error.message : 'Unable to read staging configuration.',
    );
    process.exitCode = 1;
  }
}
