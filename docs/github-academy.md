# GitHub-only academy operations

## What runs where

- `main`: static Vite/React frontend, simulation, rules, verification code and public signing key.
- GitHub Pages: all application HTML/CSS/JavaScript/robot models. No API routes, account server, runtime AI or ChatGPT authentication.
- Browser IndexedDB: private-to-device practice/history and in-progress certification. Backups move this state between devices; there is no automatic private cloud sync.
- Public issues: explicit, consented identity/profile and certification submissions. No tokens/passwords/emails are requested. All submitted evidence remains public.
- Standard GitHub Actions runner: bounded asynchronous validation and publication, not a persistent login server.
- `academy-data`: public signed receipts, processing ledger, account records and 16 directory shards.

This is an experimental **mock/training certification workflow** for a shared learning programme, not an official appointment or proctored exam. GitHub's permitted-use restrictions apply; user authorization does not waive GitHub's terms. Obtain GitHub confirmation before operating a large production credential service on Actions. Do not enable larger paid runners or assume quotas/terms remain unchanged.

## One-time setup

1. Use a public repository with Pages configured for GitHub Actions, Issues enabled, and workflows permitted.
2. Owner runs `node scripts/provision-academy.mjs --provision`. It generates an ECDSA P-256 key in memory and sends the private JWK to `gh secret set ACADEMY_SIGNING_KEY` through stdin. It prints only the public JWK. Save that public JWK in `lib/github/public-key.json`. The script refuses to replace an existing secret.
3. Owner runs `node scripts/bootstrap-academy-branch.mjs --bootstrap` to create the independent `academy-data` branch without changing `main`.
4. Push reviewed source/public key to `main`. Run **Publish mock academy requests** once to create the empty signed directory. No dummy certificates are needed.
5. Open the Pages academy, create a local profile, and connect via a real GitHub issue. Check the signed receipt. The referee number is `RCJ-GH-<immutable numeric GitHub account ID>`.

Never place the signing private key in source, a Pages artifact, a backup, a logged command or a Git remote. Only the private JWK is secret; the public key is intentionally public. Provisioning and testing do not purchase hosting or create paid runners.

## Submission and verification

The browser prepares one `RCJ-ACADEMY-V1:` gzip/base64url packet. Replay transport uses lossless tick deltas and implicit sequence indices to keep normal 13-attempt rounds within an issue. Large packets are copied into an issue instead of encoded into a potentially overlong URL. The app limits compressed input to 60,000 characters and expansion to 8 MiB. Exceptional oversized recordings are rejected visibly; export a backup rather than lose them.

Actions re-fetches the issue and takes identity only from GitHub's issue-author fields. The content is strictly data. A bounded child process has no GitHub token/signing key, a 256 MiB JavaScript heap and a 120-second timeout. It loads only trusted repository code, checks the schema, canonical first-observed answer prefixes, 105-question coverage (at least 100 first-try correct), 5/8 Step and 2/5 Continuous thresholds, unique attempts and assigned seeds, and replays fixed-120-Hz decisions for each game. It recomputes the scores; posted counters do not establish certification. Dynamic case answers are graded against their exact model, seed and decision trace, not a separate static answer key. Model changes inside game evidence are rejected. Qualification compares unrounded accuracy.

Failed validation produces a signed rejection. Resource/time failures leave the issue queued to retry. Successful certification produces a signed receipt and an optional directory entry. Modifying an unsigned table, browser score, backup or public record without a matching signature cannot add an accepted public certificate. Public profile updates can change directory alias/country/opt-in but do not rewrite the original certificate.

### Limits of that assurance

GitHub authenticates the issue author, not a legal identity or the person currently using a device. The local profile/connection is not a private authentication session. Browser evidence is unproctored: a determined programmer can generate a valid trace using the public engine, alter first-answer history or reset local attempts. Deterministic replay verifies internal consistency, not human participation or honest elapsed wall time. Unlimited whole-round retries are intended. Repository administrators who can change verifier code, workflows or public keys are trusted issuers. Use branch protections, limited collaborators and account 2FA appropriate to the committee.

Because issued records and identity receipts are public, someone can copy a receipt to display another person's already-issued credential locally. That does not change its GitHub subject or the public registry. The public directory and originating issue are the verification reference, not a screenshot of a local profile. There is no strong revocation or old-key rotation UI in this mockup; see recovery below.

## Queue, recovery and upkeep

The publisher runs on issue creation, manual dispatch and a 15-minute reconciliation schedule. A single writer reconciles durable open issues; superseding a pending workflow does not delete its submissions. Each run handles up to 50 issues with a rotating bounded scan, a six-minute processing budget and a bounded acknowledgment phase. It commits signed records before commenting/closing issues. Per-issue ledgers and request/round deduplication make retries idempotent.

