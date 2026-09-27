# Oflan input in the shared admin

## Status — 2026-09-27
Implemented, tested, and deployed to the existing Preview branch. The dedicated Oflan test order was accepted by Meta, and live input is enabled for the next Preview deployment. Existing Bom Flan delivery code is unchanged.

The owner revoked both account tokens involved in unauthorized Worker deletion/route recreation; the empty account-token list was verified. The suspicious route remains detached. This does not establish that every account session or user token is secure.

Preview configuration prepared: dedicated D1 `oflan-orders` (`e31644ec-a8d4-4495-9b5f-ec23976edbad`) with migration 0002 applied and OFLAN_DB bound. Dataset 978754933141142 is the existing Feel Special Again Meta pixel associated with oflan.id and ad account 904977853882560. Owner confirmed orders originate in WhatsApp chat followed by transfer; action source is chat. Graph version v25.0, test code TEST40807. Owner saved OFLAN_META_TOKEN as an encrypted secret; its contents were not read. `OFLAN_LIVE_ENABLED` is true in Preview.

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
| OFLAN_LIVE_ENABLED | true after successful test receipt for authorized live use |

## Validation
- `npm test`: 24 tests pass, including brand isolation, persistence failure preventing sends, conflicting duplicate IDs, immutable retry, concurrent lease and expired event handling.
- Pages Functions build succeeds.
- Local browser simulation: OF-TEST-260927-0001 / Rp1 first fails, resend succeeds on attempt 2; one row remains. No customer submissions.
- Preview test order `OF-TEST-260927-0001` used the reserved fictional phone `+12025550100` and Rp1. The dedicated D1 records Meta HTTP 200, `events_received: 1`, no API error, and one delivery attempt. Meta Test Events did not display the row during the observation window, so only API acceptance is verified.
- Dedicated database binding, shared UI login, test mode, history, and retry behavior were verified. Live mode must be visually rechecked after the deployment that picks up the enabled flag; no real customer order should be sent as a deployment test.

## Rollback
Revert only new Oflan route/code and Bom Flan navigation change. Preserve all order data. Existing uncommitted public/index.html changes predate this work and were not included.
