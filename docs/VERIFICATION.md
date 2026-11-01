# Verification record

Checked on 1 November 2026, Asia/Dhaka. The v2 migration and security checks are recorded below. Older v1 browser examples use isolated sample data.

## Automated checks

- TypeScript compilation and production build pass.
- 29 tests pass (16 domain, 11 data and 2 report tests).
- Dependency audit reports zero known vulnerabilities after removing unused build dependencies.
- Tests cover integer-poisha totals, contracts versus earned bills, payment allocation, material/wage separation, unnamed suppliers, refunds, safe edits, corrupt input, concurrent local mutations, draft voucher bytes, complete backup restore and sync retry/conflict behavior.

A final review also found and fixed work-filtered CSV exports counting an entire shared transaction instead of its selected work allocation. The report tests cover both scoped and whole-house exports.

## Actual local backend

The isolated Supabase Docker stack is running with four migrations applied. `node scripts/backend-check.mjs` verifies:

- Email/password sign-in works; public signup is disabled.
- Two users cannot read each other's ledger or private vouchers.
- A request retried with the same ID does not increment the revision twice.
- A stale revision returns a conflict without overwriting the current document.
- Invalid amounts, invalid document relationships and invalid contract/settlement links reject without changing data.
- Private receipt access and wrong-owner upload restrictions work.

Disposable test accounts and files are removed by the check script.

## Browser checks

Using the production build in the desktop in-app browser:

1. Added a new sample worker and a ৳1,500 worker-funded purchase. Cost increased by ৳1,500, payments stayed unchanged and the worker became payable ৳1,500.
2. Paid that worker ৳1,700. His screen showed cost ৳1,500, paid ৳1,700, payable zero and credit ৳200. Screenshot: `screenshots/reimbursement.png`.
3. Stopped the frontend server, then reloaded the app. The service-worker-cached app loaded and the saved purchase/payment remained visible.
4. With the frontend server still stopped, opened the tiles notebook and adhesive drilldown. It showed only matching purchase entries, including the new ৳1,500 test voucher; payment entries were excluded.
5. Reviewed the 390px phone layout in a preview frame. This verifies responsive layout, not a physical iPhone's Safari, keyboard or camera behavior.

## Before production use

Real iPhone HTTPS/Home Screen installation, airplane-mode cold launch, actual camera uploads, mobile keyboard behavior and an app update with a draft still require physical-device checks. A hosted Supabase account and deployment are intentionally deferred until the user is ready for real use. The local Docker stack is development-only.

The requested historical import is complete; unknown dates, mixed contractor records and the summary/detail reconciliation remain explicitly visible for user review.

## Version 2 verification — current implementation

The sections above record the earlier version. Their statements that the personal exports were not imported, the notebook starts empty and there are four migrations are superseded by this section.

- The actual private import now contains 326 historical entries; the exact reconciled totals stay in the private verification artifacts. Imported cost does not fabricate cash paid, dues or advances; all imported entries remain reviewable.
- A newly provisioned local owner received the validated ledger through the authenticated snapshot RPC. Authenticated read-back matched the canonical SHA-256 checksum after the final conservative classification refresh. The refresh guard requires an unchanged previously verified server document and identical original source row IDs/checksums.
- Six additive database migrations are applied. Taxonomy/provenance checks reject missing material references, invalid reference types, invalid historical/review states and malformed source metadata.
- Email/password authentication succeeds; anonymous snapshot requests and public signup requests reject. Disposable friend accounts see an empty own notebook, cannot select the owner's document and cannot read or upload into the owner's private receipt folder. Disposable users/vouchers are removed.
- Account switching uses separate physical IndexedDB databases. Tests cover records, voucher bytes, drafts, outbox, backups, recovery copies, captured operations after account switching and cancellation of a pending export/voucher result after access changes.
- Explicit logout clears remembered access synchronously, persists a logout lock and prevents late SDK session refreshes from reopening the account. Offline use is available only for a previously remembered account that has not logged out.
- The current full suite passed 66 tests at the security audit checkpoint; later feature checks may add tests. Authentication/data-specific tests passed 29 tests without unhandled rejections.
- Development HTTP checks on port 5180 returned 200 for `/login` and source modules, and 403 for `/private/migration/ledger.json`, `/private/LOCAL_ACCESS.txt`, arbitrary `/private/*` paths and the equivalent project-private `/@fs/` paths. Absolute `/private/tmp/.../src/` paths remain usable by Vite.
- The app has URL routes and an account-gated real notebook; `/sample` uses a separate database. Local preview is port 4180. Root browser verification and the final production bundle exclusion check are recorded separately.

