# Real staging provider checks

The manually triggered **Staging provider checks** GitHub workflow runs only from `main`, with the `staging` GitHub environment and explicit acceptance of potentially billable Maps requests. It has no scheduled or pull-request trigger and serializes runs.

## Configure the GitHub staging environment

Set secrets `STAGING_GOOGLE_MAPS_API_KEY` (server key restricted to Places API New and Routes API) and `STAGING_STRIPE_SECRET_KEY` (sandbox/test key with account and payment-method-configuration read permissions). Set variables `STAGING_SERVICE_AREA_JSON`, `STAGING_STRIPE_ACCOUNT_ID`, and `STAGING_STRIPE_PAYMENT_METHOD_CONFIGURATION` to the staging deployment's values. Vercel variables are not automatically available to GitHub Actions. Never use native SDK keys or live Stripe credentials here.

Run the workflow from Actions, select `main`, and enable its Maps usage checkbox. Missing or invalid configuration fails; it does not silently switch to mocks. Logs contain check names only, with no provider responses or credentials. No response artifacts are uploaded.

## Coverage and limits

The suite checks the deployed API health endpoint, Auth0 public discovery and RSA signing keys, the expected Stripe sandbox account and active card configuration, and Google search/details/routes using public Raleigh locations. Google performs at most five requests. Stripe requests are read-only. No riders, rides, payment intents, or database rows are created, so the suite needs no financial cleanup.

These checks call real providers but are **not a full mobile end-to-end test**. They do not prove login, deployed authenticated quote handling, driver matching, native PaymentSheet, webhook delivery, capture/refund, or device background behavior. Keep the synthetic E2E suite in normal CI. A future complete staging journey needs dedicated rider/driver accounts, controlled driver eligibility, secure authentication automation, sandbox payment fixtures, and reliable ride/payment cleanup. Do not use a founder's personal account or add password grants to native Auth0 clients merely to automate tests.

Stripe sandbox transactions do not move real money. Google Maps and hosting usage can still be billable after applicable allowances. This workflow is manual to bound frequency, not to promise zero cost.
