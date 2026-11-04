# রিলিজের শেষ পর্যালোচনার সংশোধন

রিলিজ PR #6-এর `35f6b361e373d12b982a113cbe2fd478dd1580ce` পর্যালোচনায় পাওয়া চারটি সমস্যার সংশোধন।

## হিসাবের মিল

- ব্যক্তি বা দোকানের বাকি, খরচ অথবা দেওয়া মোট সমন্বয়ের পরে নতুন টাকা দেওয়ার ফর্ম একই সমন্বিত বাকি/অগ্রিম দেখায়। মূল বিল, প্রকৃত পরিশোধ ও ফেরত আলাদা থাকে; অন্য মিস্ত্রির কাজের টাকা মেশে না।
- চালকের সারাংশ, সমন্বয়ের ফর্ম ও পাঠানো কপি একই হিসাব বেছে নেয়। পুরোনো অন্য খরচ তালিকার বাইরে থাকলে সেটি মোটেও ঢোকে না। মূল তথ্য, বাতিল বিলের সম্পর্ক ও পরিবর্তনের ইতিহাস অক্ষত থাকে।
- টাকা রেখে আবার খোলা, IndexedDB থেকে পড়া, ব্যাকআপ ফিরিয়ে আনা, ইতিবাচক/ঋণাত্মক সমন্বয়, ফেরত এবং আলাদা ব্যক্তি/খাতা/কাজের regression আছে।

## শেয়ার করা হিসাবের সীমা

- প্রতিটি বিলের জন্য পুরো তালিকা আবার খোঁজার বদলে যুক্ত পরিশোধগুলো একবার যোগ হয়।
- বিলের বিস্তারিত প্রথমে সর্বোচ্চ ২০টি পরিশোধ আনে। `read_contact_share_payments` দিয়ে পরের ২০টি আসে; বাকি থাকলেই “আরও দেখুন” থাকে। সারাংশে সব পরিশোধের সম্পূর্ণ মোট থাকে।
- প্রতিটি পাতায় bill, revision, মোট সংখ্যা, cursor ও নকল ID যাচাই হয়। শেষ পাতার যোগফল সম্পূর্ণ পরিশোধের সঙ্গে না মিললে তথ্য গ্রহণ করা হয় না।
- ভাউচারের অনুমতি যাচাইয়ে পুরো বিল ও সব পরিশোধ তৈরি করতে হয় না। বন্ধ লিংক, বদলানো revision ও আলাদা খাতার নোট/মাধ্যম/ভাউচারের সুরক্ষা থাকে।
- আগে প্রকাশিত client-এর `read_contact_share` অপরিবর্তিত। নতুন detail RPC রিলিজ PR-এর অংশ; এটি আগে production-এ প্রকাশিত হয়নি।

## যাচাই

- `npm test`: ১৫৮টি ফাইলে ১,৮৪৫টি পরীক্ষা পাস।
- `npm run build`, API runtime imports, `git diff --check` এবং ৮১টি public asset-এর গোপন তথ্য যাচাই পাস।
- `scripts/backend-shared-search-check.ts`: স্থানীয় database, HTTP ও আসল PNG ভাউচার proxy-সহ ৮৩টি পরীক্ষা পাস।
- `scripts/backend-shared-bounds-check.mjs`: ১০,০০০ entry-এর প্রথম ২০টি এবং ৫০০ পরিশোধের সব ২৫টি পাতার সম্পূর্ণ যোগফল/অনুমতি যাচাই পাস।
- স্থানীয় পরীক্ষায় ১০,০০০ entry-এর প্রথম পাতা প্রায় ২৩৫ ms; আগের প্রায় ৬.৫৫ s। ৫০০ পরিশোধের প্রথম ২০টি প্রায় ২৫ ms; আগের প্রায় ৪.৯৮ s। এগুলো production QPS বা আসল iPhone-এর ফল নয়।
- ব্যক্তি-খাতার সম্পর্ক, সম্মত মোট ও সমন্বয়ের তিনটি স্থানীয় backend rollback regression পাস। পরীক্ষার account, file ও SQL fixture পরিষ্কার হয়েছে।
- আলাদা reviewer হিসাব ও SQL/client পরিবর্তন আবার দেখে নতুন নিশ্চিত সমস্যা পাননি।

## Production migration

নিচের ছয়টি migration `wvintixauwafgvcvfafi` production প্রকল্পে ক্রমানুসারে একই transaction-এ প্রয়োগ হয়েছে। কোনো user, খাতা, লেনদেন, ইতিহাস বা ভাউচার reset করা হয়নি।

1. `202611030001_person_work_links.sql`
2. `202611030002_contract_agreed_totals.sql`
3. `202611030003_balance_adjustments.sql`
4. `202611040001_shared_statement_search_and_details.sql`
5. `202611040002_shared_bill_activity.sql`
6. `202611040003_shared_statement_bounded_reads.sql`

প্রয়োগের আগে/পরে মূল নথির fingerprint হুবহু মিলে গেছে। ১টি user, ১টি খাতা, ৩৬৬টি ledger operation ও ১টি file অপরিবর্তিত। সব বর্তমান খাতার validation পাস; ledger RLS ও দুইটি private bucket অক্ষত। Receipt authorization শুধু server-এর জন্য; payment helper public নয়। ভুল token দিয়ে নতুন/পুরোনো read RPC কোনো তথ্য দেয় না। Production-এ পরীক্ষার account বা আর্থিক ঘটনা তৈরি করা হয়নি।

স্থানীয় browser-এ duplicate Vite server-এর dependency cache conflict ঠিক করে নমুনা app আবার খুলে যাচাই হয়েছে। এটি source বা production data-র পরিবর্তন নয়। প্রকৃত iPhone-এর Safari/Home Screen পরীক্ষা এবং production traffic-এর capacity test সম্পন্ন হওয়ার দাবি করা হচ্ছে না।
