# বাধ্যতামূলক আপডেটের সার্ভার পরীক্ষা

`release-policy.json`-এর `minimumSupportedVersion` এখন `0.1.4`। একই মান `supabase/migrations/202611060002_require_client_update.sql`-এ আছে। ভবিষ্যতে সর্বনিম্ন সংস্করণ বাড়ালে নতুন migration দিয়ে সার্ভারের মানও বাড়াতে হবে; আগের migration বদলে চালানো যাবে না।

লগইন করা অ্যাপ থেকে `save_ledger_snapshot` এবং `bari-receipts` / `bari-mcp-staging`-এর লেখা, বদলানো ও মুছতে `x-bari-client-version` পাঠাতে হয়। তিন অংশের সাধারণ সংখ্যার সংস্করণ গ্রহণ করা হয়; পুরোনো, অনুপস্থিত, ভুল বা prerelease মানে `PT426`, `client_update_required` এবং `minimumSupportedVersion` ফেরে। তুলনা সংখ্যায় হয়, তাই `0.1.10`-কে `0.1.4`-এর আগের সংস্করণ ধরা হয় না।

পড়া, ব্যাকআপ নেওয়া ও অন্য bucket-এর আগের অনুমতি অক্ষত থাকে। `service_role`-এর MCP ও রক্ষণাবেক্ষণ এই অ্যাপ-সংস্করণ পরীক্ষার বাইরে থাকে। পুরোনো মূল হিসাব রাখার function শুধু private helper হিসেবে থাকে; সাধারণ ব্যবহারকারী বা `service_role` সেটি সরাসরি চালাতে পারে না। মূল function-এর হিসাব যাচাই, revision, conflict এবং একই request-এর hash বদলানো হয়নি। migration-এ আসল খাতার কোনো তথ্য বদলানো হয় না।

স্থানীয় পরীক্ষা:

```sh
node --import tsx scripts/backend-client-update-check.ts
```

স্ক্রিপ্ট শুধু Unix socket-এর `supabase_db_bari-khata` container নেয়। SQL-এর অংশ একটি transaction-এ migration ও স্পষ্ট নমুনা তথ্য দিয়ে চলে, তারপর সম্পূর্ণ rollback হয়। আগে ও পরে function, অনুমতি, policy, constraint, trigger, খাতা, request hash, রসিদ এবং bucket-এর fingerprint মিলতে হয়। পুরোনো/ভুল header, বর্তমান ও পরের সংস্করণ, পড়া, service role, MCP, মূল হিসাবের যাচাই, পুনরায় একই request, conflict এবং রসিদের অনুমতি পরীক্ষা হয়। staging ও অন্য bucket-এর অতিরিক্ত পরীক্ষার policy-ও rollback হয়; সেগুলো release migration-এর অংশ নয়।

সবশেষে শুধু স্থানীয় API-তে REST ও Storage-এর `OPTIONS` request দিয়ে নতুন header-এর CORS অনুমতি দেখা হয়। এই পরীক্ষায় HTTP দিয়ে রসিদ upload বা production-এ SQL চালানো হয় না। Storage-এর ব্যবহৃত সংস্করণ PostgreSQL-এর `request.headers`-এ header পাঠায় কি না, release-এর আগে সেটিও যাচাই করতে হবে; শুধু PostgREST-এর `db_pre_request` hook দিয়ে Storage আটকানো যায় না।

সার্ভারে gate চালু করার আগে নতুন অ্যাপের deployment-এ version header, `/release.json` ও আপডেটের পর্দা কাজ করছে নিশ্চিত করতে হবে। আপডেটের জন্য IndexedDB, অসমাপ্ত লেখা, outbox বা লগইনের বাইরে থাকা স্থানীয় তথ্য মুছে দেওয়া যাবে না। পুরোনো offline অ্যাপ ইন্টারনেট ছাড়া সার্ভারের নতুন নিয়ম জানতে পারে না; সার্ভারে লেখা দিতে এলে নিয়মটি কার্যকর হয়।
