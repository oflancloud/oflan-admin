# Bom Flan Mark Paid

Status: implementation and local tests complete; deployment configuration and Meta end-to-end verification pending. No live Purchase has been sent by this work.

## What changes

The existing Oflan page receives a brand link to `/bom-flan/`. Its API calls and existing Worker are unchanged. Bom Flan uses Cloudflare Pages Functions under `/bom-flan/*` and a dedicated D1 binding `BOMFLAN_DB`. This avoids sharing Oflan's KV history, retry jobs, token, or order counter.

The Bom Flan page provides Order ID, Phone, Value, payment confirmation, PAID, Jakarta History Today, individual resend, and resend all failed orders today. SQL allocates numbers atomically: `BF-YYMMDD-NNNN`; tests use `BF-TEST-YYMMDD-NNNN` with a separate sequence. Gaps are expected if a reserved number is not used.

Orders are persisted before sending. The immutable payload includes `Purchase`, Unix payment time, brand/mode-prefixed `event_id`, `custom_data.order_id`, positive integer IDR value, and SHA-256 normalized phone. Retrying retains the original payload, event time, and dataset. A database lease prevents simultaneous sends; a crash can be recovered after two minutes. Timeout ambiguity is handled by resending the same event ID. Events older than seven days are held for manual review and never silently re-dated. This is not an unlimited exactly-once guarantee from Meta.

Admin IP and user agent are not sent as customer identifiers. The browser cannot choose the dataset or token. Missing configuration stops sends, with no fallback to Oflan. Test mode always includes a server-configured test_event_code; live mode never includes it. Live sending is disabled until explicitly enabled. The UI and API require Basic authentication over HTTPS; unauthorized users cannot read order history. The dedicated credentials must be installed as Cloudflare secrets, not committed. Same-origin JSON POST checks protect against cross-origin form submissions.

## Configuration

Create a dedicated D1 database, run `migrations/0001_bomflan.sql`, and bind it as `BOMFLAN_DB` in the **admin-oflan Pages project**. Set production and preview bindings separately; use a separate database for previews if enabling preview writes. Existing Oflan Worker `winter-haze-7ce5` is not the deployment target.

Set these Pages variables/secrets in the selected environment, then redeploy:

| Name | Value / purpose |
| --- | --- |
| `BOMFLAN_ADMIN_USER` | Dedicated admin login name |
| `BOMFLAN_ADMIN_PASSWORD` | Strong secret, entered by the user in Cloudflare |
| `BOMFLAN_DATASET_ID` | `1626416872401155`, after direct verification in Meta |
| `BOMFLAN_DATASET_VERIFIED` | Same ID, only after verifying ownership/name in Meta |
| `BOMFLAN_META_TOKEN` | Secret authorized to the Bom Flan dataset |
| `BOMFLAN_GRAPH_VERSION` | A currently supported Graph API version verified against the account/docs |
| `BOMFLAN_ACTION_SOURCE` | Explicitly choose `chat` or `business_messaging` based on the actual integration |
| `BOMFLAN_WABA_ID` | Required for business messaging; verified Bom Flan WhatsApp Business Account ID |
| `BOMFLAN_TEST_EVENT_CODE` | Current Bom Flan Events Manager Test Events code |
| `BOMFLAN_LIVE_ENABLED` | Keep `false` until end-to-end verification passes; then `true` for production only |

For WhatsApp ad attribution with `business_messaging`, the form requires the **original** `ctwa_clid` from the WhatsApp referral, plus the server's WABA ID. This implementation does not capture WhatsApp webhooks automatically. Do not invent click IDs or claim that a phone-only manual event optimizes WhatsApp purchases. `chat` is a separate manual-chat reporting path, not an automatic fallback to messaging optimization. Confirm Meta's current accepted payload and eligibility in the connected account before activation. The version `v25.0` in local test fixtures is only a fixture, not a verified production setting.

The dataset/portfolio IDs initially came from the linked prior conversation. At the last access check, the current Meta login could not open portfolio `2154047875176633`. No direct Meta verification has succeeded yet.

## Local verification

```sh
npm ci
npm test
npx wrangler pages functions build --outdir=dist
node tests/preview.mjs
```

Open `http://127.0.0.1:8789/bom-flan/` for an explicitly labeled in-memory simulation. It never calls Meta or Oflan. Value Rp1 simulates an initial timeout; resend then succeeds. Nothing in this simulation proves delivery to Meta.

Unit tests use actual SQLite through a D1-shaped adapter and mocked HTTP, covering authentication, cross-origin rejection, payment confirmation, validation, conflicting duplicate orders, target dataset, persistent retries, concurrency leases, aged events, WhatsApp payload fields, and separate live/test histories and sequences. The Pages Functions build validates bundling. Browser QA verified form submission, FAILED history, then SUCCESS on resend with the same order and attempt count 2.

## Deployment and Meta verification

1. Deploy the branch as a Pages preview. Confirm `/` still renders Oflan and `/bom-flan/` fails closed until credentials are set. Do not put real tokens or customer records in a public preview.
2. Verify Bom Flan Dataset name and ID in Meta, obtain its authorized token through a secure setup, and open its Test Events tab. Record the code as a server secret.
3. Configure a protected test environment and choose the action source based on the real WhatsApp setup. For business messaging, use a real test referral, not a fabricated ctwa_clid.
4. Submit a designated test order. Confirm API response and the same Purchase event ID in **Bom Flan** Test Events. Capture timestamp, dataset ID and event ID, but never tokens or raw personal data.
5. Check Oflan Events Manager for no matching Bom Flan event. Test a retry using the identical ID/payload and check deduplication. Confirm history counts and mode separation.
6. Once verified, deploy to production and enable live mode. Only paid customer orders may be recorded as live. A synthetic test must never be used as a production purchase.

## Rollback

Keep `BOMFLAN_LIVE_ENABLED=false` to stop new sends. Roll Pages back to its prior deployment (`eaac8b2b-15cb-4bf5-a68f-d4f46068690f`, commit `fbff16058ba781a335cd2b41986864015d45f5ea`, as observed before changes) if necessary. Retain the D1 database and records; do not delete history or resend with new IDs. Oflan's independent Worker and KV require no rollback for this change.
