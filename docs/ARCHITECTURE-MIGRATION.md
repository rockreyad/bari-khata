# খাতার গঠন বদলানো ও পুরোনো হিসাব রাখা

এই পরিবর্তন `rockreyad/release-0.1.3`-এর অ্যাপ ও migration-গুলো পর্যালোচনা করে করা হয়েছে। ব্যক্তিগত মূল ফাইল বা চালু সার্ভারের খাতা পড়া, বদলানো বা মুছে ফেলা হয়নি। নিচের স্থানীয় পরীক্ষা নমুনা তথ্য ব্যবহার করে। চালু খাতার সম্পূর্ণ তথ্য ও ভাউচার মিলে গেছে—এমন দাবি এই পরীক্ষার ফল থেকে করা যাবে না।

## আগের গঠন ও পাওয়া ফাঁক

অ্যাপটি React/Vite PWA। `src/app/AppShell.tsx`-এ route, `NotebookProvider`-এ খাতার কাজ, `src/domain/model.ts`-এ Zod যাচাই, `src/domain/ledger.ts` ও `adjustmentMath.ts`-এ খরচ ও বাকি হিসাব থাকে। `QuickEntrySheet`, `EntrySheet` ও `EntitySheet` থেকে নতুন ঘটনা, সংশোধন, ব্যক্তি ও চুক্তি লেখা হয়। মানুষ, কাজ, চুক্তি, বিস্তারিত লেনদেন, রিপোর্ট, ইতিহাস, ব্যাকআপ ও ভাগ করা বিবরণের আলাদা পর্দা আছে। `src/application/mcpCommands.ts`, `mcpQueries.ts`, `server/mcp/` ও `api/` সহকারীর অনুরোধ ও অনুমতি সামলায়; এগুলো আলাদা কোনো আর্থিক খাতা নয়।

স্থানীয় IndexedDB-তে `workspaces`, `receipts`, `outbox`, `conflicts`, `drafts` ও `recoveries` ছিল। প্রতিটি মালিকের আলাদা database; নমুনা খাতাও আলাদা। খাতার একটিমাত্র JSON document `workspaces.ledger`-এ থাকে। Supabase-এ একই document `public.ledger_documents.document`-এ থাকে; `ledger_operations` একই অনুরোধ আবার এলে একই ফল ফেরায়। `owner_id`, revision তুলনা, document যাচাই ও ইতিহাস রক্ষার trigger আছে। ভাউচার ব্যক্তিগত `bari-receipts` bucket-এ থাকে। লগইন, ভাগ করা লিংক ও সহকারীর অনুমতির টেবিল হিসাবের document থেকে আলাদা।

আগেই বিল ও নগদ দেওয়া আলাদা ঘটনা ছিল। চুক্তি না করেও বিল এবং আংশিক টাকা দেওয়া যেত। পুরোনো সংশোধন, বাতিল/ফিরিয়ে আনা, ভাউচার ও উৎসের ইতিহাসও ছিল। তবে ব্যক্তির ধরন একটিমাত্র পছন্দ ছিল; একাধিক দায়িত্ব স্পষ্টভাবে রাখা যেত না। `entries.allocations` টাকা কোন কাজে গেল তা বলে, কোন বিল মিটল তা বলে না। `relatedEntryId` একটি বিলের যোগসূত্র দিতে পারে, এক টাকায় একাধিক বিল মেটানোর তালিকা দিতে পারে না। চুক্তির ধাপ এবং অগ্রিম ও ফেরতযোগ্য জমার স্পষ্ট পরিচয়ও ছিল না। সংরক্ষিত পুরোনো JSON পড়ার সময় কিছু অনুপস্থিত ঘরে default বসত, কিন্তু পরিবর্তনের স্থায়ী প্রতিবেদন ও ফেরার পথ ছিল না।

## বর্তমান নাম ও ধারণার মিল

