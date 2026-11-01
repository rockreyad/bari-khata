# বাড়ির খাতা

A Bengali-first construction ledger for personal use, built as an iPhone-friendly, local-first PWA. Record materials, labour, transport, unloading, worker purchases, instalments, shop credit, returns and refunds. Work notebooks are optional at entry time. Material groups, brands and uses let reports answer questions across different works.

Users can create their own email/password account at `/register`, confirm their email and sign in. `/sample` opens an independent example notebook. Each account has its own physical IndexedDB database, drafts, vouchers, outbox and recovery copies. Supabase protects cloud documents and private vouchers with owner-only RLS.

## Run locally

Requires Node 22.12+, npm and Docker for local Supabase.

```sh
npm ci
npm run db:start
npx supabase migration up --local
node scripts/backend-check.mjs
npm run dev
```

Open `http://localhost:5180/login`. The existing local owner credentials are in `private/LOCAL_ACCESS.txt`, with filesystem permissions `0600`. They are ignored by Git and blocked by the development server. Do not copy credentials into chat, frontend code or public files.

```sh
npm test
npm run build
npm run preview
```

A development-only 390px phone frame is available at `http://localhost:5180/phone-preview.html`; it is excluded from the production build.

Production preview uses `http://localhost:4180`. Service workers run in the production build. `/sample/settings` lets visitors explore appearance settings without access to private records.

Only public Supabase URL and anon/publishable key may use the `VITE_` prefix. The local phone gateway also reads private `BARI_` settings from ignored `.env.local`; those server-only values must never be exposed with a `VITE_` prefix. Administrative helpers retain private values without printing them, and the production bundle audit checks they are absent.

## Historical import

The supplied Personal Wallet exports have been migrated into the local owner's authenticated notebook: 326 historical entries. The server read-back was validated against a canonical SHA-256 checksum. Original source documents, normalized ledger and reconciliation reports stay under ignored `private/migration/`; they are not bundled with the app.

Imported rows retain source file, sheet, cell and checksum. Unknown dates stay unknown. Historical cost does not invent payments, outstanding dues or advances. Imported entries remain marked for review in `/review`, including uncertain work/material classifications. The original anonymous IndexedDB database is preserved and is never automatically attached to a new account.

The local provisioning/import helper is repeatable:

```sh
node --import tsx scripts/backend-bootstrap-owner.ts private/migration/ledger.json
```

It reuses the privately saved account, refuses to overwrite a different notebook and verifies authenticated read-back and disposable-friend isolation. Its guarded `--refresh-import` option is limited to an unchanged previously verified import with exactly the same source row IDs/checksums.

## Create another account

Open `/register`, enter an email and a password of at least eight characters, then confirm the email using the link sent to that address. The confirmation screen never signs another person into an already open notebook; sign in explicitly after confirmation. Each new account starts with its own empty notebook and isolated device database.

The local Docker setup captures confirmation mail at `http://127.0.0.1:55434`. This mailbox is for local testing; it does not deliver messages to Gmail or another external inbox. A production deployment needs hosted Supabase Auth, its confirmation template/allowed frontend callback URLs and a configured mail sender.

The existing `node scripts/backend-create-user.mjs friend@example.com` helper remains available for disposable local administration. It targets only port55431 and prompts for the password without a shell argument. Normal users register in the app.

The local stack uses ports55431–55434. Loopback URLs work on this Mac. Phone testing needs a reachable HTTPS frontend and backend; the local Docker stack stays private.

## Accounting and recovery

