const [driverApk, riderApk, ...rest] = process.argv.slice(2);
if (!driverApk || !riderApk || rest.length) {
  console.error(
    'Usage: node scripts/android-trip-journey.mjs /path/to/driver-debug.apk /path/to/rider-debug.apk',
  );
  process.exit(1);
}
process.env.TRIP_RIDER_APK = riderApk;
process.argv = [process.argv[0], process.argv[1], 'driver', driverApk];
await import('./android-account-journey.mjs');