| ধারণা                                   | খাতার একক তথ্য                                | নিয়ম                                                                         |
| --------------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------- |
| Project                                 | `project`                                     | একটি খাতায় একটি বাড়ি; `BDT` এবং পূর্ণসংখ্যার পয়সা                            |
| Party                                   | `people`                                      | `id` স্থায়ী; `identityType` জানা থাকলে ব্যক্তি বা প্রতিষ্ঠান                 |
| PartyRole                               | `people.roles`                                | একাধিক দায়িত্ব; দায়িত্ব বদলালেও `personId` ও ইতিহাস একই                      |
| Sector                                  | `works`                                       | বাড়ির কাজের বিভাগ; খরচের ধরন থেকে আলাদা                                      |
| Category                                | `EntryLine.costType`                          | মাল, মজুরি, পরিবহন, মাল নামানো, ভাড়া ও অন্য খরচ                              |
| মালের শ্রেণি                            | `materialGroups`, `items`                     | মালের ধরন, নির্দিষ্ট মাল, ব্র্যান্ড ও ব্যবহার                                |
| Agreement                               | `contracts`                                   | ঐচ্ছিক চুক্তি; কাজের বিভাগ বা পুরো বাড়ির জন্য                                |
| Milestone                               | `milestones`                                  | চুক্তির ঐচ্ছিক ধাপ; তারিখ, টাকা ও কাজের অবস্থা                               |
| Purchase / Work Charge / Service Charge | `entries.kind: "expense"` ও লাইনের `costType` | বিল তৈরি হয়; এখান থেকে নগদ দেওয়া হয় না                                       |
| Payment                                 | `entries.kind: "payment"`, `paymentParts`     | নগদ চলাচল; দ্বিতীয়বার খরচ নয়                                                 |
| Advance / Receivable                    | `entries.paymentContext`                      | স্পষ্ট অগ্রিম ও ফেরতযোগ্য জমা আলাদা; পুরোনো অস্পষ্ট টাকা অনুমান করা হয় না    |
| PaymentAllocation                       | `paymentAllocations`                          | একটি দেওয়া টাকার সঙ্গে একাধিক বিলের নির্দিষ্ট পয়সা ও প্রয়োজন হলে কাজের বিভাগ |
| Refund / Credit                         | `refund`, `expense_credit`                    | নগদ ফেরত পাওয়া এবং বিল কমানো আলাদা                                           |
| Attachment                              | `entries.receipts` ও receipt blob             | বর্তমান ও সংশোধনের আগের ভাউচার দুটোই রাখা হয়                                 |

`Purchase`, `Transaction` বা `Payment` নামে দ্বিতীয় আর্থিক টেবিল বানানো হয়নি। `entries`-ই মূল ঘটনা। `paymentAllocations` কেবল মিলানোর যোগসূত্র; তার টাকা আবার খরচ বা নগদে যোগ হয় না। `paymentParts.method` নগদ/ব্যাংক/বিকাশের মাধ্যম রাখে। আলাদা স্থিতিসহ `CashAccount` বই চালু ছিল না; কোনো অজানা শুরুর স্থিতি বানিয়ে তা যোগ করা হয়নি।

`schemaVersion: 1` ব্যাকআপ ও document-এর বাইরের খোলস। নতুন গঠনের পরিচয় `architectureVersion: 2`; `milestones` ও `paymentAllocations` নতুন document-এ থাকে। অজানা ভবিষ্যৎ সংস্করণ প্রত্যাখ্যান হয়। আগে লেখা `kind`, `contactType`, `role`, `relatedEntryId` ও কাজভিত্তিক `allocations` পুরোনো ঘটনার অর্থ ও পুরোনো ক্লায়েন্ট বোঝার জন্য এখনও প্রয়োজন; এগুলো মুছে অন্য অর্থ বসানো হয়নি। দায়িত্বভিত্তিক পুরোনো বাধার জায়গায় `roles` ব্যবহার হয়।

## রূপান্তর ও যাচাই

`src/domain/architectureMigration.ts`-এর `migrateArchitecture()` পুরোনো document যাচাই করে। টাকা, সম্পর্ক, সমন্বয়ের ইতিহাস বা ভাউচারের পরিচয় পরস্পরবিরোধী হলে এটি থামে। পরিচিত `contactType` দায়িত্বে যায়; সেটি না থাকলে সংরক্ষিত `kind` ও আগের `contactPresetFrom(kind, role)`-এর নিয়ম রাখা হয়। কোনো পরিচিত ধরন না থাকলে দায়িত্ব খালি থাকে। দোকান দেখেই প্রতিষ্ঠান ধরা হয় না। একই নাম বা ফোনের record কেবল `duplicatePartyCandidates`-এ আসে; নিজে থেকে মেলানো হয় না।

