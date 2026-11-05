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
4. অনুমোদিত প্রকাশে SQL `202611050002_party_ledger_architecture.sql`, `202611050003_shared_payment_allocations.sql`, `202611050004_earned_obligations.sql`, `202611050005_completed_contract_earnings.sql` আগে প্রয়োগ করুন, তারপর compatible client দিন।
5. source-preserving স্থানীয় upgrade স্বয়ংক্রিয়ভাবে হয়। device-এ অসমাপ্ত লেখা বা cloud conflict থাকলে সেগুলো অক্ষত থাকবে; ব্যবহারকারীকে migration-এর হিসাব মেলানোর workflow দেওয়া হবে না।

## ফেরত যাওয়ার সীমা

Source archive কখনো editable দ্বিতীয় খাতা নয়। কোনো নতুন লেখা/cloud save না হলে বিদ্যমান `rollbackArchitectureMigration()` দিয়ে নিরাপদ স্থানীয় rollback পরীক্ষা করা যায়। পরে নতুন তথ্য যোগ হলে পুরোনো snapshot দিয়ে overwrite নয়—সব নতুন তথ্য সংরক্ষণ করে আলাদা recovery লাগবে। বিস্তারিত [গঠন বদলানোর নিয়মে](ARCHITECTURE-MIGRATION.md) আছে।

## যাচাই

```sh
npx vitest run scripts/migrate-architecture.test.ts
npm test
npm run build
```

script-এর পরীক্ষায় টাকা tamper হওয়া, receipt missing, অস্পষ্ট পুরোনো cash, একই source পুনরায় চালানো, output বদলে যাওয়া এবং private-এর বাইরে input আটকানো যাচাই হয়। এই branch-এর কাজ production migration চালায়নি।