- Money is integer poisha. Zod validates stored data, backups and references.
- Costs and cash movements stay separate. Credit purchases do not imply payment.
- A worker's ৳1,500 purchase followed by a ৳1,700 reimbursement leaves ৳200 advance without increasing cost.
- Labour agreements, earned bills and payments are separate. An agreement is optional and only applies to labour.
- Material returns reduce cost and supplier balance; actual cash refunds are logged separately.
- Ledger changes and voucher bytes commit atomically. Drafts persist on the device.
- Backup JSON includes ledger and vouchers. Restore previews the file and keeps a recovery copy. CSV is a report, not a full backup.
- Cloud sync uses optimistic revisions and frozen retry IDs. Conflicts require a choice. Async work remains bound to its original account when another account signs in.
- Previously authenticated users can continue offline after records have downloaded. Explicit logout immediately removes app access, including offline access, while retaining the account's stored data for a future login.

## Production later

No hosted Supabase database, production account or deployment has been created. Production preparation must enable email signup with confirmation, configure SMTP and the confirmation template, allow only the deployed callback URLs, keep the Auth rate limits enabled, apply the migrations/RLS/private bucket policies and use only public frontend keys. Recheck owner/friend/anonymous access against the hosted project before use.

Email/password registration and Bangladesh phone login work in the local test app. Phone login currently uses the server-configured test code, with `BARI_PHONE_AUTH_MODE=mock` and `BARI_DEV_PHONE_OTP=1318` in private `.env.local`. Change the code and restart the dev/preview server; keep its generated private HMAC key stable. The code is checked by the local server and normal Supabase sessions protect each phone's own notebook. Different email/phone accounts are not automatically merged.

Use `node scripts/configure-phone-auth.mjs mock|sms|off` to choose the mode. Switching mode requires a frontend rebuild and a server restart. The mock gateway runs only against the loopback Docker backend and accepts only local same-origin requests. `sms` uses the native Supabase OTP flow after a real provider is configured; no actual SMS delivery is activated now. See [phone configuration](docs/PHONE-OTP.md) and [Supabase phone login](https://supabase.com/docs/guides/auth/phone-login).

Before replacing the spreadsheet workflow, review imported entries, rehearse backup restore and test a real iPhone's HTTPS Home Screen installation, offline cold launch, camera, keyboard and app updates with a draft. The desktop browser preview cannot establish those physical-device behaviours.

## Current interaction model

History is the primary browsing flow. Material, labour, transport/unloading and other reports are separate; materials are the default. Only expense and payment are primary quick actions. Returns belong in a shop's menu. Contact and work shortcut presets are optional and show no irrelevant counters.

Money inputs contain a four-operation calculator. Selects, editable material suggestions, action menus and Bengali date pickers use custom accessible controls. Small-screen date/calculator popups stay centred inside the viewport.

Transaction details link directly to the person/store and work, and show a collapsed change history only after an edit. Lists include a compact date and year. Complete contact history opens its own filtered, 30-row page instead of expanding the profile. Work start/end dates and changes have a separate activity timeline. Older clients and backup restores cannot truncate existing work history. App updates are offered after financial forms close, preserving their drafts.

A person can receive a scoped read-only statement through the profile's copy/share action. The HTML copy is a printable snapshot. The live link shows only that contact and selected account/work, with fresh records after a refresh. Links use random server-hashed tokens and can be revoked or replaced. No owner credentials, vouchers, private notes, provenance or other contacts are included. See [live sharing](docs/LIVE-SHARING.md).

The dashboard shows total recorded cost, with materials and wages separate and transport/unloading secondary. Work context pre-fills a uniquely identified material group and unit; worker/shop context carries its account and an unambiguous work/contract. New workers may have an optional fixed wage contract. Custom payment-purpose labels remain attached to a stable materials/labour/other account. Pending historical classifications can be reviewed in batches without changing money, dates or original provenance.

History rendering is paged at 30 rows. The local-first owner sync still transfers a versioned whole-workspace JSON snapshot; this is not server-paged owner storage. Public contact statements are projected and paged on the server. Large multi-year production workspaces need normalized/indexed transaction storage before claiming bounded sync transfer size.

See docs/UX-REFERENCES.md and docs/VERIFICATION.md for references and checks.
