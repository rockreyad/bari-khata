# AI সহকারীর সঙ্গে খাতা যুক্ত করা

বাড়ির খাতার MCP সংযোগ দিয়ে নিজের ব্যক্তিগত AI সহকারীকে হিসাব দেখা, খোঁজা এবং বেছে দেওয়া কাজ করার অনুমতি দেওয়া যায়। সহকারী বিলের ছবি বা ভয়েসের নির্দেশ বুঝে নির্দিষ্ট খাতায় হিসাব রাখতে পারে। ছবি পড়া ও কথা বোঝার কাজ আপনার সহকারী করে; বাড়ির খাতা অঙ্ক, পরিচয়, সম্পর্ক ও অনুমতি যাচাই করে তথ্য রাখে।

## সেটিংস থেকে সংযোগ

1. নিজের খাতায় **সেটিংস → আপনার AI সহকারী** খুলুন। সরাসরি ঠিকানা `/settings/assistants`।
2. **সংযোগের ঠিকানা** কপি করুন। নিজের সহকারীর সেটিংসে নতুন remote MCP সংযোগে সেই ঠিকানা বসান।
3. সংযোগের লগইন খুললে নিজের বাড়ির খাতার অ্যাকাউন্টে ঢুকুন। সহকারীর নাম ও কোথায় ফিরে যাবেন দেখে কী করতে পারবে বেছে নিন।
4. **অনুমতি দিয়ে যুক্ত করুন** চাপুন। অনুমতির মধ্যে থাকা কাজ সহকারী সরাসরি করতে পারবে। চাইলে প্রতিবার আগে দেখানোর ব্যবস্থা ও একবারে সর্বোচ্চ টাকার সীমা রাখুন।

সাধারণ ব্যবহারকারীর আলাদা server চালানো, package বসানো বা Supabase key নেওয়ার দরকার নেই। নমুনা খাতার `/sample/settings/assistants` শুধু পরিচিতির জন্য; সেখান থেকে ব্যক্তিগত সংযোগ তৈরি বা পড়া হয় না।

## Claude-এ সংযোগ

Claude web বা Claude Desktop-এর remote connector-এর জন্য:

1. বাড়ির খাতার **সেটিংস → আপনার AI সহকারী → Claude-এ যোগ করুন** খুলে সংযোগের ঠিকানা কপি করুন।
2. Claude-এর **Customize → Connectors** থেকে নতুন custom connector যোগ করুন। নাম দিন এবং বাড়ির খাতার remote MCP ঠিকানা বসান।
3. লগইন করার পদ্ধতিতে **Sign in now** নিন। **OAuth client**-এ **Register automatically** বেছে নিন। এই server dynamic client registration সমর্থন করে; Claude-এর published identity দিয়ে লগইন করার পথ এখানে তৈরি হয়নি।
4. সংযোগের লগইন খুললে বাড়ির খাতায় ঢুকে প্রয়োজনীয় অধিকার দিন। তারপর Claude-এ ফিরে connector চালু করে হিসাবের নির্দেশ দিন।

Claude-এর এই সংযোগ Anthropic-এর server থেকে আসে। তাই প্রকাশিত, বাইরে থেকে পৌঁছানো যায় এমন HTTPS ঠিকানা লাগবে; নিজের কম্পিউটারের `localhost` ঠিকানা এই পথে চলবে না। Claude Desktop-এর স্থানীয় server configuration আলাদা ব্যবস্থা। ধাপ ও এই network-এর নিয়ম [Claude-এর নির্দেশনায়](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) আছে।

বাড়ির খাতার local OAuth, tool ও database প্রবাহ পরীক্ষা করা হয়েছে। প্রকাশিত deployment থেকে সরাসরি Claude-এ সংযোগ দিয়ে চূড়ান্ত পরীক্ষা এখনও বাকি।

## Codex-এ সংযোগ

Codex CLI ব্যবহার করলে একই পাতায় কপি করার কমান্ড আছে। নিজের প্রকাশিত ঠিকানা বসিয়ে উদাহরণ:

