# সংস্করণ, রিলিজ ও আপডেট

অ্যাপের সংস্করণের একমাত্র উৎস `package.json`-এর `version`। `package-lock.json`-এর দুই জায়গায় একই সংস্করণ থাকতে হবে। Vite এখান থেকেই `VITE_APP_VERSION` বসায়; সেটিংসের নিচে এই সংস্করণ দেখা যায়। এটি `.env` দিয়ে আলাদা করে বদলাবেন না।

NARC-133, NARC-134 ও NARC-136 একত্র করে `0.1.3` প্যাচ পরীক্ষার জন্য প্রস্তুত করা হয়েছে। পরিবর্তন, হাতে পরীক্ষার ধাপ ও প্রয়োজনীয় migration [প্যাচের নথিতে](releases/2026-11-04-0.1.3.md) আছে। ব্যবহারকারীর পরীক্ষা শেষে merge ও release tag হবে।

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

এই পরিবর্তনে আপডেট ব্যবহারকারীর ইচ্ছামতো হয়; বাধ্যতামূলক আপডেট চালু করা হয়নি। পরে প্রয়োজন হলে:

1. সার্ভারে `minimumSupportedVersion` রাখুন। অ্যাপ online হলে সেটি জানবে। শুধুমাত্র `latestVersion` নতুন হলেই কাউকে আটকে দেবেন না।
2. পুরোনো অ্যাপ দিয়ে অনিরাপদভাবে হিসাব বদলানো সার্ভারেও বন্ধ করতে হবে। সংশ্লিষ্ট API/RPC পুরোনো সংস্করণ পেলে `426` ও দরকারি সংস্করণ জানাতে পারে। শুধু পর্দায় বাধা দিলে যথেষ্ট নয়; সরাসরি Supabase-এ লেখা থাকলে সেই পথের সঙ্গেও একই নিয়ম ও তথ্যের যাচাই মিলতে হবে।
3. আগে অসমাপ্ত লেখা ফোনে রাখুন, চলতি সংরক্ষণ শেষ করুন এবং পাঠানো বাকি হিসাব অক্ষত রাখুন। তারপর নতুন হিসাব লেখা সাময়িক বন্ধ করে আপডেটের পছন্দ দিন। ব্যবহারকারীর আগের হিসাব দেখা ও কপি নামানোর পথ রাখুন।
4. সংযোগ না থাকলে নতুন সংস্করণ নামানো সম্ভব নয়। তখন জোর করে reload, logout, IndexedDB মোছা বা হিসাব ফেলে দেওয়া যাবে না। প্রয়োজনীয় কাজ আটকে থাকলে সহজ ভাষায় সংযোগ ফিরে এলে আপডেট করতে বলুন।

যে পুরোনো সংস্করণে এই যাচাইয়ের ব্যবস্থা নেই, সেটিকে দূর থেকে সঙ্গে সঙ্গে নতুন নিয়ম দেখানো যায় না। তাই আগে এই ব্যবস্থা সমর্থন করে এমন সংস্করণ ছড়াতে হবে; গুরুতর ঝুঁকির ক্ষেত্রে সার্ভারের লেখার নিয়মও বদলাতে হবে। সংস্করণ লেখা বা request header নিরাপত্তার প্রমাণ নয়; আর্থিক তথ্যের সার্ভারের যাচাই সব সময় লাগবে।

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
