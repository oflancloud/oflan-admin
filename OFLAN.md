# Oflan input in the shared admin

## Status — 2026-09-27
Implemented and tested locally, not activated or deployed. Existing Bom Flan delivery code is unchanged; its Oflan navigation link now points to `/oflan/`.

Activation is blocked by an observed Cloudflare account incident: original Worker `winter-haze-7ce5` is missing, and the previously detached `cf-w-bffea70a` wildcard route returned. Owner confirms no authorized changes. The wildcard route was detached again. Account access must be reviewed before installing any new Meta credential.

## Behavior
- Same visual workflow and existing household admin login as Bom Flan.
- Separate `/oflan/*` Pages Functions, `OFLAN_DB` binding and `of_orders` / `of_sequences` tables.
- Apply `migrations/0002_oflan.sql` to a dedicated Oflan D1 database, not the Bom Flan database.
- New IDs `OF-YYMMDD-NNNN` (live) and `OF-TEST-YYMMDD-NNNN` (test). Legacy numeric IDs are rejected; old orders need reconciliation before re-entry under new IDs.
- Persist payment before Meta delivery. Retrying preserves payload, event time, event ID, dataset and order; a lease blocks simultaneous delivery. This does not deduplicate separate order IDs for the same payment.
- Configured Oflan dataset must be numeric and match explicit verification; Bom Flan dataset 1626416872401155 is refused. No Bom Flan token/database fallback.
- History loads on open and explicit refresh, without periodic polling. Existing KV history is not imported automatically.
- UI uses same-origin requests, not api.oflan.id.

## Required Pages environment configuration
Configure the environment actually serving the chosen URL. The existing branch URL uses Preview; admin.oflan.id uses Production. Do not redirect the latter until live verification succeeds.

| Binding / variable | Requirement |
| --- | --- |
| OFLAN_DB | Dedicated D1 with migration 0002 applied |
| BOMFLAN_ADMIN_USER / BOMFLAN_ADMIN_PASSWORD | Existing shared household admin login; never commit secrets |
| OFLAN_DATASET_ID | Verified Oflan dataset (not known from current available configuration) |
| OFLAN_DATASET_VERIFIED | Same verified ID |
| OFLAN_META_TOKEN | Secret authorized only for intended Oflan delivery |
| OFLAN_GRAPH_VERSION | Supported Graph version, verified when configuring |
| OFLAN_ACTION_SOURCE | Actual source: chat, business_messaging, or system_generated; do not guess |
| OFLAN_WABA_ID | Required with business_messaging and actual ctwa_clid |
| OFLAN_TEST_EVENT_CODE | Current Oflan test code |
| OFLAN_LIVE_ENABLED | false until test receipt verified, then true for authorized live use |

## Validation
- `npm test`: 24 tests pass, including brand isolation, persistence failure preventing sends, conflicting duplicate IDs, immutable retry, concurrent lease and expired event handling.
- Pages Functions build succeeds.
- Local browser simulation: OF-TEST-260927-0001 / Rp1 first fails, resend succeeds on attempt 2; one row remains. No external Meta requests or customer submissions.
- Production Meta receipt, database binding, UI login and live input remain unverified.

## Rollback
Revert only new Oflan route/code and Bom Flan navigation change. Preserve all order data. Existing uncommitted public/index.html changes predate this work and were not included.