This verifies the local test stack. A hosted production Supabase project has not been provisioned or audited. SMS OTP remains disabled and no actual SMS-delivery test is claimed.

## Final version 2 checks

- Final project: `~/workspace/bari-khata`. All 76 tests in 13 files passed; TypeScript and the production build pass. Dependency installation audit reported zero known vulnerabilities.
- Quick-entry tests include anonymous paid purchases, worker reimbursement, shop credit and returns, independent refunds, future material groups, invalid amounts/dates and preserving a failed draft with its voucher. A cash settlement/refund requires a work so it cannot silently settle into an unrelated general notebook.
- In the browser, a two-field sample purchase was entered using Bengali digits, closed, restored and saved. Cost and payments increased exactly once; existing due and credit remained unchanged. The real owner's imported records were not changed by this test.
- The owner account displayed all migrated records. A cement notebook opened at its own `/works/...` URL, survived a refresh with the frontend server stopped, and browser Back returned to the cached overview with its records intact. This tests cached frontend delivery; it does not claim a physical iPhone airplane-mode test.
- The app update prompt was applied and retained the owner records. A 390px phone preview showed horizontal swiping beyond the first two notebooks, the new bottom drawer, independent refund work/account controls, the cross-work steel report, and four palettes with dark mode.
- Every one of the 39 production/offline assets returned successfully, including lazy route chunks, Bengali fonts and the bundled bKash identifying icon. The development phone frame is excluded from production.
- Final production output scan found no private owner credential, imported row ID/checksum, private migration file or service-role key. Private files remain Git-ignored; credentials and ledgers have permission0600.

Physical iPhone Safari/Home Screen installation, camera/keyboard behavior, full loss-of-connectivity cold launch and hosted production auth/SMS remain future device/deployment checks. No production service has been provisioned.

## UI and history revision

- Custom select, date, menu, material combobox and money-calculator controls replace visible browser defaults. Calculator uses exact rational arithmetic, with one final integer-poisha rounding; zero division, negative results and unsafe totals reject.
- The full suite passes149tests in23files, covering keyboard/focus, small-screen nested dialogs, free text and Bengali composition, separate shop/worker/driver workflows, two suppliers for doors, anonymous van fees, independent wage/material accounts, scoped report math, legacy records and full audit history. Final counts may increase as regressions are added.
- Local additive migration007 is applied. Standard backend checks and backend-v3-check passed using disposable users only. Old-client missing work history, history mutation/truncation, invalid dates/presets and destructive backup rollback reject without changing the owner's data.
- In a390px phone frame, the plus menu shows expense/payment first. The new work form displays20icons in a grid and10colours with large touch targets. Bengali calendar/month/year menus remain within the viewport; Escape preserves the work form. The calculator evaluated `(500+250-150)*2/3` as400and applied400to the amount field without saving a transaction.
- In the isolated sample notebook, a work was created, changed from planned to ongoing to complete, and given start/end dates through the calendar. All3activity events remained visible with their actual Asia/Dhaka timestamps and old/new values. No start/completion date was inferred for old owner records.
- Report browser checks confirmed materials default, independent labour/transport tabs, custom filter/calendar menus and chronology. Two sample amount/note edits retained1500→1600→1700and all snapshots. A fresh paid purchase displayed one compact row; its linked cash record remained accessible in details. Bank/voided payments remain visible in audit but excluded from active paid totals.
- People browser checks confirmed minimal rows, worker-only relevant actions, last5records and complete oldest-first history. A downloaded worker statement was inspected: selected wages only, with no other people, owner credentials or import identifiers. Driver legacy unlinked cash is included only for an unambiguous transport-only settlement bucket.

