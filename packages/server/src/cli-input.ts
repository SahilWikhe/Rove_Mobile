import { closeSync, constants, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

/** CLI-only input boundary. Invoke from the directory containing the approved ignored inputs. */
export function readCliInput(filename: string, directory = process.cwd()): string {
  const root = realpathSync(directory);
  const target = realpathSync(resolve(root, filename));
  const path = relative(root, target);
  if (!path || isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`))
    throw new Error('Input must be a file within the working directory.');
  const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024 * 1024)
      throw new Error('Input must be a regular file no larger than 1 MiB.');
    return readFileSync(fd, 'utf8');
  } finally {
    closeSync(fd);
  }
}