- **Pending result:** ensure the issue was actually submitted, inspect the latest workflow, and retry/check later. GitHub's CDN can temporarily serve an older manifest/shard; the UI rejects mismatched hashes and asks to retry.
- **Workflow failed:** fix the cause and manually dispatch. Do not manually write unsigned accepted rows. Open issues remain the queue; existing receipts are reused after a crash.
- **Signing key missing/mismatched:** fail closed. Do not replace the public key just to make existing rows display. Restore the matching secret through the repository owner or plan a reviewed migration that revalidates/re-signs records and updates trust anchors together.
- **Incorrect/revoked credential:** a maintainer needs a reviewed signed-record maintenance change. Simply editing JSON is intentionally rejected. Public Git history and issue history cannot be erased by an opt-out checkbox.
- **Profile privacy:** make a new connect submission with listing off to remove the current public directory row. Existing public issues, receipts and Git history remain public. Do not submit sensitive personal data, particularly children's details.
- **Inactivity:** GitHub can disable scheduled workflows after repository inactivity. New issue events/manual dispatch are separate triggers; check Actions is enabled before competitions.
- **Interrupted game:** use Resume attempt in Academy. Fixed-tick checkpoints are saved locally every few seconds and after decisions; they preserve the attempt slot, model and event prefix. Completed Continuous recordings open as read-only timeline/replays; Step recordings open an assessment summary. A storage error exposes retry controls; back up progress before clearing data. Checkpoints are not cross-device cloud sync, and the last unsaved seconds can be lost in an abrupt shutdown. Backups currently have a 16 MiB import limit; history is not unlimited archival storage.
- **Rule/engine changes:** update policy/version identifiers and tests together. The current assessment uses `rcj-soccer-2026-v3` / `referee-match-2026-v3` (goal contact, penalty stripe and neutral kickoff scoring corrections). Unfinished v1/v2 rounds are read-only and must be explicitly restarted to submit under the corrected assessment. Old pending certification submissions cannot be newly approved under v3; ask those participants to take the updated round. Already signed receipts stay valid, and older evidence/history, including interrupted-game checkpoints, stays in backups and restart archives. Old-engine recordings are not executed as current-engine reviews. This is not a forever-compatible archival verifier.

The old hosted app/database were not deleted or migrated into public GitHub records. Private legacy records require a deliberate consented migration; they are not silently exposed here. Use the GitHub Pages URL going forward.

## Capacity and cost evidence

The synthetic 10,000-record test uses temporary keys and files only. On the development Windows machine, compact directory publication took about 5.5 seconds, a profile update about 5.8 seconds, and the signed directory was 4.23 MB. An update rewrote three files (~268 KB), not the full registry. These are local measurements, not a GitHub throughput guarantee or a 10,000-concurrent-user load test.

The full-round transport test exercised all 13 game slots (eight Step and five Continuous recordings): the complete evidence used about 29.5 KB of issue text after lossless packing/compression, below GitHub's 65,536-byte issue-body limit. The seven-game qualifying round used about 17.8 KB. This is measured test evidence, not a guarantee for arbitrary 4,096-action recordings.

The browser downloads/caches 16 signed static shards plus their manifest, searches locally, and renders 25 rows per page. It does not issue one authenticated API request per referee. Issuer updates still scan the signed account records. Simulation runs on participants' devices.

Public Pages and standard public-repository Actions compute can avoid a hosting subscription, subject to GitHub's terms and quotas. Pages has a 100 GB/month soft bandwidth allowance; current robot models and repeat visits matter more than the number of directory rows. Standard Free Actions has 20 concurrent hosted jobs, and this publisher intentionally serializes writes. `GITHUB_TOKEN` and content-creation rate limits still apply. The queue is eventual, not instant. No guarantee of permanent $0 cost or zero maintenance is made.

Primary references checked 2026-09-06:

- [GitHub Actions terms](https://docs.github.com/en/site-policy/github-terms/github-terms-for-additional-products-and-features#actions)
- [Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Actions limits](https://docs.github.com/en/actions/reference/limits)
- [REST API limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

## Tests

`pnpm test:github` covers actual React-rendered account states, rule-first-answer latching, restart/import boundaries, signature forgery, gzip/size attacks, issue-author identity, collision/idempotency, full 600-second replays, the full certificate packet round trip and a temporary 10,000-record directory. The existing simulator/rule/translation suites remain applicable.

Do not publish synthetic passing fixtures to the live registry. A live integration test may connect the owner's real GitHub identity without certifying it; successful fixture certificates stay under temporary test signing keys.
