import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { StripeDriverTransfers } from './stripe-driver-transfers';
import { inspectTransferStaging } from './transfer-staging-readiness';

try {
  if (process.argv.length !== 4) throw new Error('Arguments required');
  await inspectTransferStaging(
    parseEnv(readFileSync(process.argv[2]!, 'utf8')),
    JSON.parse(readFileSync(process.argv[3]!, 'utf8')),
    (config) => {
      const provider = new StripeDriverTransfers(config, {
        status: async () => {
          throw new Error('Transfer creation is not part of this check');
        },
      });
      return { retrieve: provider.retrieve.bind(provider), find: provider.find.bind(provider) };
    },
  );
  console.log('Sandbox transfer retrieval, recovery identity and expected reversal state verified.');
  console.log(
    'Read-only provider evidence; this does not verify authorization, worker delivery or a bank deposit.',
  );
} catch {
  console.error(
    'Transfer check failed. Usage: pnpm payments:transfer:check /path/to/ignored-staging.env /path/to/approved-sandbox-transfer.json',
  );
  process.exitCode = 1;
}
