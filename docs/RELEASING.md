# সংস্করণ, রিলিজ ও আপডেট

অ্যাপের সংস্করণের একমাত্র উৎস `package.json`-এর `version`। `package-lock.json`-এর দুই জায়গায় একই সংস্করণ থাকতে হবে। Vite এখান থেকেই `VITE_APP_VERSION` বসায়; সেটিংসের নিচে এই সংস্করণ দেখা যায়। এটি `.env` দিয়ে আলাদা করে বদলাবেন না।

পরের প্যাচের প্রস্তুতি [patch 0.1.6-এর নথিতে](releases/2026-11-08-0.1.6.md) আছে। সংশোধনের pull request আগে প্যাচ branch-এ যাবে; প্রস্তুত release pull request পরে `main`-এ যাবে।

শেয়ার করা হিসাবের মোবাইল কার্ড, মাসের চার্ট ও কাজের অবস্থার সংশোধন [patch 0.1.5-এর নথিতে](releases/2026-11-06-0.1.5.md) আছে। এই প্যাচে সর্বনিম্ন সমর্থিত সংস্করণ `0.1.4`-ই থাকে।

`rockreyad/release-0.1.3` branch-এ NARC-133 (#34), NARC-134 (#35), NARC-136 (#36), NARC-135 (#38), NARC-131 (#39) এবং NARC-137-এর [PR #40](https://github.com/rockreyad/bari-khata/pull/40)-এর পরিবর্তন একত্র করা হয়েছে। এরপর `0d35327` commit-এ টাকা দেওয়ার রেকর্ডের অপ্রয়োজনীয় বিল মেলানোর ঘর সরানো, **ক্যাশ** লেখা এবং মজুরির রিপোর্টে বিল ও দেওয়া টাকা আলাদা দেখানোর সংশোধন এসেছে। খাতা, কর্মী ও কাজের গঠন, বর্তমান ব্যবহার, হাতে পরীক্ষার ধাপ এবং তথ্য আনার নিয়ম [প্যাচের নথিতে](releases/2026-11-04-0.1.3.md) আছে।

৫ নভেম্বর ২০২৬-এর প্রকাশ-পূর্ব যাচাইয়ে ২০৬টি test file-এর ২৬৬২টি পরীক্ষা, `npm run build`, `npm run typecheck`, `npm run release:check -- v0.1.3` এবং ছয়টি স্থানীয় backend check সফল হয়েছে। মূল তথ্য অক্ষত রেখে আলাদা পরিবেশে migration rehearsal, পুনরায় চালানোর যাচাই, import/reopen/export ও শর্তসাপেক্ষ rollback-ও সফল। পর্যালোচনায় পাওয়া পুরোনো অস্পষ্ট টাকা বা একই নামের রেকর্ড অনুমান করে বদলানো হয়নি।

একই দিনে production-এ নিচের ছয়টি migration প্রয়োগ ও পরে যাচাই সম্পন্ন হয়েছে। Schema পরিবর্তনের আগে-পরে export হুবহু মেলে; `owner`, `revision`, `document` ও `updated_at` বদলায়নি। আর্থিক row-এ DML চালানো হয়নি। [Release PR #37](https://github.com/rockreyad/bari-khata/pull/37) `main`-এ `d0d4bef` commit হিসেবে merge হয়েছে; [v0.1.3](https://github.com/rockreyad/bari-khata/releases/tag/v0.1.3) প্রকাশিত এবং production-এ চালু। পরে চালু Chrome client-এর রূপান্তরিত খাতা প্রত্যাশিত migration-এর সঙ্গে হুবহু মিলেছে। এটি অন্য সব device-এর স্থানীয় তথ্য যাচাইয়ের প্রমাণ নয়। Backup-এর সীমা ও যাচাইয়ের ফল [operator নথিতে](OPERATOR-MIGRATION.md) আছে।

Android-এ পুরোনো স্থানীয় ভাউচার থাকলে upgrade আটকে যাওয়ার সংশোধন [0.1.4-এর নথিতে](releases/2026-11-05-0.1.4.md) আছে।

অন্য পরিবেশ প্রস্তুত করার সময় [তথ্য আনার নির্দেশনা](OPERATOR-MIGRATION.md) অনুযায়ী মূল তথ্যের কপি রেখে রূপান্তর ও হিসাব মেলান। আগে প্রয়োগ করা migration দেখে নিচের বাকি SQL-গুলো ক্রম অনুযায়ী চালাতে হবে, তারপর compatible client প্রকাশ করতে হবে। Production-এ এগুলো ৫ নভেম্বর ২০২৬-এ সম্পন্ন হয়েছে:

1. `supabase/migrations/202611040005_identity_independent_contact_accounts.sql`
2. `supabase/migrations/202611050001_contact_types.sql`
3. `supabase/migrations/202611050002_party_ledger_architecture.sql`
4. `supabase/migrations/202611050003_shared_payment_allocations.sql`
5. `supabase/migrations/202611050004_earned_obligations.sql`
6. `supabase/migrations/202611050005_completed_contract_earnings.sql`

অ্যাপের build SQL চালায় না। পুরোনো route, অসমাপ্ত লেখা, source archive ও recovery-এর ব্যবস্থা এই সংস্করণে প্রয়োজনীয়; পরিষ্কার করার সময় এগুলো বাদ দেবেন না। Migration developer-এর কাজ, ব্যবহারকারীর জন্য আলাদা migration পাতা নেই।

৪ নভেম্বর ২০২৬-এর প্রকাশিত `a286fd5` commit-এর সংস্করণ `0.1.0`; সেটির [release tag `v0.1.0`](https://github.com/rockreyad/bari-khata/releases/tag/v0.1.0)। আপডেটের নতুন বার্তা ও release যাচাইয়ের পরের পরিবর্তন `0.1.1`।

## A.B.C-এর নিয়ম

| অংশ | কখন বাড়বে                                             | উদাহরণ            |
| --- | ----------------------------------------------------- | ----------------- |
| `A` | আগের ব্যবহার বা তথ্যের সঙ্গে অসামঞ্জস্যপূর্ণ পরিবর্তন | `1.4.2` → `2.0.0` |
| `B` | আগের সুবিধা বজায় রেখে নতুন সুবিধা বা নিয়মিত উন্নতি    | `1.4.2` → `1.5.0` |
| `C` | ভুল সংশোধন বা ছোট উন্নতি                              | `1.4.2` → `1.4.3` |

এই প্রকল্পে `0.x.x` থাকলেও একই নিয়মে প্রথম সংখ্যাটি breaking change বোঝাবে। নতুন সংখ্যায় গেলে ডানের সংখ্যাগুলো শূন্য হয়। Git tag-এ সামনে `v` থাকবে: অ্যাপ `0.1.1` হলে tag `v0.1.1`।

## পরিবর্তন থেকে রিলিজ

`main` থেকে নতুন branch খুলে কাজ করুন। Linear ticket থাকলে তার পরিচয় branch ও pull request-এ রাখুন। এরপর পরিবর্তন অনুযায়ী নিচের একটি কমান্ড চালান:

```sh
npm version patch --no-git-tag-version
npm version minor --no-git-tag-version
npm version major --no-git-tag-version
```

কমান্ডগুলো থেকে উপযুক্ত **একটিই** চালাবেন। এতে দুই package ফাইলের সংস্করণ একসঙ্গে বদলায়। feature branch-এ release tag তৈরি হয় না।

```sh
npm test
npm run build
```

পরিবর্তন push করে `main`-এ pull request দিন। `CI` workflow-এর `verify` পরীক্ষায় সংস্করণ মেলা, সব পরীক্ষা ও build সফল হতে হবে। merge হওয়ার পর সেই commit-এর সংস্করণ অনুযায়ী tag দিন। উদাহরণে release commit-এর সংস্করণ `0.1.1`:

```sh
git fetch origin main --tags
npm run release:check -- v0.1.1
git tag -a v0.1.1 origin/main -m "বাড়ির খাতা 0.1.1"
git push origin v0.1.1
```

tag দেওয়ার আগে নিশ্চিত হোন নিজের দেখা `package.json` আর `origin/main` একই release commit-এর। `release:check` স্থানীয় ফাইল যাচাই করে; `Release` workflow আবার tag-এর আসল ফাইল যাচাই করে।

`Release` workflow নিশ্চিত হয় tag-এর commit আগে `main`-এ merge হয়েছে, tag-এর সংখ্যা অ্যাপের সঙ্গে মেলে এবং পরীক্ষা ও build সফল হয়। তারপর GitHub Release প্রকাশ করে। ভুল tag বা failed পরীক্ষা হলে Release প্রকাশ হবে না। এই workflow hosting-এ deploy করে না; hosting-এর production branch ও deploy-এর ফল আলাদা করে দেখতে হবে।

একটি প্রকাশিত tag অন্য commit-এ সরাবেন না। ভুল সংশোধন করতে নতুন patch release দিন। `npm run build`-ও সংস্করণের অমিল থাকলে বন্ধ হয়।

## main-এর সুরক্ষার নিয়ম

Repository public হওয়ায় `main`-এর [ruleset](https://github.com/rockreyad/bari-khata/settings/rules/26516070) এখন কার্যকর। admin-সহ কারও bypass নেই।

- সরাসরি push-এর বদলে pull request লাগবে; নিজের admin অনুমতি দিয়ে নিয়ম এড়িয়ে যাওয়া বন্ধ থাকবে।
- GitHub Actions-এর `verify` সফল না হলে merge হবে না; branch-ও হালনাগাদ থাকতে হবে।
- branch delete ও force push বন্ধ থাকবে।
- review-এর অমীমাংসিত আলোচনা শেষ করতে হবে।
- `main`-এ শুধু squash merge হয়, যাতে ইতিহাস সরল থাকে।

একা কাজ করলে অন্য কারও approval বাধ্যতামূলক নয়; pull request ও সফল পরীক্ষা লাগে। release-এর `v*` tag বদলানো বা মোছাও আলাদা ruleset দিয়ে বন্ধ। GitHub-এর নিয়ম অ্যাকাউন্টের মালিককে settings খুলে ইচ্ছা করে নিয়ম বন্ধ করা থেকে আটকায় না।

### এই কম্পিউটারের clone-এ push আটকানো

```sh
npm run setup:hooks
```

এতে `.githooks/pre-push`-এর কপি `git rev-parse --git-common-dir`-এর ভেতর `bari-khata-hooks/pre-push`-এ থাকে। `core.hooksPath` এই স্থায়ী directory-র পূর্ণ path হয়। তাই পুরোনো `main` বা যে branch-এ `.githooks` নেই, সেটিতে গেলেও সুরক্ষা থাকে। একই repository-র worktree-গুলোও একই স্থায়ী hook পায়।

আগের সংস্করণে `core.hooksPath=.githooks` বসানো থাকলে এই branch থেকে `npm run setup:hooks` আবার চালান। সেটি স্থায়ী কপিতে বদলে যাবে। আগে অন্য `core.hooksPath`, default Git hooks বা আলাদা `pre-push` থাকলে কমান্ড থামে; আগের hook মুছে বা নীরবে বদলে দেয় না। CI বা dependency install-এর সময় এটি নিজে থেকে চলে না। নতুন clone-এ কমান্ডটি আবার চালাতে হবে।

`.githooks/pre-push` destination হিসেবে `refs/heads/main` পেলে নতুন push, force push ও delete আটকায়—অন্য branch থেকে `main`-এ push করলেও। আগের `v*` tag সরানো বা মুছতেও দেয় না; নতুন tag ও feature branch push করা যায়। এরপর pull request দিয়ে কাজ করুন।

এটি স্থানীয় ভুল আটকায়। GitHub website, অন্য clone, `--no-verify` বা hook বন্ধ করে করা push আটকায় না। GitHub-এর ruleset আলাদাভাবে সেই সুরক্ষা কার্যকর করে।

## কখন বাধ্যতামূলক আপডেট লাগবে

`A`, `B` বা `C` দেখেই আপডেট বাধ্যতামূলক হবে না। যেমন টাকার হিসাবের গুরুতর ভুল ঠিক করা ছোট `C` release-ও জরুরি হতে পারে। রং বা সাধারণ নতুন সুবিধার জন্য শুধু ‘নতুন আপডেট এসেছে’ ও ‘আপডেট করুন’ যথেষ্ট।

ব্যবহারকারীর নির্দেশে `0.1.4` সবার জন্য বাধ্যতামূলক করার ব্যবস্থা প্রস্তুত আছে। এটি এখনো production-এ চালু হয়নি। `release-policy.json`-এর সর্বনিম্ন সংস্করণ `0.1.4`; Vite `package.json` থেকে সর্বশেষ সংস্করণ নিয়ে `/release.json` বানায়। এই ছোট ফাইল cache ছাড়া পাওয়া যায়, খাতার database-এ নতুন query লাগে না। শুরুতে, সংযোগ ফিরলে ও পর্দায় ফিরলে একই যাচাই ভাগ করে চলে; এক মিনিটে একই পরীক্ষা বারবার হয় না। জানা সর্বনিম্ন সংস্করণ পুরোনো response পেয়ে কমে না।

প্রকাশের সময় এই ক্রম মানুন:

1. নতুন build, `/release.json` ও `/sw.js` পাওয়া যাচ্ছে নিশ্চিত করুন। `0.1.4`-এর client দুই Supabase client থেকেই `x-bari-client-version` পাঠায়। `/release.json` যেন SPA-এর HTML বা service worker cache থেকে না আসে তা যাচাই করুন।
2. স্থানীয় rollback পরীক্ষার পরে `202611060001_remove_work_milestones.sql` এবং `202611060002_require_client_update.sql` ক্রমে প্রয়োগ করুন। নতুন deployment যাচাইয়ের পরপরই দুটি migration সমন্বয় করুন: মাঝের অল্প সময়ে পুরোনো SQL নতুন client-এর ধাপ ছাড়া snapshot রাখতে পারবে না; স্থানীয় লেখা ও outbox থাকবে, পরে sync হবে। পুরোনো `0.1.3` client ধাপ বাদ দেওয়া নতুন snapshot পড়তে পারে না। নতুন build পুরোনো ধাপসহ তথ্য পড়তে পারে এবং পুরোনো metadata সংরক্ষণ করে।
3. দ্বিতীয় migration পুরোনো/অনুপস্থিত/ভুল সংস্করণের authenticated ledger RPC ও দুই protected receipt bucket-এর লেখা বন্ধ করে। `PT426` ও দরকারি সংস্করণ ফেরে। সার্ভারের read RPC ও receipt পড়ার অনুমতি বহাল থাকে; নতুন snapshot খুলতে compatible client লাগবে। নতুন client-এ হিসাব দেখা ও backup নেওয়া যায়। বিশ্বস্ত `service_role`-এর MCP/রক্ষণাবেক্ষণ এবং login/password/account lifecycle তাদের নিজস্ব নিয়মে চলে। [Gate পরীক্ষার নথি](CLIENT-UPDATE-GATE.md) দেখুন। Header অনুমতির প্রমাণ নয়; আগের RLS ও আর্থিক যাচাই বহাল রাখতে হবে।
4. পুরোনো client দিয়ে লেখা প্রত্যাখ্যান এবং নতুন client দিয়ে লেখা, পুনরায় একই request, conflict, receipt ও backup যাচাই করুন। আপডেটের আগে খসড়া ও চলতি স্থানীয় লেখা শেষ হয়; frozen outbox পাঠানো শেষ হওয়ার অপেক্ষা লাগে না। একই সময়ে খোলা পুরোনো tab-এর প্রয়োজনীয় asset cache তার tab বন্ধ বা নতুন build খোলা পর্যন্ত থাকে।

প্রয়োজনীয় আপডেটের বার্তা বন্ধ করা যায় না; খসড়া লেখার পর্দা, পুরোনো হিসাব ও backup-এর পথ থাকে। ব্যবহারকারীর চাপ ছাড়া reload হয় না। reload-এর আগে ও worker বদলের পরে অসমাপ্ত ফর্ম ও স্থানীয় সংরক্ষণ আবার পরীক্ষা হয়। IndexedDB, outbox, conflict, receipt বা login তথ্য মোছা হয় না। Metadata সরানো ও gate চালুর পরে শুধু deployment `0.1.3`-এ ফেরানো নিরাপদ নয়; compatible `0.1.4` asset রেখে নতুন সংশোধন প্রকাশ করুন।

ইন্টারনেট ছাড়া পুরোনো ফোনকে দূর থেকে নতুন নিয়ম দেখানো বা নতুন সংস্করণ নামানো যায় না। যে `0.1.3` client-এ এই বার্তার ব্যবস্থা নেই, সেটিতেও নতুন server gate হিসাব ও receipt লেখার সময় নিয়মটি কার্যকর করবে; স্থানীয় খসড়া অক্ষত থাকবে। প্রকাশের পর এই কারণে কাউকে logout বা storage clear করতে বলবেন না। সর্বনিম্ন সংস্করণ আবার বাড়ালে নতুন SQL migration ও নতুন release policy দিন; আগের migration বদলাবেন না।

## Linear-এর সঙ্গে কাজ

এই repository: [rockreyad/bari-khata](https://github.com/rockreyad/bari-khata)। কাজের project: [Bari Khata](https://linear.app/narcdev/project/bari-khata-c6b283c05a95/issues)।

Linear-এর workspace GitHub integration-এ repository-র অনুমতি থাকতে হবে। pull request-এর সংযোগ ও GitHub Issues-এর দুই দিকের sync আলাদা পছন্দ; প্রয়োজনীয় repository ও Linear team mapping integration settings-এ দিতে হয়। শুধু এই নথির link যোগ করলে sync চালু হয় না।

৪ নভেম্বর ২০২৬-এ NarcDev-এর আগের Linear GitHub app-এ শুধু `bari-khata`-র issues ও pull requests-এর অনুমতি যোগ করা হয়েছে; code access যোগ হয়নি। `rockreyad/bari-khata` → `Narcdev (NARC)`-তে **One-way GitHub → Linear creation** চালু আছে। নতুন GitHub issue Linear-এ তৈরি হবে; যুক্ত issue-এর পরের পরিবর্তন দুই দিকেই মেলে। পুরোনো ticket নিজে থেকে নকল হয় না।

এই native sync-এ repository-র সঙ্গে team মেলে, project বাছাই নেই। তাই আসা issue-এ নিজেরা `Bari-Khata` project দিন। পুরো NARC team-এর অন্য project থেকে GitHub-এ issue তৈরি না করতে Two-way creation চালু করা হয়নি। Bari-Khata project-এর Overview-তেও repository-র link আছে।

ticket থেকে branch name নিলে তার পরিচয় রেখে `rockreyad/` prefix ব্যবহার করুন। উদাহরণের `TEAM-123` জায়গায় আসল ticket identifier দিন:

```text
branch: rockreyad/TEAM-123-update-notice
PR title: TEAM-123: আপডেটের বার্তা সহজ করি
PR body: Fixes TEAM-123
```

এতে PR ticket-এর সঙ্গে যুক্ত হয়। এই project-এর ticket identifier `NARC-` দিয়ে শুরু হয়। team-এর workflow automation অনুযায়ী PR খোলা, review ও merge-এর সঙ্গে ticket-এর অবস্থা বদলানো যায়। ব্যক্তিগত হিসাব, ভাউচার, password বা `.env` ticket-এ দেবেন না।

সূত্র: [Vite-এর build-এ মান বসানো](https://vite.dev/config/shared-options), [GitHub workflow-এর ঘটনা](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows), [GitHub token-এর অনুমতি](https://docs.github.com/en/actions/tutorials/authenticate-with-github_token), [Linear GitHub integration](https://linear.app/docs/github)।