All added sample transactions and activities were kept in isolated sample workspaces. The actual owner ledger was not reseeded or rewritten. Physical-device Safari keyboard/camera/Home Screen checks remain separate from these responsive-browser checks.

Final target checks:149/149tests passed in23files, production build passed, dependency audit reportedzero known vulnerabilities, and34/34offline assets loaded. Private file URLs returned403. The final production PWA update was applied in the browser and retained the authenticated owner records. The neighbouring emochi-web checkout stayed unchanged.

## Current refinement — 1 November 2026

- All 176 tests in 34 files pass, including context defaults, custom payment purposes, optional fixed worker contracts, backup field-loss guards, account-aware detail navigation, bulk historical review and paged history. TypeScript and production build pass. Production dependency audit reports zero known vulnerabilities.
- Migrations008 and009 are applied locally and recorded in migration history. Standard backend, work-history, payment-purpose and live-share checks all pass using disposable accounts; no owner records are reseeded.
- Public share browser QA opened a disposable worker statement without signing in, then refreshed the same saved link after another payment. Paid changed৳30,000→৳40,000 and payable৳95,400→৳85,400. Revoking the link and refreshing removed its previously visible statement. The disposable account and token file were removed after verification.
- Sand shortcut choices survived save/reload; configured expense/transport actions appeared without payment, and an intentional empty selection stayed empty. A minimum-entry sample expense was saved and reopened. Cement context tests verify work/material/unit defaults with only amount and bags entered and no guessed brand.
- Bulk browser QA selected30 of65 synthetic pending rows and applied a work classification. Pending fell65→35; total historical cost remained৳85,800. Thirty-row history pages kept their URL page/filter state and showed compact dates with years. Work notebooks show only the10most recent cost rows, with the complete total unchanged and a dedicated full-history link.
- A legacy material payment's person link now preserves its material account. The receiving profile shows the relevant payment/advance instead of defaulting to an empty wage account. Changes appear only after a transaction has revisions and start collapsed.
- Global drawer overflow uses `clip`; the inner content alone scrolls. At440×956, focusing lower fields left outer scrollTop0, header at top and footer at the viewport bottom. Both long bulk review and ordinary expense form were checked. Responsive390px dashboard/calculator and desktop dark palette were visually checked.
- The main JavaScript chunk is approximately848KB (241KB gzip), with separate lazy route/form chunks. Owner sync still uses a versioned whole-document JSON snapshot: visible history is paged, but owner network transfer is not bounded per page. Live contact responses are projected/paged server-side (40 rows, maximum60) while the server still reads the document snapshot. Normalized transaction storage remains needed for much larger production workspaces.
- No hosted production service or SMS provider has been configured. Localhost sharing links work only where the same local frontend/backend can be reached. Real iPhone Safari/Home Screen, keyboard and camera checks remain physical-device work.

Screenshots are kept in ignored `private/screenshots/v4-*.png`; no personal ledger or credential belongs in public build output.

Final local build:37of37assets loaded; private file routes returned403. The owner financial-record checksum matched its pre-update baseline.

The final production PWA update was activated at127.0.0.1:4180. The actual cement form prefilledসিমেন্ট,সিমেন্ট কেনাandবস্তা; it was closed without saving a transaction. Work preview showed10rows after activation; the overview retained its recorded total.

## Registration and input refinement — 1 November 2026

