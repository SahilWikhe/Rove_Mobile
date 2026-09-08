import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const release = '8.30.1';
const platform = process.platform + '_' + (process.arch === 'x64' ? 'x64' : process.arch);
const checksums = {
  darwin_arm64: 'b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5',
  linux_x64: '551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
};
if (!checksums[platform]) throw new Error('Unsupported scanner platform: ' + platform);
const asset = 'gitleaks_' + release + '_' + platform + '.tar.gz';
const response = await fetch(
  'https://github.com/gitleaks/gitleaks/releases/download/v' + release + '/' + asset,
);
if (!response.ok) throw new Error('Could not download the pinned secret scanner.');
const bytes = Buffer.from(await response.arrayBuffer());
if (createHash('sha256').update(bytes).digest('hex') !== checksums[platform])
  throw new Error('Scanner checksum mismatch.');
const directory = await mkdtemp(join(tmpdir(), 'rove-gitleaks-'));
const archive = join(directory, asset);
await writeFile(archive, bytes);
execFileSync('tar', ['-xzf', archive, '-C', directory, 'gitleaks']);
if (process.env.GITHUB_PATH) await appendFile(process.env.GITHUB_PATH, directory + '\n');
console.log(join(directory, 'gitleaks'));