```sh
codex mcp add bari-khata --url https://your-app.example/api/mcp
codex mcp login bari-khata
```

Codex-এর remote server যোগ করা ও OAuth লগইনের নির্দেশনা [OpenAI-এর নথিতে](https://learn.chatgpt.com/docs/extend/mcp) আছে। অন্য client-এর সেটিংসের নাম ও লগইনের ধাপ আলাদা হতে পারে।

## চাবি দিয়ে সংযোগ

যে সহকারী গোপন চাবি দিয়ে HTTP সংযোগ নিতে পারে, তার জন্য **চাবি দিয়ে যোগ করুন** ব্যবহার করুন। নাম দিন, কাজের অনুমতি বাছুন, প্রয়োজন হলে আগে দেখানোর ব্যবস্থা ও টাকার সীমা দিন।

তৈরি চাবি শুধু একবার দেখায়। এই পাতার React state ছাড়া localStorage, খসড়া বা backup-এ রাখা হয় না। **চাবি কপি করুন** অথবা **সংযোগের JSON কপি করুন** দিয়ে নিজের client-এ বসান। JSON-এর রূপ:

```json
{
  "mcpServers": {
    "bari-khata": {
      "url": "https://your-app.example/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_PERSONAL_MCP_TOKEN"
      }
    }
  }
}
```

এটি উদাহরণ; client অনুযায়ী configuration-এর রূপ বদলাতে পারে। ব্যক্তিগত চাবির মেয়াদ ৯০ দিন। চাবি হারালে নতুন সংযোগ তৈরি করুন এবং আগেরটির অনুমতি বন্ধ করুন। সেটিংসের **অনুমতি বন্ধ করুন** দিয়ে OAuth ও চাবির সংযোগ দুটোই থামানো যায়। আগের লেখা হিসাব অক্ষত থাকে।

## সহকারীকে কী বলতে পারেন

- “এই বিলের মোট ৬০ হাজার, ২০ হাজার দিয়েছি। ছাদের খাতায় রাখো।”
- “দোকানের আগের বাকি ছয় হাজার দিলাম। নতুন কেনাকাটা হয়নি।”
- “মিস্ত্রি নিজের টাকায় দেড় হাজার টাকার মাল কিনেছেন। তাঁকে সতেরোশ দিয়েছি।”
- “গত মাসে রডে কত খরচ আর এই দোকানে এখন কত বাকি?”
- “আগের ওই বিলটা খুঁজে দাও। কী কী বদলেছে দেখাও।”

বিল দেখে টাকা দেওয়া হয়েছে ধরে নেওয়া হয় না। পরিশোধের অবস্থা, অঙ্ক বা প্রয়োজনীয় ব্যক্তি অস্পষ্ট হলে সহকারীকে তা পরিষ্কার করতে হবে। মিস্ত্রির কেনা মাল মজুরির খাতে যায় না। পুরোনো বিল মেটালে দ্বিতীয়বার খরচ হয় না।

যে client মূল ছবি পাঠাতে পারে না, সেটি বিশ্লেষিত তথ্য দিয়ে হিসাব রাখতে পারে; ফলের সঙ্গে ছবি জোড়া হয়েছে বলা যাবে না। ভাউচারের সীমা প্রতি ফাইলে **১০ MiB**; JPEG, PNG, WebP ও PDF চলে। মূল audio বা HEIC সংরক্ষণ এই পথে সমর্থিত নয়। Voice থেকে বোঝা নির্দেশ দিয়ে হিসাব রাখা যায়।

## অনুমতি এবং অনুমোদন

| অধিকার                            | কাজ                                                            |
| --------------------------------- | -------------------------------------------------------------- |
| `ledger:read`                     | খোঁজা, সারাংশ, হিসাব, বিবরণী ও ইতিহাস দেখা।                    |
| `entries:create`                  | নতুন বিল, পরিশোধ, অগ্রিম, মজুরি, reimbursement ও ফেরতের হিসাব। |
| `entries:update`                  | আগের হিসাব সংশোধন।                                             |
| `entries:void_restore`            | কারণসহ বাতিল ও ফিরিয়ে আনা।                                     |
| `entities:write`                  | ব্যক্তি ও কাজের খাতা তৈরি, বদলানো, সরিয়ে রাখা ও ফেরানো।        |
| `contracts:write`                 | চুক্তি তৈরি ও শর্ত বদলানো।                                     |
| `catalog:write`                   | মালের নাম, ধরন ও টাকা দেওয়ার কারণ সাজানো।                      |
| `receipts:read`, `receipts:write` | ব্যক্তিগত ভাউচার দেখা ও যোগ করা।                               |

শুধু দেখা, দৈনন্দিন হিসাব অথবা সব কাজের অনুমতি থেকে শুরু করে আলাদা কাজ বাছা যায়। হিসাব পড়ার মৌলিক অধিকার সংযোগে থাকে। অনুমতি পুরো নিজের খাতার জন্য; আলাদা একটি কাজ বা ব্যক্তির মধ্যে সীমাবদ্ধ করার বিকল্প এখন নেই।

আগে দেখানোর ব্যবস্থা থাকলে বা একবারের টাকার সীমা ছাড়ালে প্রস্তাব **আপনার অনুমোদনের অপেক্ষায়** দেখা যায়। সেখানে কাজ, সহকারীর নাম, প্রযোজ্য অঙ্ক এবং আগে ও পরে হিসাব দেখে মেনে নিন। এরপর সহকারী `commit_change` চালিয়ে সংরক্ষণ শেষ করবে। শুধু মেনে নেওয়া আর খাতায় রাখা একই ধাপ নয়। মাঝখানে খাতা বদলে গেলে নতুন করে দেখে প্রস্তাব করতে হবে।

## সহকারীর tool ব্যবহার

`get_capabilities` দিয়ে চলতি অধিকার, policy, টাকা ও ফাইলের একক এবং সীমা জানা যায়। ১২টি ledger query tool: `get_ledger_context`, `search_entities`, `get_entity`, `get_summary`, `list_entries`, `get_entry`, `get_person_statement`, `get_work_statement`, `get_contract_summary`, `list_history`, `get_change_history`, `export_statement`।

লেখার জন্য `preview_change`, `apply_change`, `apply_batch` এবং অনুমোদিত প্রস্তাবের জন্য `commit_change` আছে। ২৮টি typed command দিয়ে নতুন হিসাব, সংশোধন, বাতিল/ফিরিয়ে আনা, ব্যক্তি, কাজ, চুক্তি, মালের তালিকা ও ভাউচার জোড়া/আলাদা করা যায়। পূর্ণ schema `src/application/mcpCommands.ts` ও discovery-তে আছে। Batch-এ সর্বোচ্চ ২০টি command একসঙ্গে পুরো সফল হয় অথবা কিছুই রাখা হয় না।

প্রতিটি লেখায় পূর্ণসংখ্যার পয়সা, নির্দিষ্ট ID, বর্তমান `expected_revision` ও স্থায়ী `idempotency_key` ব্যবহার করুন। Timeout হলে নতুন key দিয়ে আবার লিখবেন না; `get_operation_status` দিয়ে আগের ফল দেখুন। `list_operations` দিয়ে সহকারীর কাজের audit দেখা যায়। তালিকা বা বিবরণীর `next_cursor` থাকলে পরের page-ও নিতে হবে। মাঝখানে revision বদলালে নতুন করে পড়ুন।

ভাউচারে `create_receipt_upload`-এ স্থায়ী `idempotency_key` দিয়ে session খুলে সীমিত upload URL অথবা `upload_receipt_chunk` ব্যবহার করে ফাইল দিন; `finalize_receipt_upload`-এ যাচাই শেষ করে হিসাবের সঙ্গে জুড়ুন। `list_receipts`, `get_receipt` ও `read_receipt_chunk` দিয়ে অনুমোদিত ভাউচার পাওয়া যায়। `list_receipt_uploads` অসমাপ্ত বা খাতায় না জোড়া session দেখায়। Finalize হওয়া মূল ফাইল অপরিবর্তনীয় থাকে; MIME, আকার ও checksum যাচাই হয়। সাধারণ অ্যাপে আগে রাখা এবং পুরোনো revision-এর ভাউচারও পড়া যায়।

একই উৎসের নির্দেশ বা যাচাই করা ছবির সঙ্গে একই আর্থিক ঘটনা মিলে গেলে `possible_duplicate` আসতে পারে। আগের operation দেখুন; সত্যিই আলাদা লেনদেন হলে ফেরত আসা operation ID ও কারণ দিয়ে `duplicate_override` দিন। শুধু একই অঙ্ক বলে নতুন খরচ আটকানো হয় না। History-তে entry revision ও সহকারীর audit আলাদা pagination পথ পায়; `list_operations`-এর সব page-ও নিতে হবে। বড় বিলের লাইন `get_entry_lines` দিয়ে পড়া যায়।

MCP শুধু অনলাইনে পৌঁছানো snapshot দেখে। অন্য ফোনের খসড়া বা পাঠানোর অপেক্ষায় থাকা লেখা এর জানা নেই। সময় বেছে নেওয়া রিপোর্টে ওই সময়ের খরচ ও টাকা চলাচল আসে; চলতি বাকি সম্পূর্ণ বর্তমান খাতার ভিত্তিতে আসে। বর্তমান বাকি পুরোনো দিনের বাকি বলে দেখানো যাবে না।

## সার্ভার প্রস্তুত করা

সার্ভার চালান যিনি, তাঁর জন্য প্রয়োজনীয় পরিবেশের মান:

| নাম                                  | ব্যবহার                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `VITE_SUPABASE_URL`                  | প্রকল্পের Supabase ঠিকানা।                                                                                   |
| `VITE_SUPABASE_ANON_KEY`             | প্রকাশ্য anon বা publishable key।                                                                            |
| `BARI_SUPABASE_SERVICE_ROLE_KEY`     | শুধু server-এর সীমিত MCP RPC ও ব্যক্তিগত storage ব্যবহারের প্রশাসনিক key। Browser বা সহকারীকে দেওয়া যাবে না। |
| `BARI_DEV_SUPABASE_SERVICE_ROLE_KEY` | স্থানীয় পরীক্ষায় server key-এর বিকল্প।                                                                       |
| `BARI_PUBLIC_APP_ORIGIN`             | প্রকাশিত অ্যাপের সঠিক HTTPS origin, যেমন `https://your-app.example`; শেষে slash নয়।                          |
| `BARI_MCP_ENABLED`                   | `false` দিলে নতুন MCP অনুরোধ বন্ধ হয়।                                                                        |
| `BARI_MCP_ALLOWED_ORIGINS`           | browser client-এর অনুমোদিত origin-এর comma-আলাদা তালিকা। এটি token যাচাইয়ের বিকল্প নয়।                       |

প্রশাসনিক key-এর সামনে `VITE_` বসাবেন না। অ্যাপের সাধারণ ব্যবহারকারীকে server-এর কোনো key দিতে হবে না।

এই implementation-এর নিজস্ব OAuth gateway MCP-এর opaque token দেয়। অ্যাপের Supabase session সহকারীকে দেওয়া হয় না এবং এই সংযোগের জন্য Supabase-এর native OAuth server চালু করার প্রয়োজন নেই। PKCE, resource binding, স্বল্পমেয়াদি access token, refresh rotation এবং connection revoke gateway ও database-এ যাচাই হয়।

Route-গুলো হলো `/api/mcp`, `/api/mcp-admin`, `/api/mcp-file` এবং `/api/mcp-auth/{authorize,register,token,revoke}`। Consent UI `/mcp/consent`। `.well-known` OAuth metadata route-গুলোর rewrite `vercel.json`-এ থাকে; এগুলোতে SPA HTML ফেরত দেওয়া চলবে না।

স্থানীয় Supabase আগে প্রস্তুত থাকলে:

```sh
npm ci
npx supabase migration up --local
npm run dev
```

স্থানীয় database চালু না থাকলে আগে `npm run db:start` চালান। MCP migration `supabase/migrations/202611020007_mcp.sql`, `supabase/migrations/202611020008_mcp_intents.sql` ও `supabase/migrations/202611020009_mcp_upload_cleanup.sql`। স্থানীয় middleware `localhost` ও loopback address নেয়; প্রকাশিত সংযোগে HTTPS origin লাগবে।

এই পরিবর্তন থেকে production migration বা deployment নিজে থেকে করা হয় না। প্রকাশের আগে server-এর পরিবেশ, database migration, metadata route, login callback এবং লক্ষ্য client-এর সঙ্গে সংযোগ যাচাই করুন। Remote HTTP/OAuth সমর্থন থাকা client লক্ষ্য; কোনো নির্দিষ্ট তৃতীয় পক্ষের client পরীক্ষা ছাড়া তার image/voice বা attachment সমর্থন নিশ্চিত ধরে নেবেন না।

## পরীক্ষা এবং সমস্যা দেখা

```sh
npm test
npm run build
node --import tsx scripts/backend-mcp-check.ts
node --import tsx scripts/backend-mcp-intents-check.ts
node --import tsx scripts/backend-mcp-cleanup-check.ts
node --import tsx scripts/backend-mcp-http-check.ts
```

প্রথম তিনটি backend পরীক্ষা স্থানীয় Docker Supabase-এ synthetic account ও তথ্য দিয়ে চলে এবং transaction rollback করে। এগুলো permission, মালিক আলাদা থাকা, সীমা, retry, conflict, approval, OAuth, provenance, intent duplicate, audit pagination ও নিরাপদ upload cleanup যাচাই করে। HTTP পরীক্ষা চলমান `http://localhost:5180` অ্যাপ ও স্থানীয় backend ব্যবহার করে বাস্তব login/OAuth, হিসাব, private storage, পুরোনো ভাউচার এবং একই উৎসের সমান্তরাল লেখা পরীক্ষা করে; শেষে তৈরি account ও ফাইল সরায়। কোনো পরীক্ষা production-এ চলে না।

## অব্যবহৃত স্থানীয় upload পরিষ্কার করা

```sh
node --import tsx scripts/mcp-cleanup.ts --local
```

এই operator কমান্ড শুধু স্থানীয় ৫৫৪৩১ পোর্টের backend নেয়। মেয়াদ শেষ pending upload এবং সর্বশেষ signed URL-এর জন্য আরও দুই ঘণ্টা অপেক্ষার পরে তালিকা নেয়। বর্তমান খাতা, পুরোনো revision বা অপেক্ষায় থাকা বৈধ প্রস্তাবে ব্যবহৃত ফাইল বাদ থাকে। Database-এ আগে claim করে দেরিতে নতুন reference যোগ হওয়া আটকায়; ফাইল সরানোর পরে metadata মুছে ফেলে। মাঝপথে ব্যর্থ হলে পরের বার আবার চেষ্টা করা যায়। প্রস্তুত বা হিসাবের সঙ্গে যুক্ত ভাউচার এই কাজ মুছে দেয় না। Production operator একই `cleanupMcpUploads` function-কে নির্দিষ্ট service client দিয়ে নিজস্ব maintenance ব্যবস্থায় ব্যবহার করতে পারেন; এখানে কোনো production সময়সূচি তৈরি করা হয়নি।

সংযোগ না এলে server env ও migration দেখুন। `invalid_origin` হলে client-এর প্রকৃত browser origin অনুমোদিত তালিকায় আছে কি না মিলিয়ে নিন। মেয়াদ শেষ বা বন্ধ সংযোগে নতুন করে লগইন করুন। `revision_conflict` হলে নতুন খাতা পড়ে প্রাসঙ্গিকতা যাচাই করুন। File পাঠানো সমর্থিত না হলে structured নির্দেশে কাজ করুন এবং ভাউচার জোড়া হয়নি তা জানান। লগে token, পুরো chat বা খাতার কপি লিখবেন না।
