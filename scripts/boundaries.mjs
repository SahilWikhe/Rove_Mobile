import ts from 'typescript';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
const root = resolve(import.meta.dirname, '..');
const allowed = {
  rider: ['contracts', 'mobile-core', 'mobile-ui'],
  driver: ['contracts', 'mobile-core', 'mobile-ui'],
  'mobile-core': ['contracts'],
  'mobile-ui': ['contracts'],
  contracts: [],
  database: [],
  server: ['contracts', 'database'],
  api: ['contracts', 'database', 'server'],
};
const mobile = new Set(['rider', 'driver', 'mobile-core', 'mobile-ui', 'contracts']);
function owner(path) {
  return /^(?:apps|packages)\/([^/]+)\//.exec(path)?.[1];
}
function importTarget(source, specifier) {
  if (specifier.startsWith('@rove/')) return specifier.split('/')[1];
  if (specifier.startsWith('.'))
    return owner(relative(root, resolve(root, dirname(source), specifier)).replaceAll('\\', '/'));
  return null;
}
export function violations(source, text) {
  const packageName = owner(source);
  if (!allowed[packageName]) return [];
  const failures = [];
  const file = ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true);
  function check(specifier) {
    const target = importTarget(source, specifier);
    if (target && target !== packageName && !allowed[packageName].includes(target))
      failures.push('Forbidden package dependency: ' + specifier);
    if (
      mobile.has(packageName) &&
      /^(?:node:|pg(?:\/|$)|drizzle-orm(?:\/|$)|embedded-postgres(?:\/|$))/.test(specifier)
    )
      failures.push('Server-only dependency in mobile/shared contracts: ' + specifier);
    if (
      specifier === '@rove/database/testing' &&
      !source.endsWith('.test.ts') &&
      source !== 'apps/api/src/local.ts'
    )
      failures.push('Test database imported by production source');
  }
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      check(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) check(argument.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return failures;
}
async function files(directory) {
  const result = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.expo', '.turbo'].includes(item.name)) continue;
    const path = resolve(directory, item.name);
    if (/^apps\/[^/]+\/(ios|android)$/.test(relative(root, path).replaceAll('\\', '/'))) continue;
    if (item.isDirectory()) result.push(...(await files(path)));
    else if (/\.(?:ts|tsx)$/.test(item.name)) result.push(path);
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let count = 0;
  for (const folder of ['apps', 'packages'])
    for (const path of await files(resolve(root, folder))) {
      const source = relative(root, path).replaceAll('\\', '/');
      for (const problem of violations(source, await readFile(path, 'utf8'))) {
        console.error(source + ': ' + problem);
        count++;
      }
    }
  if (count) process.exitCode = 1;
  else console.log('Workspace import boundaries passed.');
}
