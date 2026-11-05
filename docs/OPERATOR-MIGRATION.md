# পুরোনো খাতা আনা: developer-এর কাজ

Migration অ্যাপের ব্যবহারকারীর কাজ নয়। ব্যবহারকারীর navigation-এ আলাদা migration পাতা নেই। প্রকাশের আগে developer মূল কপি রেখে তথ্য রূপান্তর ও হিসাব মিলিয়ে নেবেন। UI-তে sector, party ও work-এর route বদলালেও সংরক্ষিত ID বদলায় না।

## স্থানীয় কপিতে প্রস্তুতি

মূল portable backup Git-এ বাদ থাকা `private/`-এ রাখুন। script নিজে কোনো ব্যক্তিগত ফাইল খুঁজে নেয় না, cloud/database-এ লেখে না এবং source বদলায় না।

```sh
node --import tsx scripts/migrate-architecture.ts private/source-backup.json
```

`private/architecture-migration/<source-sha256>/`-এ চারটি ফাইল হবে:

- `source.json`: input-এর অবিকল কপি।
- `backup.json`: যাচাই করা, অ্যাপে ফিরিয়ে আনার উপযোগী backup; ভাউচারের bytes-সহ।
- `report.json`: আগে-পরে record count, party/sector/account-এর অর্থ, চুক্তির ভবিষ্যৎ টাকা বনাম হওয়া কাজ, duplicate candidate ও অস্পষ্ট তথ্য।
- `manifest.json`: source ও output checksum, তৈরি হওয়ার সময়।

ফোল্ডার `0700`, ফাইল `0600` permission-এ তৈরি হয়। একই input আবার চালালে আগের ফল যাচাই হয়; ওপর দিয়ে লেখা হয় না। আগে তৈরি ফল বদলে গেলে script থামে। input/output `private/`-এর বাইরে যায় না। মূল ledger JSON-ও গ্রহণ করে, তবে ভাউচার থাকলে সম্পূর্ণ portable backup দিতে হবে।

Exit code `0` মানে গঠন ও স্বয়ংক্রিয় reconciliation সফল। `2` মানে রূপান্তরের কপি তৈরি হয়েছে, কিন্তু developer-এর যাচাই বাকি; প্রকাশের অনুমতি নয়। `1` হলে input বা output যাচাই ব্যর্থ। duplicate নাম নিজে থেকে merge হয় না, অজানা টাকা নিজে থেকে bill বা advance হয় না। মূল প্রমাণ দেখে developer সিদ্ধান্ত নেবেন; অনুমান দিয়ে report পরিষ্কার করা যাবে না।

## প্রকাশের আগে

1. সব device-এর pending লেখা, draft, receipt ও recovery-সহ IndexedDB কপি এবং server database/private receipt storage-এর consistent backup রাখুন। portable backup পুরো server বা সব device-এর dump নয়।
2. উপরের script কপিতে চালিয়ে `report.json` পর্যালোচনা করুন। source-এর সঙ্গে ID, date, amount, note, attachment ও history মেলান। পুরোনো unmarked contract balance adjustment-এর অর্থ অজানা থাকলে নতুন calculation marker দিয়ে সেটিকে নিশ্চিত বানাবেন না।
3. test environment-এ `backup.json` ফিরিয়ে entry, পক্ষের হিসাব, sector ও work দেখুন। নতুন bill/payment, advance, draft, reopen, backup/restore ও একাধিক device-এর conflict পরীক্ষা করুন।
4. Production-এ আগে প্রয়োগ করা migration মিলিয়ে বাকি SQL এই ক্রমে চালান: `202611040005_identity_independent_contact_accounts.sql`, `202611050001_contact_types.sql`, `202611050002_party_ledger_architecture.sql`, `202611050003_shared_payment_allocations.sql`, `202611050004_earned_obligations.sql`, `202611050005_completed_contract_earnings.sql`। সবগুলো `supabase/migrations/`-এ আছে। প্রয়োগের ফল যাচাই করে compatible client দিন; অ্যাপের build SQL চালায় না।
5. source-preserving স্থানীয় upgrade স্বয়ংক্রিয়ভাবে হয়। device-এ অসমাপ্ত লেখা বা cloud conflict থাকলে সেগুলো অক্ষত থাকবে; ব্যবহারকারীকে migration-এর হিসাব মেলানোর workflow দেওয়া হবে না।