- All195tests in36files pass; TypeScript and production build pass. The19new tests cover registration validation, generic duplicate responses, confirmation-only signup, invalid/replayed tokens, explicit confirmation, connection retry, resend cooldown, password visibility and preservation of an existing account's storage/session.
- Email/password self-registration is enabled locally with email confirmation, minimum8characters, a60second resend interval and server rate limits. The local confirmation email uses an allowlisted callback URL with its token in the fragment; the confirmation screen removes the token from the URL and requires an explicit confirmation action.
- The real browser signup form created a disposable account. Login before confirmation was rejected; opening its actual Mailpit email link and pressing confirm succeeded, followed by explicit password sign-in. The new notebook showed zero cost and no entries or works. The disposable account was signed out, then its account/messages/fixture were removed.
- Backend registration checks passed actual mail delivery, malformed input, pre-confirm denial, single-use tokens, unsafe redirect fallback, confirmed sign-in, duplicate-registration handling, empty own workspace and cross-owner ledger/voucher denial. Standard backend checks also pass.
- Local Supabase was restarted without reset or owner reseed to apply auth configuration. Existing ledger documents, revisions and timestamps matched exactly before/after.
- Input, search, amount and auth wrappers now use one thin focus border and a soft theme-aware halo. Nested fields no longer add another outline. Keyboard focus, errors, reduced motion and forced-colour focus remain visible. Desktop,390px mobile and dark inputs were visually checked;22existing control/combobox tests pass.
- Local emails are captured at127.0.0.1:55434and do not reach a real inbox. Hosted production SMTP/templates and HTTPS callback URLs remain future deployment configuration; no production service was provisioned. SeeREGISTRATION.md.

The final production preview exposes/registerandthe owner PWA update was activated without signing out the owner. All37offline/build assets loaded and the public bundle/private-route checks passed.

## Configurable local phone OTP — 1 November 2026

- All 238 tests in 40 files pass. New checks cover phone UI, mode gates, Bengali digits, challenge/request response validation, twelve-character refresh tokens, stale account/logout races and gateway controls. TypeScript and production build pass.
- The configured local OTP is checked by a server-only gateway. It produces real Supabase phone sessions, keeps each phone in its own workspace and preserves the same phone identity when the configured code changes. Requests require a random phone-bound challenge with expiry, one-time use, five-attempt limit, resend cooldown and rate limits.
- Actual backend integration verified correct/wrong code, replay/expiry/cross-phone denial, changing OTP while retaining the same ledger, independent phone identities and rejection of existing real phone users without changing their passwords. Hosted/LAN/cross-origin mock requests fail closed. No SMS provider or message delivery was activated.
- Production-preview browser QA rejected an incorrect code, then accepted Bengali digits for the configured code. It opened a separate empty notebook with zero cost and no prior entries. A discovered over-strict refresh-token length check was corrected and its regression test added.
- The current local Supabase CLI disables its native phone provider without an SMS sender. A local-only db:start wrapper reapplies the native phone flag on the auth container while preserving its config, network settings and labels, with rollback. Database containers/volumes are not changed. All existing ledger documents/revisions/timestamps matched before and after. No placeholder OAuth configuration or test-number sentinel remains.
- Standard backend checks pass and preserve all private phone environment values, including the stable identity key. The public bundle audit also checks that key and the local administrative key are absent.
- Mode is controlled by BARI_PHONE_AUTH_MODE (mock/sms/off); the code is BARI_DEV_PHONE_OTP. These are server settings in private .env.local. Only the public mode reaches the browser. SMS mode requires a configured real provider; mock mode is local development/preview only. See docs/PHONE-OTP.md.

Final target verification: 238/238 tests passed in 40 files; build and private-secret scan passed. All 37 assets loaded. The new login route shows phone/email selection. An update is ready for existing PWA tabs; the user's open owner profile was left in place. Temporary phone identity/fixture and test previews were removed.


## Complete theme refresh — 1 November 2026

