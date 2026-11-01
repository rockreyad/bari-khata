# Live contact statements

A contact's **হিসাবের কপি পাঠাই** sheet now supports a live link as well as the downloadable static copy. The owner creates a link for the selected person, account and optional work. New entries appear when the owner's local changes have synced; the recipient refreshes the same saved link. Viewing requires internet. The local development URL can only be reached on a device that can reach that development server; production hosting and a hosted backend remain separate work.

A link is a read-only capability. Anyone holding it can read that one statement, so the sheet explains the scope before creation. No login is needed to view it. The owner can stop sharing at any time. Replacing a link revokes its predecessor for the same person/account/work; independently scoped links remain active. Links have no automatic expiry so a saved link keeps working until revoked. Raw tokens are shown only when created; reopening the sheet offers revocation or replacement.

## Data boundary

`contact_share_links` has RLS enabled and no direct table privileges for anonymous or authenticated clients. Owner RPCs use `auth.uid()` and check that the contact and optional work exist in that owner's synced document. Tokens use 32 cryptographically random bytes and only their SHA-256 hashes are stored in the database. The URL carries the token in its fragment, avoiding normal server URL and referrer logs.

`read_contact_share` looks up the hash and returns a server-built allowlist: contact name/role, project/work names for the selected scope, totals and bounded transaction rows. It never returns the ledger document, other contacts, phone fields, receipts, source imports, notes, audit revisions or authentication details. Historical expenses retain their known cost while remaining excluded from inferred payables and advances. Driver statements follow the same legacy transport scoping rules as the private contact page.

All security-definer functions set an empty search path and explicitly qualify tables. Only the public projection RPC is executable anonymously. The public page uses a separate anonymous Supabase client without persisted sessions, omits credentials and disables fetch caching. It never mounts the private notebook. Hash navigation clears the previous statement and invalidates its pending request before fetching a new token.

## Pagination and updates

Public reads return 40 rows by default and reject limits above 60. Further pages include the ledger revision from the initial read; a changed revision asks the recipient to refresh instead of mixing different snapshots. Refresh replaces old rows. A revoked link clears a previously displayed statement on its next read. The owner document is still the existing JSON snapshot; public pagination bounds response data and rendering while the SQL query scans the selected owner's document.

## Verification

- `./node_modules/.bin/tsx scripts/backend-share-check.ts` creates two disposable accounts, tests anonymous access and denial of owner-only functions, exact scopes, owner isolation, direct table denial, hashed token storage, absence of private fields, historical totals, transport parity, live changes, bounded revision-aware pagination, rotation and revocation. It deletes the disposable accounts afterward.
- `npm test -- src/features/sharing` checks the UI's sync prerequisite, scoped creation/revocation, requested pagination, refresh replacement, changed-revision feedback, hash navigation and malformed response rejection.
- `scripts/qa-share-fixture.ts create|append|revoke|cleanup` supports browser verification with a clearly labelled disposable account. Its capability/session file lives only in ignored `private/qa-share.json` with mode 600. Never bundle or publish that file.

Security references: [Supabase database functions](https://supabase.com/docs/guides/database/functions), [row level security](https://supabase.com/docs/guides/database/postgres/row-level-security), and [securing the API](https://supabase.com/docs/guides/api/securing-your-api).
