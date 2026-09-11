import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function checkMobileBuild(role, env) {
  if (!['rider', 'driver'].includes(role)) throw new Error('Choose rider or driver.');
  const profile = JSON.parse(readFileSync(new URL(`../apps/${role}/eas.json`, import.meta.url))).build
    .staging;
  const invalid = Object.entries(profile.env)
    .filter(([key, value]) => env[key] !== value)
    .map(([key]) => key);
  if (!['staging', 'staging-simulator'].includes(env.EAS_BUILD_PROFILE)) invalid.push('EAS_BUILD_PROFILE');
  if (!['ios', 'android'].includes(env.EAS_BUILD_PLATFORM)) invalid.push('EAS_BUILD_PLATFORM');
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '',
    )
  )
    invalid.push('EXPO_PUBLIC_EAS_PROJECT_ID');
  const maps = `EXPO_PUBLIC_GOOGLE_MAPS_${env.EAS_BUILD_PLATFORM === 'ios' ? 'IOS' : 'ANDROID'}_KEY`;
  if (!/^AIza[\w-]{35}$/.test(env[maps] ?? '')) invalid.push(maps);
  if (role === 'rider' && !/^pk_test_[a-zA-Z0-9]+$/.test(env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''))
    invalid.push('EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY');
  if (invalid.length) throw new Error(`Invalid staging build settings: ${invalid.join(', ')}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkMobileBuild(process.argv[2], process.env);
    console.log('Staging mobile build configuration passed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