- Four Color Hunt palettes now have Bengali names: নীলিমা (blue/cream), বনলতা (green/earth), অপরাজিতা (plum/lavender/blush), and গোধূলি (amber/terracotta). Each changes the page wash, raised surfaces, total-card gradient, primary actions, navigation accents and authentication screen. The settings cards show miniature previews and link to the selected source palette.
- Dark appearance uses neutral #101113 backgrounds, #191b1f cards and #23262b inset surfaces for every palette. Off-white text, quieter gradients and semantic warning/success/error colours retain readable controls without a green page cast. Light/dark/device remain independent of palette selection.
- Existing persisted palette IDs and language preferences are preserved. Device appearance changes update the browser status bar without adding duplicate listeners. No ledger, authentication or environment data changes are involved.
- All 249 tests in 41 files pass, including 11 appearance preference and device-change cases. TypeScript and production build pass. Text on light primary gradient endpoints has contrast of at least 5.28:1; dark primary actions at least 9.24:1; muted light text on palette backgrounds at least 5.48:1.
- Browser checks at 390px verified all eight light/dark palette combinations, no horizontal overflow, saved preference restoration, dashboard gradients, expense drawer, dropdown and calculator. Dark surfaces remained neutral for all four palettes. Desktop layout was also inspected. Physical-device display and Safari checks remain separate from responsive browser verification.

Final production verification: all 37 build/offline asset URLs are served on port4180 and the private bundle audit passes. Direct production-browser selection/reload retained বনলতা + dark with neutral #101113/#191b1f surfaces and no console errors. Existing owner tabs were not reloaded or signed out. The local preview is running on port4180; old PWA copies require their normal update action. Screenshot: ignored private/screenshots/v7-themes.png.


## Conditional load more — 2 November 2026

- History and historical review now render30 rows initially and append30 on each request. Previous/next buttons and range counters are removed; no load-more wrapper is rendered for empty, short, exact-final or exhausted results. History keeps accumulated batches in its existing URL state without scrolling to the top. Filters/search/order reset the loaded window.
- Immediate purchase/payment pairs stay together at batch boundaries. Review bulk selection still caps100, supports clearing selections after loading more than100rows and shows a mixed checkbox for partial selection.
- All260 tests in43files pass, including append/prefix preservation,0/2/30row lists, final exhaustion, search/order resets, linked payment grouping, review filter changes and the100selection limit.
- Browser verification used65 synthetic entries restored through the normal backup UI into an isolated sample workspace on port5190. It showed30→60→65rows, then no button; a one-result search also showed no button. No real owner records or authentication/environment configuration were changed. Shared statements and reports already use conditional append-on-request controls and were left unchanged.


## Organized settings and guest entry — 2 November 2026

- Settings now uses a compact profile, selected-theme preview and grouped rows. Appearance, language, rename, backup, save status, account and install instructions open dedicated sheets. Conflicts remain visible on the overview, and each row exposes its description/value for assistive technology. Touch targets remain at least44px and focus indicators stay visible.
- The sample entry moved to the sign-in page as a separate ‘নমুনা দেখুন’ card outside the form. It opens the existing isolated sample notebook without submitting credentials or contacting sign-in/OTP methods. Registration and phone/email sign-in remain unchanged. Guest settings offers a route back to the user’s own notebook or login.
- All270 tests in45files pass. New tests cover guest navigation in phone/email/phone-disabled modes, compact real/guest settings, phone-only profile, theme/language preservation, trimmed rename, scoped backup download, restore confirmation/error retry, visible conflicts and both resolution actions. TypeScript and production build pass.
- Browser QA at390×680 confirmed guest access without credentials, its visibility in both sign-in methods, appearance drawer containment with zero horizontal overflow, language changes, and a single backup→preview drawer. Restore remained disabled until explicit confirmation; cancelling returned to the backup actions. The sample backup was only previewed, never restored. Real owner data/auth/environment settings were not changed.
