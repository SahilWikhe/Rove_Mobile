import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

const tools = {
  gh: { setting: 'ROVE_GH_BINARY', paths: ['/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'] },
  auth0: {
    setting: 'ROVE_AUTH0_BINARY',
    paths: ['/opt/homebrew/bin/auth0', '/usr/local/bin/auth0', '/usr/bin/auth0'],
  },
};
export function absoluteTool(path) {
  if (typeof path !== 'string' || !isAbsolute(path))
    throw new Error('Configure an absolute executable path.');
  const target = realpathSync(path);
  if (!statSync(target).isFile()) throw new Error('Executable must be a regular file.');
  accessSync(target, constants.X_OK);
  return target;
}
/** Startup configuration is trusted; never search inherited PATH or the current directory. */
export function developerTool(name, env = process.env) {
  if (!Object.hasOwn(tools, name)) throw new Error('Unsupported developer tool.');
  const { setting, paths } = tools[name];
  if (env[setting] !== undefined) return absoluteTool(env[setting]);
  for (const path of paths) {
    try {
      return absoluteTool(path);
    } catch {
      /* Try the next known installation path. */
    }
  }
  throw new Error(`Install ${name} or set ${setting} to its absolute executable path.`);
}