বিল, টাকা, তারিখ, বর্ণনা, নোট, উৎস, সংশোধন ও চুক্তি নতুন করে বানানো হয় না। কোনো পুরোনো টাকা কোন বিল মিটিয়েছে তা অনুমান করে `paymentAllocations` লেখা হয় না। আগের `relatedEntryId`-এর সরাসরি যোগসূত্র বর্তমান হিসাবেও বোঝা হয়। যোগসূত্র বা স্পষ্ট কারণবিহীন নগদ ঘটনা `ambiguousCashEntryIds`-এ এবং অজানা পরিচয় `unspecifiedIdentityPartyIds`-এ থাকে।

পরিবর্তনের আগে ও পরে project, প্রতিটি party, account ও work-এর খরচ, নগদ দেওয়া, ফেরত, বাকি, অগ্রিম এবং সমন্বয় মেলে। ব্যক্তি, কাজ, মাল, চুক্তি, entry, revision ও receipt-এর সংখ্যাও থাকে। `entries` এবং `contracts`-এর সম্পূর্ণ parsed ইতিহাস অপরিবর্তিত না থাকলে রূপান্তর ব্যর্থ হয়। এখানে পয়সাকে টাকায় বদলানো বা দশমিক rounding হয় না।

`LedgerDatabase`-এর IndexedDB version 2 upgrade একই transaction-এ মূল workspace row ও আগে থেকে স্থানীয়ভাবে থাকা সব receipt blob-এর অবিকল কপি `migrations` store-এ রাখে, প্রতিবেদন লেখে, তারপর নতুন document বসায়। স্থায়ী key `architecture:<workspace>:2`; আবার খুললে দ্বিতীয় কপি বা নতুন financial record হয় না। একটি workspace নষ্ট হলে পুরো upgrade বাতিল হয় এবং পুরোনো database থাকে। `drafts`, `outbox`, `conflicts` ও আগের recovery-গুলো অক্ষত থাকে। ক্লাউড থেকে এখনও নামানো হয়নি এমন ভাউচারের blob এই স্থানীয় কপিতে থাকার দাবি করা হয় না; তার উল্লেখ document-এ থাকে এবং মূল storage-এর backup আলাদাভাবে লাগবে।

নতুন device-এ পুরোনো cloud document এলে তার রূপান্তরের কপি `architecture:<workspace>:2:cloud:<revision>` key-এ থাকে। পরিবর্তিত document একই revision-এর ভিত্তিতে নতুন অনুরোধে যায়। পুরোনো backup restore/merge-এও যাচাই ও রূপান্তর হয়; source কপি `:backup:<SHA-256>` key-এ রাখা হয়। backup restore-এর আগে বর্তমান খাতা ও ভাউচারের আগের recovery আচরণও চালু থাকে। আলাদা record-এর অমিল ব্যবহারকারীর বাছাই ছাড়া মেটে না।

`outbox`-এর জমাট বাঁধা অনুরোধ কখনো পাল্টানো হয় না। আগের অনুরোধ সার্ভারে পৌঁছে উত্তর হারিয়ে যেতে পারে; একই request ID-তে বদলানো JSON পাঠালে hash আর মিলবে না। আগে সেই মূল অনুরোধ অপরিবর্তিত যায়, পরে নতুন generation-এর রূপান্তর আলাদা request ID-তে যায়। মালিক, cloud revision ও অসমাপ্ত লেখা অক্ষত থাকে; অনলাইনে না যাওয়া নতুন কপি pending থাকে।

পুরোনো ক্লায়েন্ট নতুন marker, দায়িত্বের ক্ষেত্র, ধাপ, বিল মেলানোর ইতিহাস বা নগদের স্পষ্ট পরিচয় বাদ দিলে save/restore প্রত্যাখ্যাত হয় বা cloud conflict থাকে। allocation মুছে বা তার মূল টাকা/যোগসূত্র পাল্টানো যায় না; কারণ ও সময়সহ একবার বাতিল করা যায়। বাতিলের ইতিহাসও ফের বদলানো যায় না। ধাপের শর্ত বদলানো যায়, আগে ব্যবহৃত ধাপের `id` বাদ দেওয়া যায় না।

