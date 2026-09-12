import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function firebaseClient(path, role, expectedProject) {
  try {
    if (typeof path !== 'string' || !path) return false;
    const file = statSync(path);
    if (!file.isFile() || file.size > 1024 * 1024) return false;
    const client = JSON.parse(readFileSync(path, 'utf8'));
    // A service-account key is a server credential, never mobile build configuration.
    if (client.type === 'service_account' || client.private_key || client.private_key_id) return false;
    const project = client.project_info;
    if (!project || typeof project.project_id !== 'string' || !project.project_id.trim()) return false;
    if (expectedProject && project.project_id !== expectedProject) return false;
    return (
      Array.isArray(client.client) &&
      client.client.some(
        (entry) =>
          entry?.client_info?.android_client_info?.package_name === `co.roveride.${role}` &&
          typeof entry.client_info.mobilesdk_app_id === 'string' &&
          entry.client_info.mobilesdk_app_id.includes(':android:'),
      )
    );
  } catch {
    return false;
  }
}

export function checkMobileBuild(role, env, productionConfiguration) {
  if (!['rider', 'driver'].includes(role)) throw new Error('Choose rider or driver.');
  const profile = JSON.parse(readFileSync(new URL(`../apps/${role}/eas.json`, import.meta.url))).build
    .staging;
  const production = env.EAS_BUILD_PROFILE === 'production';
  const approved = production
    ? (productionConfiguration ??
        JSON.parse(readFileSync(new URL('../config/mobile-production.json', import.meta.url))))[role]
    : profile.env;
  const invalid = [];
  const required = [
    'EXPO_PUBLIC_API_URL',
    'EXPO_PUBLIC_AUTH_ISSUER',
    'EXPO_PUBLIC_AUTH_AUDIENCE',
    'EXPO_PUBLIC_AUTH_CLIENT_ID',
    'EXPO_PUBLIC_EAS_PROJECT_ID',
  ];
  if (production) {
    for (const key of required) {
      if (
        !approved?.[key] ||
        env[key] !== approved[key] ||
        (key !== 'EXPO_PUBLIC_EAS_PROJECT_ID' && approved[key] === profile.env[key])
      )
        invalid.push(key);
    }
    for (const key of required.slice(0, 3)) {
      try {
        const url = new URL(approved?.[key]);
        if (
          url.protocol !== 'https:' ||
          url.origin === new URL(profile.env[key]).origin ||
          url.username ||
          url.password ||
          url.search ||
          url.hash ||
          !url.hostname.includes('.') ||
          /(?:localhost|127\.0\.0\.1|\.local)$/.test(url.hostname)
        )
          invalid.push(key);
      } catch {
        invalid.push(key);
      }
    }
  }
  invalid.push(
    ...Object.entries(production ? { EXPO_PUBLIC_SYNTHETIC: 'false' } : profile.env)
      .filter(([key, value]) => env[key] !== value)
      .map(([key]) => key),
  );
  if (!['staging', 'staging-simulator', 'production'].includes(env.EAS_BUILD_PROFILE))
    invalid.push('EAS_BUILD_PROFILE');
  if (!['ios', 'android'].includes(env.EAS_BUILD_PLATFORM)) invalid.push('EAS_BUILD_PLATFORM');
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      env.EXPO_PUBLIC_EAS_PROJECT_ID ?? '',
    )
  )
    invalid.push('EXPO_PUBLIC_EAS_PROJECT_ID');
  const maps = `EXPO_PUBLIC_GOOGLE_MAPS_${env.EAS_BUILD_PLATFORM === 'ios' ? 'IOS' : 'ANDROID'}_KEY`;
  if (!/^AIza[\w-]{35}$/.test(env[maps] ?? '')) invalid.push(maps);
  const publishablePattern = production ? /^pk_live_[a-zA-Z0-9]+$/ : /^pk_test_[a-zA-Z0-9]+$/;
  if (role === 'rider' && !publishablePattern.test(env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''))
    invalid.push('EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY');
  if (env.EAS_BUILD_PLATFORM === 'android') {
    const expectedProject = production ? approved?.ANDROID_FIREBASE_PROJECT_ID : undefined;
    if (production && (typeof expectedProject !== 'string' || !expectedProject.trim()))
      invalid.push('ANDROID_FIREBASE_PROJECT_ID');
    if (
      (production || env.GOOGLE_SERVICES_JSON) &&
      !firebaseClient(env.GOOGLE_SERVICES_JSON, role, expectedProject)
    )
      invalid.push('GOOGLE_SERVICES_JSON');
  }
  if (invalid.length)
    throw new Error(
      `Invalid ${production ? 'production' : 'staging'} build settings: ${[...new Set(invalid)].join(', ')}`,
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkMobileBuild(process.argv[2], process.env);
    console.log('Mobile build configuration passed.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
