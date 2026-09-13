const [driverApp, riderApp, driverPort = '8191', ...rest] = process.argv.slice(2);
if (!driverApp || !riderApp || rest.length) {
  console.error(
    'Usage: node scripts/ios-trip-journey.mjs /path/to/driver-debug.app /path/to/rider-debug.app [driver-metro-port]',
  );
  process.exit(1);
}
process.env.TRIP_RIDER_APP = riderApp;
process.argv = [process.argv[0], process.argv[1], 'driver', driverApp, driverPort];
await import('./ios-account-journey.mjs');
