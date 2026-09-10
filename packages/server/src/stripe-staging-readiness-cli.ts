import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import Stripe from 'stripe';
import { inspectStripeStaging } from './stripe-staging-readiness';

const filename = process.argv[2];
if (!filename || process.argv.length !== 3) {
  console.error('Usage: pnpm payments:staging:check /path/to/ignored-staging.env');
  process.exitCode = 1;
} else {
  try {
    const result = await inspectStripeStaging(parseEnv(readFileSync(filename, 'utf8')), (key) => {
      const stripe = new Stripe(key, {
        apiVersion: '2026-08-26.dahlia',
        timeout: 10_000,
        maxNetworkRetries: 1,
      });
      return {
        account: () => stripe.accounts.retrieve(null),
        configuration: (id) => stripe.paymentMethodConfigurations.retrieve(id),
      };
    });
    console.log(
      `Verified sandbox account ${result.accountId}, active payment configuration ${result.configurationId}, and card availability.`,
    );
    console.log(
      'Read-only check. PaymentSheet, authorizations, captures, refunds and webhook delivery still need end-to-end verification.',
    );
  } catch {
    console.error(
      'Stripe staging check failed. Provide staging, a test key, STRIPE_ACCOUNT_ID and STRIPE_PAYMENT_METHOD_CONFIGURATION in the explicit file; verify read permissions and active card configuration.',
    );
    process.exitCode = 1;
  }
}
