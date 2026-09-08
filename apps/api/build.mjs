import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';
const result = await build({
  entryPoints: { index: 'index.ts', 'http-function': 'api/index.ts', 'queue-function': 'api/worker.ts' },
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['pg-native'],
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  metafile: true,
});
if (
  Object.keys(result.metafile.inputs).some((path) =>
    /embedded-postgres|database\/src\/testing|api\/src\/(?:local(?:-payments)?|staging-smoke)\.ts/.test(path),
  )
)
  throw new Error('Synthetic database/runtime included in deployment bundle.');
await writeFile('dist/meta.json', JSON.stringify(result.metafile));