## স্থানীয় ব্যবহার ও ফেরার সীমা

সাধারণ পুরোনো IndexedDB খুললেই upgrade হয়। নতুন version-এর database-এ ইচ্ছাকৃতভাবে legacy workspace বসানো থাকলে repository দিয়ে স্পষ্টভাবে চালানো যায়:

```ts
const result = await repository.migrateWorkspace("real");
const migration = await repository.database.migrations.get(
  "architecture:real:2",
);
```

`result.report.before` ও `after` মিলে যায় এবং অস্পষ্ট record-এর তালিকা দেখা যায়। এগুলো ব্যক্তিগত আর্থিক তথ্য; বের করে রাখলে Git-এ বাদ থাকা `private/`-এ রাখতে হবে।

একই খাতায় পরের কোনো লেখা বা cloud save হওয়ার আগে স্থানীয়ভাবে ফিরতে:

```ts
const current = await repository.read("real");
if (current) {
  await repository.rollbackArchitectureMigration("architecture:real:2", {
    ledger: current.ledger,
    generation: current.generation,
  });
}
```

এই API বর্তমান generation ও document-কে রূপান্তরের ফলের সঙ্গে মেলায়। পরে সম্পাদনা, নতুন cloud revision, frozen request বা conflict থাকলে এটি থামে। সফল হলে অবিকল আগের ledger ও সংরক্ষিত blob ফিরে আসে, migration record `rolled-back` থাকে। cloud revision কখনো পিছিয়ে দেওয়া হয় না। একই migration নিজে থেকে আবার চালিয়ে সেই কপি ঢেকে দেওয়া যায় না। নতুন server guard চালু হওয়ার পরে পুরোনো marker-এর document প্রকাশ করাও অনুমোদিত নয়। প্রকাশের পর ফেরার জন্য সার্ভারের backup ও উপযুক্ত পুরোনো client/schema একসঙ্গে ফিরিয়ে আনার পরিচালনাগত ব্যবস্থা লাগবে; এই API দিয়ে তা পাশ কাটানো হয় না।

## চালু খাতায় প্রকাশের ক্রম

1. আগে database snapshot, `ledger_operations`, ভাগ করা লিংক/অনুমতির প্রয়োজনীয় তথ্য এবং ব্যক্তিগত receipt storage-এর পূর্ণ backup নিতে হবে। ফিরিয়ে আনার পদ্ধতি আলাদা পরীক্ষার পরিবেশে যাচাই করতে হবে। পাসওয়ার্ড বা key রিপোর্টে রাখা যাবে না।
2. কপিতে `migrateArchitecture()` চালিয়ে গণনা, party/project balance, পুরোনো ইতিহাস ও ভাউচার মিলিয়ে দেখতে হবে। duplicate candidate ও অজানা নগদ ঘটনার প্রতিবেদন মালিককে দেখাতে হবে; অস্পষ্ট তথ্য থেকে financial adjustment বানানো যাবে না।
3. Supabase migration `202611050002_party_ledger_architecture.sql` এবং `202611050003_shared_payment_allocations.sql` ক্রম অনুযায়ী আগে প্রয়োগ করতে হবে, তারপর নতুন client প্রকাশ করতে হবে। নতুন guard প্রতিষ্ঠিত তথ্য পুরোনো client দিয়ে বাদ পড়া ঠেকায়। কেবল এই স্থানীয় কাজ শেষ হয়েছে বলে production migration শেষ ধরা যাবে না।
4. বিভিন্ন device-এর pending লেখা, সেশন শেষ হওয়া, conflict, পুনরায় অনলাইন হওয়া ও receipt download যাচাই করতে হবে। স্বয়ংক্রিয় migration কোনো আলাদা device-এর জমা লেখা মুছে দেয় না।
5. আসল খাতার আগে/পরে মেলানো শেষ এবং rollback-এর সময়সীমা পার না হওয়া পর্যন্ত পুরোনো financial fields, recovery কপি বা migration history মুছবেন না। বর্তমান document-এর ঐতিহাসিক ক্ষেত্রগুলো ব্যবহার হচ্ছে; শুধু পুরোনো নাম বলে বাদ দেওয়া নিরাপদ নয়।

