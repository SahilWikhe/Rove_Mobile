import { expect, test } from 'vitest';
import { parseMapsStagingEnvironment } from './maps-staging-environment';
const area = JSON.stringify({ south: 35, north: 37, west: -80, east: -77 });
test.each([area, `'${area}'`, `"${area}"`])(
  'reads service-area JSON from supported env quoting: %s',
  (value) => {
    const env = parseMapsStagingEnvironment(
      `ROVE_ENVIRONMENT=staging\nSERVICE_AREA_JSON=${value}\nGOOGLE_MAPS_API_KEY=synthetic-key\n`,
    );
    expect(env.SERVICE_AREA_JSON).toBe(area);
    expect(env.GOOGLE_MAPS_API_KEY).toBe('synthetic-key');
    expect(env.ROVE_ENVIRONMENT).toBe('staging');
  },
);
test('does not evaluate shell expressions or transform unrelated secrets', () => {
  const env = parseMapsStagingEnvironment(
    `SERVICE_AREA_JSON="${area}"\nGOOGLE_MAPS_API_KEY='$(echo synthetic)'\n`,
  );
  expect(env.GOOGLE_MAPS_API_KEY).toBe('$(echo synthetic)');
});
test('rejects duplicate area definitions and leaves malformed JSON invalid', () => {
  expect(
    parseMapsStagingEnvironment(`SERVICE_AREA_JSON='${area}'\nSERVICE_AREA_JSON='${area}'`).SERVICE_AREA_JSON,
  ).toBeUndefined();
  expect(() =>
    JSON.parse(parseMapsStagingEnvironment('SERVICE_AREA_JSON="{invalid}"').SERVICE_AREA_JSON!),
  ).toThrow();
});