## ফেরত যাওয়ার সীমা

Source archive কখনো editable দ্বিতীয় খাতা নয়। কোনো নতুন লেখা/cloud save না হলে বিদ্যমান `rollbackArchitectureMigration()` দিয়ে নিরাপদ স্থানীয় rollback পরীক্ষা করা যায়। পরে নতুন তথ্য যোগ হলে পুরোনো snapshot দিয়ে overwrite নয়—সব নতুন তথ্য সংরক্ষণ করে আলাদা recovery লাগবে। বিস্তারিত [গঠন বদলানোর নিয়মে](ARCHITECTURE-MIGRATION.md) আছে।

## যাচাই

```sh
npx vitest run scripts/migrate-architecture.test.ts
npm test
npm run build
```

script-এর পরীক্ষায় টাকা tamper হওয়া, receipt missing, অস্পষ্ট পুরোনো cash, একই source পুনরায় চালানো, output বদলে যাওয়া এবং private-এর বাইরে input আটকানো যাচাই হয়।

## ৫ নভেম্বর ২০২৬-এর প্রয়োগ ও ফল

মূল তথ্যের কপিতে আলাদা পরিবেশে rehearsal সফল হয়েছে: **৫৮৬টি entry history, ৭টি চুক্তি ও ১টি ভাউচার** অক্ষত আছে। আর্থিক reconciliation হুবহু মেলে; একই source আবার চালানো, import করে বন্ধ করে আবার খোলা, export এবং শর্তসাপেক্ষ rollback যাচাই সফল। মূল কপি ও উৎপন্ন ফল আলাদা রাখা হয়েছে; একটির ওপর অন্যটি বসানো হয়নি।

স্বয়ংক্রিয় report-এর পুরোনো cash-সংক্রান্ত ৫৬টি চিহ্ন ও একই নামের এক জোড়া রেকর্ড হাতে পর্যালোচনা করা হয়েছে। সিদ্ধান্ত: মূল অর্থ ও রেকর্ড অক্ষত রাখা; অনুমান করে bill/advance বানানো বা নাম merge করা নয়। চুক্তির মোট ও হওয়া কাজের পার্থক্য বোঝানো ৩টি commitment bridge তথ্য হিসেবে রাখা হয়েছে; এগুলো নতুন খরচ বা টাকা দেওয়া নয়।

স্থানীয় এবং production backup Git-এ বাদ থাকা `private/`-এ আলাদা পরিবেশের কপি হিসেবে রাখা হয়েছে। Database backup-এর প্রকৃত পরিসর `public`, `storage`, migration history ও schema। `auth` ও `private`-এর credential data export automatic approval review-এ অনুমোদিত হয়নি; সেগুলো export বা ওই row-গুলো পরিবর্তন করা হয়নি। এই কপিকে পুরো server, credential backup বা সব device-এর dump বলা যাবে না।

Production-এ CLI-এর `db push --skip-vault` দিয়ে উপরের ছয়টি SQL migration সফলভাবে প্রয়োগ হয়েছে; seed বা role import চালানো হয়নি। পরের যাচাইয়ে ছয়টির history এবং সর্বশেষ `202611050005` নিশ্চিত হয়েছে। বিদ্যমান ledger document, relation, contact type ও architecture বৈধ আছে; preservation trigger চালু, completed-contract function আছে, validator-এ `anon` প্রবেশ বন্ধ এবং `authenticated` প্রবেশ অনুমোদিত।

SQL-এর পরের export আগেরটির সঙ্গে গভীর তুলনায় হুবহু মেলে: `owner`, `revision`, `document` ও `updated_at` অপরিবর্তিত। কোনো আর্থিক DML চালানো হয়নি। Production schema migration সফল হওয়া মানে সব device-এর স্থানীয় upgrade বা client rollout শেষ হওয়া নয়।

২০৬টি file-এর ২৬৬২টি পরীক্ষা, build, typecheck, release check ও ছয়টি স্থানীয় backend check সফল। পরিচয় পরীক্ষার fixture-এ শেষ কাজের status বর্তমান নিয়ম অনুযায়ী সংশোধন করা হয়েছে। `main`-এ merge, tag ও production deployment এখনও বাকি; [release নথিতে](releases/2026-11-04-0.1.3.md) প্রকাশের অবস্থা আছে।
