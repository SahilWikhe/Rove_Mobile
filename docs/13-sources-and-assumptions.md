# Sources, assumptions, and validation register

Architecture baseline prepared September 2026. External documentation was checked during preparation; provider features, pricing and limits must be checked again during implementation. Architecture choices are recommendations, not statements that services have been configured.

## Internal product sources

Reviewed material provided in the local Rove research directory:

| Source | Architectural relevance | Limits |
| --- | --- | --- |
| `Rove-Founding-Brief.txt` | Driver subscription hypothesis, scheduled NEMT beachhead, sponsored funding, driver eligibility | Draft v0.1; illustrative economics and unresolved payer/operating questions |
| `Dialysis Transportation Pilot Opportunity_ North Carolina.pdf` | Recurring legs, return delays, cross-county service, early/Saturday coverage | Desk-research leads; not confirmed pilot demand or facility-specific failures |
| `Dialysis Transportation Gaps_ North Carolina Pilot Research Memo.pdf` | Payer/coordinator distinction and corridor-level discovery | Historical reports and unmet-volume assumptions require validation |
| `Rove — RTP Employer-Sponsored Transportation Market Research Memo.pdf` | Sponsored/pooled expansion as a later option | Conditional thesis; not the initial app scope |

The brief and executive summaries were used to establish product context. Raw reports, contact lists and research files are not published here. Geographic priorities differ between memos. No statistics or complaint details from those reports are asserted as newly verified facts in this architecture.

The user's current direction is to plan the actual product in a new monorepo separate from marketing. The user authorized this documentation commit/push. Prior local Neon setup was explicitly requested in the current research folder; that is not evidence that application code or deployment already exists in the new repository.

## Platform references

| Topic | Primary reference | What to verify at implementation |
| --- | --- | --- |
| Expo workspaces | [Monorepos](https://docs.expo.dev/guides/monorepos/) | Compatible package manager, SDK and native dependency versions |
| Expo builds | [Monorepo build setup](https://docs.expo.dev/build-reference/build-with-monorepos/) | Per-app EAS configuration and credentials |
| Location | [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/) | Background permissions, platform termination limits and native build requirements |
| Native auth | [Expo authentication](https://docs.expo.dev/guides/authentication/) | Provider callback/session integration |
| Monorepo tasks | [Turborepo docs](https://turborepo.dev/docs) | Task graph, affected detection, cache inputs and supported commands |
| Hosting | [Vercel monorepos](https://vercel.com/docs/monorepos) | Root directories, independent projects and deployment behavior |
| API runtime | [Hono on Vercel](https://vercel.com/docs/frameworks/backend/hono) | Entrypoint, Node runtime and build adapter |
| Regions | [Vercel regions](https://vercel.com/docs/regions) | Ohio alignment and availability for chosen plan |
| Realtime | [Vercel WebSockets](https://vercel.com/kb/guide/do-vercel-serverless-functions-support-websocket-connections) | Actual runtime support, max duration, reconnect and shared state |
| Durable execution | [Vercel durable execution](https://vercel.com/blog/a-new-programming-model-for-durable-execution) | SDK/runtime compatibility, retries, observability and cost |
| Neon feature discovery | [Official docs index](https://neon.com/docs/llms.txt) | Current auth, branching, region, recovery and plan documentation |
| SQL integration | [Drizzle Neon guide](https://orm.drizzle.team/docs/connect-neon) | Chosen driver's transaction support and pooling |
| Transactions | [Drizzle transactions](https://orm.drizzle.team/docs/transactions) | Isolation, rollback and driver-specific behavior |
| Maps | [Google Maps pricing](https://developers.google.com/maps/billing-and-pricing/pricing) | Billable service, quotas, key restrictions and terms |
| Payments | [Stripe Connect charge models](https://docs.stripe.com/connect/charges) | Fees, disputes, funding flow and responsibility |
| Workflow security | [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use) | Untrusted code, action pinning, permissions and secrets |
| Healthcare data | [HHS cloud guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html) | Applicable relationships and required provider agreements |
| Hosting plan | [Vercel Hobby](https://vercel.com/docs/plans/hobby) | Commercial-use eligibility and required plan |

Some documentation endpoints returned fetch errors during review. Do not infer an unavailable feature from a failed documentation fetch. Likewise, a skill's capabilities list or a search result is not substitute evidence for a passing deployment/device spike.

## Explicit planning assumptions

- Small scheduled NC care-transport pilot, manually dispatched, rather than citywide instant ride-hail.
- One operational tenant boundary initially; no cross-tenant pooled fleet scheduling.
- Rider/caregiver app and separate driver app, both iOS and Android.
- A single transaction-capable backend/database is adequate until measurements show otherwise.
- Authentication provider, encrypted offline store and actual funding contract require acceptance gates.
- Vercel/Neon are the proposed host/database; no AWS account or migration is required by this plan.
- Polling/upload intervals, coverage percentages, recovery targets and latency targets are initial engineering targets to validate.
- No signed contract, production rider dataset, HIPAA status, store approval or paid provider readiness is asserted.

## How to revise the plan

Change the relevant ADR and dependent documents together. Record the evidence, options, chosen direction, migration impact, cost/privacy consequences and acceptance test. Replace hypotheses with confirmed facts only when the founder or recorded operational evidence resolves them. Preserve historical decisions when they explain compatibility constraints.