এই branch কেবল স্থানীয় পর্যালোচনার জন্য। push, PR, production migration এবং ব্যক্তিগত ফাইল আনা এই কাজের অংশ হিসেবে চালানো হয়নি।

## পরীক্ষা

```sh
npx vitest run src/domain/architectureMigration.test.ts src/domain/partyLedger.test.ts src/data/architectureMigration.test.ts src/data/backupMerge.test.ts
npm test
npm run typecheck
npm run build
node --import tsx scripts/backend-architecture-check.ts
node --import tsx scripts/backend-shared-allocations-check.ts
```

পরীক্ষায় bill/payment আলাদা থাকা, একই টাকায় একাধিক বিল, আংশিক পরিশোধ, অগ্রিমের পরে বিল মেলানো, ফেরতযোগ্য জমা, একাধিক দায়িত্ব, দায়িত্ব বদলেও একই ইতিহাস, চুক্তির ধাপ, চুক্তি ছাড়া সেবা, ধাপ/কাজভিত্তিক হিসাব, v1 database upgrade, ব্যর্থ upgrade-এর rollback, একই migration পুনরায় না হওয়া, frozen JSON অক্ষত রাখা, পুরোনো cloud/backup রূপান্তর, পরের লেখা না হারিয়ে rollback প্রত্যাখ্যান এবং backup/IndexedDB পুনরায় খোলা যাচাই করা হয়। পর্দা থেকে নতুন লেখা রেখে আবার খোলার পরীক্ষাও আছে। package-এ আলাদা `lint` command নেই; TypeScript এবং বর্তমান build checks ব্যবহার হয়।

স্থানীয় Supabase পরীক্ষার দুটি script শুধু স্থানীয় Docker socket ও `supabase_db_bari-khata` ব্যবহার করে। নতুন schema ও নমুনা লেখা একই transaction-এ যাচাই করে শেষে rollback হয়; আগের function/অনুমতি অক্ষত থাকা এবং নমুনা owner সরেছে কি না আলাদা করে মেলে। shared বিবরণে একটি পরিশোধের একাধিক বিল, কাজ অনুযায়ী সীমিত তথ্য, ফেরতযোগ্য জমা এবং ২০টির পরের পরিশোধের পাতা যাচাই করা হয়।

## এই branch-এর যাচাই

৫ নভেম্বর ২০২৬-এর স্থানীয় যাচাই:

- `npm test`: ১৮৩টি file-এ ২,৩৭৭টি test সফল। পরে যোগ করা `src/data/conflictMigration.test.ts`-এর একটি focused test-ও সফল।
- `npm run typecheck`, `npm run build`, পরিবর্তিত TypeScript/CSS/Markdown-এর Prettier check এবং `git diff --check` সফল। আলাদা lint script নেই। build-এ বড় chunk-এর সতর্কতা আছে।
- `backend-architecture-check.ts`: ৩৩টি schema, অর্থ, অনুমতি ও rollback পরীক্ষা সফল। `backend-shared-allocations-check.ts`-এ ২৭টি পরিশোধ ২০+৭ পাতায় দেখা, কাজের সীমা, legacy যোগসূত্র, বাতিল সম্পর্ক, ফেরতযোগ্য জমা ও গোপনীয়তার পরীক্ষা সফল। database-এ পরীক্ষার পরিবর্তন রাখা হয়নি।
- ব্রাউজারের নমুনা খাতায় ১,৭০০ টাকার পুরোনো পরিশোধ থেকে ১,৫০০ টাকা বিলে বসানো হয়েছে। অসমাপ্ত ১,৫০০ টাকার লেখা reload-এর পর ফিরে এসেছে; সংরক্ষণের পরে reload ও নতুন tab-এ বিলে মেলানো বাকি শূন্য এবং অব্যবহৃত টাকা ২০০ দেখা গেছে। মূল cash entry ১,৭০০-ই আছে। নতুন tab-এ browser error পাওয়া যায়নি।

এই ফল নমুনা ও স্থানীয় পরীক্ষার প্রমাণ। production-এর পূর্ণ backup, প্রকৃত খাতার reconciliation এবং প্রকাশের অনুমতি এখনও প্রকাশের আগের ধাপ।
