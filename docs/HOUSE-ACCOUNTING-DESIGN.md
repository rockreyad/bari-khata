# একটি বাড়ির সহজ খাতা: নির্বাচিত গঠন ও নিরাপদ তথ্য আনা

**এই branch-এর নির্বাচিত গঠন:** React/Vite PWA, entity অনুযায়ী স্থানীয় IndexedDB, যাচাই করা domain command এবং revision-ভিত্তিক atomic Supabase snapshot। একটি বাড়ির জন্য এই সংমিশ্রণই এখন ব্যবহার করা হচ্ছে।

নতুন লেখার প্রবাহ, earned bill থেকে বাকি, একাধিক দায়িত্ব, চুক্তির ধাপ, দৃশ্যমান payment proposal, bill allocation, স্থানীয় entity storage ও migration review বাস্তবায়িত হয়েছে। নিচে আলাদা করে বলা custody wallet, mixed funding এবং পূর্ণ relational server বিকল্প বর্তমানে চালু নয়। production database পরিবর্তন, ব্যক্তিগত মূল খাতা আমদানি, push বা PR এই স্থানীয় কাজের অংশ হিসেবে করা হয়নি।

## ১. ব্যবহারকারীর কাজ আগে

এটি একটি বাড়ি বানানোর খাতা। প্রথম পর্দায় project switcher বা বাধ্যতামূলক চুক্তির form নেই।

পর্দার সাধারণ নাম এখন **খাতা**, **কর্মী**, **কাজ** এবং আগের লেনদেনের জন্য **রেকর্ড**। নতুন খাতা তৈরির বোতাম «নতুন খাতা বানান», কর্মী তৈরির বোতাম «নতুন কর্মী»। ভেতরের `people`/Party, `works`/Sector data ও `/parties`, `/sectors`, `/works` address একই থাকে; ব্যবহারকারীর লেখা নাম বদলানো হয় না। কর্মী form-এ ব্যক্তি/প্রতিষ্ঠান বাছাই বা তার subtitle নেই, তবে আগে রাখা `identityType`, দায়িত্ব ও হিসাবের নিয়ম অক্ষত থাকে। «আরও কাজ বা সম্পর্ক» অংশও নেই। মূল «কীভাবে যুক্ত» পছন্দটি থাকে; এটি বদলালে আগে সংরক্ষিত অতিরিক্ত দায়িত্ব বা পুরোনো bill/payment ইতিহাস বাদ যায় না। পুরোনো অসমাপ্ত লেখায় কম দায়িত্ব থাকলেও সংরক্ষিত অতিরিক্ত দায়িত্ব নীরবে মুছে যায় না।

আগের theme, card, chart, font ও bottom navigation বজায় থাকে। `+` বা Home-এর খরচ লেখার বোতাম একই `Sheet` খোলে; ফোনে এটি নিচের drawer।

লেনদেন যোগ ও বদলানোর form-এ একই `TransactionAmount`, `TransactionDetails`, `PaymentMethodField` এবং theme-এর মাপ ব্যবহার হয়। টাকার অঙ্ক ও দরকারি নাম আগে; মাল কেনার ব্র্যান্ড, পরিমাণ ও একক প্রয়োজনে খোলা যায়। কাজের সাধারণ bill-এ পরিমাণের ঘর নেই, তবে পুরোনো রেকর্ডের পরিমাণ মুছে যায় না; দিন হিসাবে মজুরির আলাদা হিসাব থাকে। ভাউচার, নোট ও তারিখ একসঙ্গে ভাঁজ করা থাকে। নগদ, বিকাশ, ব্যাংক ও অন্যভাবে দেওয়ার পছন্দ বাইরে আইকনসহ দেখা যায়; বাছাই করলে রঙ ও নিচের দাগে বোঝা যায়। ব্র্যান্ডের শেষ অক্ষর মুছলেও খোলা অংশ বন্ধ হয় না। ভুল অঙ্ক বা তারিখে বাংলায় কারণ দেখিয়ে সংশ্লিষ্ট field চিহ্নিত করা হয়; বারবার চেষ্টা করলেও error-এ focus ফেরে। খালি form-এ শূন্য টাকার বাড়তি সারাংশ দেখানো হয় না। বাকি তালিকা থেকে অনুমোদিত কর্মীর payment সরাসরি খোলা যায়।

সাধারণ `+` drawer-এ আলাদা «টাকা দিলাম» নেই। কর্মীর পাতার «টাকা দিই» কাজের bill form খোলে: কর্মী, মজুরির ধরন ও জানা খাতা বাছা থাকে; «পুরোটা দিয়েছি» আগে থেকে চালু থাকে। নতুন কাজের এই bill ও তার টাকা একবারই রাখা হয়। দোকানদারের «টাকা দিই» থেকে অগ্রিম বা বাকি বাছা যায়। অগ্রিমে নাম ও জানা খাতা আগে থেকে থাকে, কারণ লেখা ঐচ্ছিক। জামানতের নতুন অপশন নেই। পুরোনো অসমাপ্ত জামানতের লেখা খুললে কারণ স্পষ্টভাবে না বেছে রাখা যায় না; আগের অঙ্ক বা ভাউচার নীরবে বদলায় না। আগে সংরক্ষিত ফেরতযোগ্য টাকার রেকর্ড সংশোধন বা ফেরতের হিসাব আগের অর্থ বজায় রাখে।

| জায়গা                 | কাজ                                                           |
| --------------------- | ------------------------------------------------------------- |
| বাড়ির সারাংশ          | আগের summary card, খরচের ভাগ, সাম্প্রতিক হিসাব ও চলমান sector |
| `+` drawer            | মাল কিনেছি, কাজের bill, অগ্রিম বা বাকি                        |
| `/sectors`            | বাড়ির বিভাগ: প্লাস্টার, টাইলস, বিদ্যুৎ ইত্যাদি                |
| `/parties`            | মানুষ/প্রতিষ্ঠানের পরিচয়, দায়িত্ব, নিয়ম, chart ও হিসাব        |
| `/works`              | party-কে দেওয়া কাজ, ঐচ্ছিক চুক্তি ও ধাপ                       |
| `/ledger`, `/reports` | আগের লেখা এবং খরচের বিশ্লেষণ                                  |
| `/settings`           | backup, ভাষা, theme ও account                                 |

`/write/purchase`, `/write/charge`, `/write/payment` form-এর address। `/write` খুললেও একই drawer পাওয়া যায়; আলাদা chooser page নেই। আগের অসমাপ্ত `quick-v2:` লেখা drawer থেকে খোলা যায়। পছন্দের খাতার আলাদা shortcut block এই drawer-এ নেই; সংরক্ষিত `quickActions` metadata মুছে ফেলা হয়নি। `/people` ও `/jobs`-এর পুরোনো link canonical route-এ যায়। পুরোনো `/works/:id`-এ sector ID থাকলে সেটি `/sectors/:id`-এ যায়; `/works` এখন কাজের তালিকা।

Party তৈরির সময় রাখা ধরন/একাধিক দায়িত্ব, বেছে রাখা বোতাম ও sector form-এ কাজ করে। একই নিয়ম নতুন entry command-এও যাচাই হয়; URL পাল্টে বন্ধ action চালানো যায় না। কাজের চুক্তি করা যাবে কি না, সেটিও party-র নিয়ম মেনে চলে। role বদলালে পুরোনো bill/payment বা ইতিহাস বদলায় না; পুরোনো bill-এর বাকি মেটানোর পথ থাকে। কোনো বাধ্যতামূলক চুক্তির নতুন নিয়ম যোগ হয়নি।

## ২. বর্তমান তথ্যের একক উৎস

| ধারণা                 | বাস্তব domain data                                       | নিয়ম                                                                          |
| --------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Project               | `project`                                                | এক খাতায় এক বাড়ি; `BDT`, পূর্ণসংখ্যার পয়সা                                    |
| Party ও role          | `people`, `people.roles`                                 | পরিচয় স্থায়ী; একাধিক দায়িত্বে ইতিহাস বদলায় না                                 |
| Sector                | `works`                                                  | কাজের বিভাগ; expense category থেকে আলাদা                                      |
| Category ও মাল        | `EntryLine.costType`, `materialGroups`, `items`          | মাল, মজুরি, পরিবহনসহ খরচের প্রকৃতি; পরিচয় দেখে বদলায় না                       |
| Agreement ও milestone | `contracts`, `milestones`                                | ভবিষ্যৎ commitment ও ঐচ্ছিক ধাপ; নিজে থেকে খরচ নয়                             |
| Cost document/line    | `entries.kind: "expense"`, `lines`                       | সত্যি পাওয়া মাল/হয়ে যাওয়া কাজের bill                                          |
| Cash movement         | `payment`, `refund`, `paymentParts`, কাজের `allocations` | সত্যি টাকা দেওয়া/ফেরত; নতুন bill নয়                                           |
| Bill settlement       | `paymentAllocations`                                     | নির্দিষ্ট payment-এর কোন পয়সা কোন bill-এ লাগল                                 |
| Advance/receivable    | `paymentContext`                                         | usable advance ও ফেরতযোগ্য জমার স্পষ্ট পরিচয়; পুরোনো অজানা context অপরিবর্তিত |
| Credit/adjustment     | `expense_credit`, audit-সহ `adjustment`                  | bill কমানো ও noncash সংশোধন cash refund-এর সমার্থক নয়                         |
| Attachment/history    | `receipts`, `revisions`, source/activity/removal data    | বর্তমান ও আগের প্রমাণ অক্ষত                                                   |

`Obligation` বা payable হলো উপরোক্ত উৎস থেকে পাওয়া read model; আলাদা সম্পাদনাযোগ্য মোট নয়। `partyLedger()`, `reconciledTotals()` ও `contractSummary()` সেই ব্যাখ্যা দেয়। `Purchase`, `Transaction` ও `Payment` নামে একই টাকা তিন জায়গায় রাখা হয়নি। `paymentAllocations` যোগ হলেও cost বা cash আবার যোগ হয় না। পূর্ণ double-entry bookkeeping এই বাড়ির খাতার শর্ত নয়।

চুক্তির মোট এবং earned cost আলাদা। নমুনা চুক্তি ১,০০০, কাজ হয়েছে ৩০০, দেওয়া ১০০ হলে earned due ২০০; এখনও না হওয়া commitment ৭০০। ধাপ শেষ চিহ্নিত করলেই bill তৈরি হয় না।

পুরোনো পদ্ধতিতে রাখা পুরো কাজের অবস্থা `done` হলে এবং সেই কাজের কোনো bill document না থাকলে নির্ধারিত মোট টাকা কাজের পাওনা হিসেবে ধরা হয়। ৩৫,০০০ টাকার শেষ কাজের জন্য ১০,০০০ দেওয়া থাকলে বাকি ২৫,০০০; ৩৬,০০০ দেওয়া থাকলে বাড়তি ১,০০০। এটি শুধু হিসাবের ব্যাখ্যা, নতুন expense entry তৈরি হয় না। স্পষ্ট bill, বাতিল bill বা পুরোনো historical bill থাকলে সেই মোট আবার যোগ করা হয় না। শুরু হয়নি বা চলছে এমন কাজের পুরো প্রতিশ্রুত টাকা পাওনা হয়ে যায় না। পরিশোধ করলে শুধু cash বাড়ে, খরচ দ্বিতীয়বার বাড়ে না।

কাজের দর ঠিক করা থাকলে কর্মীর সারাংশে «মোট দিয়েছি» বড় করে থাকে, তার নিচে «আর দিতে হবে» সবসময় দেখা যায়। `contactCommitmentSummary()` চলমান, শেষ ও শুরু না হওয়া কাজের ঠিক করা মোট এবং স্পষ্ট bill-এর মধ্যে বড় অঙ্ক থেকে সংশ্লিষ্ট দেওয়া টাকা বাদ দেয়; অন্য bill ও বৈধ মোট-সংশোধনও তাদের নিজস্ব scope অনুযায়ী ধরে। যেমন ৬,০০,০০০ টাকার চলমান কাজে ৫,৪১,৫০০ দেওয়া থাকলে এই সারাংশে আরও ৫৮,৫০০ থাকে। এটি পুরো ঠিক করা টাকার অবশিষ্ট; earned cost বা এখনই মেটানোর bill নয়, এবং কোনো নতুন expense বা payment তৈরি করে না। আলাদা account বা কাজের credit নিজে থেকে অন্য কাজে সরানো হয় না।

কর্মীর তালিকা, নিজের পাতা ও কাজের কার্ড একই commitment নিয়ম ব্যবহার করে। প্রতিটি কাজের কার্ড একটু চওড়া, মোট ও দেওয়া টাকা ছোট করে পাশাপাশি; অবশিষ্ট বা বাড়তি টাকা আলাদা সারিতে। ব্যক্তির মোট-সংশোধন কোনো নির্দিষ্ট কাজে ভাগ করা না থাকলে কাজের কার্ডগুলো বদলায় না; সারাংশের ভাঁজে «মোটের সংশোধন» দেখা যায়। খাতা বাছলে সেই খাতার লেখাই ধরা হয়; পুরো বাড়ির বণ্টনহীন প্রতিশ্রুতি কোনো খাতায় আন্দাজ করে বসে না। অস্পষ্ট পুরোনো লেখা থাকলে জানা অঙ্কের পাশে যাচাইয়ের অবস্থা থাকে। কাজের অবস্থা ও টাকা মেটানোর অবস্থা আলাদা; কাজের ঐচ্ছিক ধাপ ভাঁজ করে রাখা যায়।

## ৩. বর্তমান command ও দৃশ্যমান প্রস্তাব

`planHousePayment()` প্রাসঙ্গিক bill, প্রতি bill-এর অঙ্ক, credit ও অবশিষ্ট উদ্দেশ্য দেখায়। `recordHousePayment()` আবার বর্তমান data-এর সঙ্গে প্রস্তাব যাচাই করে, তারপর cash entry ও allocation এক পরিবর্তনে দেয়। repository একই transaction-এ তা রাখে। খাতা বদলে গেলে পুরোনো প্রস্তাব নীরবে প্রয়োগ হয় না।

মাল ও কাজের bill-এ খাতা বাছার ঘর সরাসরি দেখা যায়। স্পষ্ট route, কর্মীর একমাত্র নির্ধারিত খাতা বা বাড়ির একমাত্র সক্রিয় খাতা ছাড়া কোনো খাতা ধরে নেওয়া হয় না। ফাঁকা খাতায় bill রাখা আটকে যায়; সাধারণ খাতা চাইলে সেটিও বেছে নিতে হয়। একই form থেকে নতুন খাতা বানালে আগের অঙ্ক, বিবরণ ও ভাউচার অক্ষত থাকে এবং নতুন খাতা বাছা হয়। `paid=yes`-এর draft সাধারণ unpaid bill draft থেকে আলাদা থাকে।

«কী কাজ হয়েছে» লিখতে শুরু করলে আগের কাজের বিবরণ থেকে সাজেশন পাওয়া যায়; বেছে নিলে শুধু বিবরণ বসে, টাকার অঙ্ক নীরবে বদলায় না। নিজের মতো লেখাও যায়। কাজের bill-এ «আরও কাজ» বোতাম নেই; আগে লেখা একাধিক সারির draft অক্ষত থাকে।

দোকানদারের «বাকি দেখি» শুধু তাঁর সম্পর্কিত বাকি দেখায়। অগ্রিমের জন্য ধরে নেওয়া পছন্দের খাতা/account দিয়ে এই তালিকা সংকুচিত হয় না; profile-এ ব্যবহারকারী স্পষ্ট filter দিলে সেটি থাকে। প্রতিটি «পরিশোধ» link-এ bill, কর্মী, খাতা, account, contract এবং পয়সায় অঙ্ক যায়। form-এ তা আগে থেকে ভরা থাকে, আংশিক টাকা দিতে অঙ্ক কমানো যায়। বিলের বাকি ছাড়িয়ে টাকা দেওয়া আটকে যায়। শুধু নগদ ও bill allocation যোগ হয়; নতুন খরচ হয় না।

`partyDueItems()` পুরোনো নগদ, allocation ও যাচাই করা সংশোধন ধরেই bill-এর বাকি দেখায়। raw bill-এর পুরো অঙ্ক আবার চাওয়া হয় না। পুরোনো টাকা ঠিক কোন bill মিটিয়েছে তা নিশ্চিত না হলে নির্ভরযোগ্য মোট অঙ্ক «বাকির হিসাব» নামে থাকে; কোনো bill-কে অনুমান করে বাকি বলা হয় না। মূল তালিকার `dueWork`/`dueAccount` scope পরিশোধের সময়েও যাচাই হয়; অন্য খাতার নগদ বাদ দিয়ে ভুল বড় অঙ্ক তৈরি হয় না। যাচাই না হওয়া পুরোনো হিসাব থেকে নিশ্চিত বাকি বানানো হয় না। একাধিক খাতা/account-এর global বাকি থাকলে আগে সংশ্লিষ্ট তালিকা খোলে; একটিমাত্র নির্ভরযোগ্য item হলে সরাসরি পূরণ করা form খোলে।

অগ্রিম form-এও খাতা সরাসরি বাছা যায় এবং খাতা ছাড়া নতুন অগ্রিম রাখা যায় না। ভাউচার ও তারিখ ভাঁজ করা থাকে। আগের সাধারণ payment route ও `intent: "payment"` পুরোনো link/draft-এর জন্য সমর্থিত থাকে; সেগুলোকে নীরবে নতুন কাজের bill বানানো হয় না। নতুন কাজের paid bill এবং পুরোনো bill পরিশোধ আলাদা command-ই থাকে।

আগে লেখা সাধারণ payment draft একই key-তে খোলে; অঙ্ক, ভাউচার ও মাধ্যম অক্ষত থাকে। আগের স্পষ্ট advance/receivable উদ্দেশ্য বা নিশ্চিত করা advance ভাগ নীরবে বদলায় না। আলাদা advance shortcut এবং পুরোনো explicit settlement command-এর যাচাই আগের মতো আছে।

বিলের সঙ্গে না মেলা নগদ একই account ও contract-এর মোট বাকি কমাতে পারে; এতে ভবিষ্যৎ বিলের allocation নিজে থেকে তৈরি হয় না। অন্য account বা contract-এর বাকি নীরবে মেটানো হয় না। মোট credit-কে সাধারণ টাকা দেওয়ার form-এ অগ্রিম বলে দেখানো হয় না।

কর্মীর পাতাতেও সাধারণ টাকা মোট প্রদানে থাকে; সেটিকে «অগ্রিম দিয়েছি» বলা হয় না। অগ্রিমের দৃশ্যমান অঙ্কে সংশ্লিষ্ট account ও খাতার ব্যবহারযোগ্য অগ্রিম এবং পুরোনো cash-এর সীমা মানা হয়। আগে যাচাই করা বাকি সংশোধনের «আমার জমা» আলাদা থাকে।

একটি ব্যবহারকারীর payment প্রয়োজনমতো একাধিক account/agreement-এর স্পষ্ট group-এ রাখা যায়; সংরক্ষিত অংশের যোগফল মূল দেওয়া টাকার সমান। এক payment-এ একাধিক bill এবং এক bill-এ একাধিক payment সমর্থিত। `planHouseBillAdvance()` ও `applyHouseBillAdvance()` থাকা credit দিয়ে bill মেলায়; সেই অংশে দ্বিতীয় cash entry হয় না।

পুরোনো টাকা কোন bill-এর তা অজানা হলে সেটিকে গোপনে নতুন bill-এ মেলানো হয় না। নতুন সাধারণ payment-এ শুধু এবার দেওয়া নগদ রাখা হয়; পুরোনো explicit settlement command-এর credit যাচাই আলাদা থাকে। সন্দেহজনক legacy contract adjustment থাকলে planner থামে এবং যাচাই করতে বলে। allocation-এর মূল পরিচয়/amount বদলে বা ইতিহাস মুছে দেওয়া যায় না; কারণ ও সময়সহ একবার বাতিলের record রাখা যায়।

সাধারণ entry correction ও paid-purchase edit পুরোনো revision রেখে চলে। অনেক bill-এ ছড়ানো settlement-সহ জটিল correction-কে সম্পূর্ণ স্বয়ংক্রিয় reversal/reallocation ব্যবস্থা বলা হচ্ছে না; বিদ্যমান validation ও কারণসহ cancellation প্রযোজ্য। নতুন bill কমেছে বলে বানানো নগদ ফেরত লেখা যাবে না।

## ৪. অন্যের নিজের টাকায় মাল কেনা এবং বর্তমান সীমা

বর্তমান `HouseCostForm`-এ “অন্যজন” বেছে “কে দিয়েছেন”-এ যিনি নিজের টাকা খরচ করেছেন, তাঁকে বাছতে হয়। দোকানের নাম নিজে থেকে এখানে বসে না; দুই ধরনের লেখায় আগে বাছা নাম আলাদাভাবে থাকে। এই বিলে নির্বাচিত ব্যক্তিকে মাল কেনার টাকা ফেরত দেওয়ার বাকি থাকে। নমুনা নিজের ৮০০-তে মাল কিনলে মালামালের খরচ ৮০০, বাড়ির মালিকের নগদ পরিশোধ শূন্য এবং সেই ব্যক্তিকে দিতে বাকি ৮০০; এতে মজুরি বা বানানো নগদ পরিশোধ যোগ হয় না।

আলাদা supplier-এর obligation মিটিয়ে worker-এর নামে দায় সরানোর পূর্ণ `LiabilityTransfer` বই এখন নেই। নিজের পকেটের টাকা ও homeowner-এর custody টাকা মিশিয়ে একই কেনাকাটার funding split-ও নেই। নিশ্চিত তথ্য ছাড়া এই ঘটনাগুলোকে সাধারণ advance দিয়ে একই অর্থে ঢোকানো যাবে না।

Custody wallet ভবিষ্যতে প্রয়োজন হলে টাকাটি homeowner-এর মালিকানায় থেকে অন্যের জিম্মার account হবে। তখন নিজের account-এর transfer ও supplier-কে external payment আলাদা করতে হবে। উদাহরণ: worker-এর হাতে দেওয়া ৮০০ আগে cost নয়; সেই custody দিয়ে মাল কেনার সময় cost হবে, worker-এর wage/reimbursement নয়। এটি ভবিষ্যৎ অর্থের নিয়মের উদাহরণ, বর্তমান feature-এর দাবি নয়।

## ৫. স্থানীয় সংরক্ষণ ও cloud-এর দায়িত্ব

IndexedDB database-এর বর্তমান version 4। entity record format-এর metadata marker `storageVersion: 3`। সক্রিয় `workspaces` row-এ পুরো Ledger JSON নেই; owner, generation, revision ও pending metadata থাকে। `ledgerHeaders` project/header, collection count ও checksum রাখে; `ledgerEntities` workspace/collection/id ও মূল ক্রম ধরে record রাখে। repository প্রয়োজনমতো সেগুলো জুড়ে typed `Ledger` projection দেয়।

লেখার সময় বদলানো entity, header ও metadata একই transaction-এ থাকে। receipt যোগের ক্ষেত্রেও একই transaction সীমানা প্রযোজ্য। data পড়ার সময় Zod, entity count/ক্রম/ID/সম্পর্ক ও SHA-256 যাচাই হয়। নষ্ট data reset করে খালি খাতা বসানো হয় না। account ও sample data আলাদা database-এ থাকে।

Supabase-এ `ledger_documents`-এর snapshot-ই সেই মালিকের committed cloud state। এটি ইচ্ছাকৃত transport/commit boundary; স্থানীয় entity records-এর সঙ্গে আলাদা editable balance book নয়। report-এর balance উৎসের facts থেকে তৈরি হয়। JSON কপি backup, frozen request ও অপরিবর্তনীয় recovery-তে থাকাও দ্বিতীয় সক্রিয় financial truth নয়।

## ৬. snapshot sync কেন রাখা হয়েছে

একজন homeowner-এর খাতা, offline লেখা এবং bill/payment-এর একসঙ্গে বহু সম্পর্ক বদলানোর ক্ষেত্রে পুরো validated snapshot atomicভাবে commit করা পরিষ্কার। `save_ledger_snapshot` expected revision মেলায়; একই request ID-তে payload hash মিলে গেলে আগের ফল ফেরায়। revision না মিললে server overwrite করে না। স্থানীয় pending লেখা থাকলে আলাদা cloud কপি conflict হিসেবে থাকে।

Frozen request-এর payload বদলানো হয় না: server-এ save হয়ে উত্তর হারালেও retry duplicate তৈরি করে না। request চলার মধ্যে নতুন স্থানীয় লেখা হলে পরের generation আলাদা request হয়। cloud revision পিছিয়ে গেলে initial ও confirmed pull দুটোতেই স্থানীয় newer financial history রেখে conflict হয়। খালি regressed snapshot-ও data মুছে দেয় না। login শেষ হলে outbox, draft বা receipt মুছে যায় না।

এই boundary-তে unrelated দুই device-এর edit-ও conflict হতে পারে। সেটি গ্রহণ করা tradeoff; last-write-wins নয়। খাতার বর্তমান আকারে per-entity network sync-এর extra version graph, allocation race ও change-feed cutover যোগ করা হয়নি। বড় বহু-সম্পাদক খাতা বা পরিমাপ করা bandwidth সমস্যা হলে relational table/per-entity sync আবার বিবেচনা করা যাবে।

## ৭. v1/v2 থেকে বাস্তব রূপান্তর

`schemaVersion: 1` document এবং `architectureVersion: 2` data গ্রহণ করা হয়। `migrateArchitecture()` field, টাকা, সম্পর্ক ও history যাচাই করে; পরিচিত contact type/আগের সংরক্ষিত kind-এর নিয়ম roles-এ নেয়। পরিচয় দেখে organization বানায় না। নাম/ফোনের duplicate candidate কেবল প্রতিবেদনে আসে; ব্যক্তি নিজে থেকে merge হয় না।

v1/v2 IndexedDB খোলার সময় transaction-এ প্রথমে workspace preimage ও স্থানীয়ভাবে পাওয়া receipt blob-এর অবিকল কপি থাকে। architecture migration key `architecture:<workspace>:2`; entity storage conversion key `storage:<workspace>:3`। pending request ও draft অক্ষত। পরিচিত checksum-পূর্ব v3 header-এর জন্য v4 upgrade raw header/entity/metadata/blob `storageRecoveries`-এ রেখে পূর্ণ যাচাইয়ের পরে checksum দেয়। malformed বিদ্যমান checksum মুছে “ঠিক” করে না।

নতুন device-এর legacy cloud snapshot ও পুরোনো backup-ও যাচাই করে রূপান্তর হয়। cloud source revision এবং backup SHA-256 অনুযায়ী recovery key স্থায়ী; একই migration আবার খুললে duplicate হয় না। তারিখ, টাকা, note, source, attachment ও revision বদলে বা guessed allocation বানিয়ে mapping করা হয় না।

বর্তমান local row-এ common-base document সবসময় থাকে না। তাই দুই কপির একই ID-তে ভিন্ন data-কে নিশ্চিতভাবে স্বয়ংক্রিয় merge করা যায় না। reviewed backup merge-এ একই data no-op, নতুন ID যোগ এবং একই ID-এর অমিল ব্যবহারকারীর বাছাইয়ের অপেক্ষায় থাকে। ইতিহাস হারানোর বাছাই প্রত্যাখ্যাত হয়।

## ৮. পুরোনো চুক্তির বাকি ও অজানা তথ্য

পুরোনো `max(agreed, billed) - paid` display-এর সঙ্গে নতুন earned due জোর করে সমান করা হয় না। নমুনার আগের ৯০০ অবশিষ্ট এখন earned ২০০ ও unearned commitment ৭০০ দিয়ে ব্যাখ্যা হয়। বাড়তি ৭০০-এর bill বা adjustment তৈরি হয় না।

`createMigrationReview()`, `repository.migrationReview()` এবং developer-এর `report.json`-এ আগের commitment-ভিত্তিক অঙ্ক, earned অঙ্ক, unclassified cash ও historical balance-এর issue দেখা যায়। source ID দিয়ে মূল লেখা মেলানো যায়। চুক্তির ভবিষ্যৎ টাকায় করা অস্পষ্ট adjustment-কে অন্ধভাবে earned discount বা advance করা হয় না; source অক্ষত রেখে যাচাই লাগে।

এখানে স্থায়ী পার্থক্যের পরিচয় হলো ঐচ্ছিক `adjustment.calculationVersion: 2`। নতুন `appendBalanceAdjustment()` কেবল balance correction-এ earned ভিত্তি ও `expectedBefore` মেলার যাচাই পেরিয়ে এটি লেখে। field-টির default নেই। পুরোনো সক্রিয় contract balance correction-এ marker না থাকলে সেটি review-তেই থাকে—পরে আরও bill লেখা, চুক্তির মোট বদলানো বা ঘটনাক্রম সাজানোর ফলে তার মূল অর্থ জানা গেছে ধরে নেওয়া হয় না। এই অবস্থায় একটি derived অঙ্ক মিলে যাওয়া ambiguity মেটানোর প্রমাণ নয়।

Migration, backup restore বা পুরোনো record সম্পাদনা করে marker বসানো যায় না। প্রতিষ্ঠিত adjustment-এর immutable core marker-সহ রক্ষা হয়; marker যোগ/বাদ দিয়ে পুরোনো অর্থ পাল্টানো save/restore/reviewed merge-এ প্রত্যাখ্যাত হয়। মূল record ও তার history থাকে। সন্দেহজনক পুরোনো সমন্বয় বাদ রেখে earned অঙ্ক দেখানোর সময় যাচাইয়ের বাধাটিও থাকে; planner তা নীরবে মিটিয়ে এগোয় না।

অজানা opening cash বা wallet balance বানানো হয়নি। বর্তমানে পাওয়া cash movement দেখা যায়; তা দিয়ে opening না জেনে বাস্তব হাতে-থাকা টাকা দাবি করা যায় না। নিশ্চিত origin/type ছাড়া পুরোনো opening obligation-ও তৈরি হয় না। এমন opening workflow বা custody wallet এখনও feature নয়। এগুলো পরে যোগ হলেও cost বাড়িয়ে পুরোনো due মেলানো চলবে না।

## ৯. backup ও অনুমোদিত প্রকাশের runbook

Migration developer-এর দায়িত্ব; ব্যবহারকারীর navigation-এ migration পাতা নেই। private output-সহ command ও exit code [operator runbook-এ](OPERATOR-MIGRATION.md) আছে।

বর্তমান portable backup-এ validated active ledger, বর্তমান ও revision history-তে উল্লেখ থাকা receipt bytes, checksum এবং semantic migration report থাকে। এটি পুরো server/database বা সব browser draft/outbox-এর dump নয়। পূর্ণ প্রকাশ-পূর্ব backup-এর বিকল্প বলে ব্যবহার করা যাবে না।

1. **কোনো production পরিবর্তনের আগে:** `ledger_documents`, `ledger_operations`, share/assistant-এর প্রয়োজনীয় state এবং private receipt storage-এর পূর্ণ consistent backup নিতে হবে। সংশ্লিষ্ট device-এর IndexedDB-তে pending/draft/recovery থাকা কপিও রাখতে হবে। এক device-এর export দিয়ে অন্য device সম্পূর্ণ আছে বলা যাবে না। secrets report-এ নয়; financial export Git-এ বাদ থাকা `private/`-এ।
2. **কপিতে rehearsal:** `migrateArchitecture()`/entity upgrade/backup restore চালিয়ে source IDs/counts, খরচ, cash, party/work/account ও agreement bridge দেখুন। unknown cash, disputed adjustment এবং missing blob আলাদা করুন। incomplete backup-কে সম্পূর্ণ বলবেন না।
3. **server guard আগে:** অনুমোদিত প্রকাশে `202611050002_party_ledger_architecture.sql`, `202611050003_shared_payment_allocations.sql`, `202611050004_earned_obligations.sql`, `202611050005_completed_contract_earnings.sql` ক্রমানুসারে পরীক্ষা ও প্রয়োগ, তারপর client rollout। এখনো production-এ এগুলো প্রয়োগ করা হয়নি। নতুন data পুরোনো client দিয়ে বাদ পড়া server guard আটকায়।
4. **একাধিক device যাচাই:** dropped response, frozen retry, pending edit, expired login, conflict, shared statement ও receipt download দেখুন। অপ্রেরিত data মুছবেন না। `report.json`-এ দেখা পার্থক্যকে guessed financial row দিয়ে চাপা দেবেন না।
5. **ফেরার সীমা:** `rollbackArchitectureMigration()` কেবল অপরিবর্তিত generation/document, একই cloud revision এবং frozen request/conflict না থাকলে স্থানীয় source ফেরায়। নতুন লেখা বা নতুন cloud save হলে এটি থামে। পরে ফেরার জন্য compatible client/server এবং সব নতুন লেখা রক্ষা করা recovery পরিকল্পনা লাগবে; পুরোনো snapshot বসিয়ে নতুন facts হারানো নয়।
6. **শেষে cleanup:** ব্যবহৃত compatibility/history fields বা recovery যাচাই ছাড়া মুছবেন না। historical archive রাখা intentional; সেটি দ্বিতীয় editable ledger নয়। push/PR ও production কাজ স্থানীয় branch-এর অনুমতি থেকে নিজে থেকে অনুমোদিত হয় না।

## ১০. গ্রহণযোগ্যতা ও বর্তমান পরিসর

সব অঙ্ক নমুনা। “বর্তমান” মানে code path ও প্রাসঙ্গিক domain/storage/UI test আছে; production-এর আসল তথ্য যাচাই হয়েছে এমন নয়।

| ঘটনা                                              | প্রত্যাশিত অর্থ                              | পরিসর                        |
| ------------------------------------------------- | -------------------------------------------- | ---------------------------- |
| মজুরির bill ১,০০০; দেওয়া ৪০০; পরে ৬০০             | cost একবার; due ৬০০→০                        | বর্তমান                      |
| দুই supplier bill-এ combined payment              | আগে দেখা split, cash ও allocations atomic    | বর্তমান                      |
| advance-এর পরে bill ও নতুন আংশিক cash             | পুরোনো credit ব্যবহার; একই cash আবার নয়      | বর্তমান                      |
| refundable deposit এবং আলাদা bill                 | ফেরতযোগ্য টাকা ও earned due আলাদা            | বর্তমান                      |
| একই party-এর একাধিক role; role বদল                | স্থায়ী ID/history                            | বর্তমান                      |
| agreement ১,০০০; earned ৩০০; paid ১০০             | earned due ২০০, unearned ৭০০                 | বর্তমান                      |
| milestone; agreement ছাড়া driver service          | commitment নিজে cost নয়; optional agreement  | বর্তমান                      |
| worker নিজের ৮০০-তে মাল কিনেছেন                   | material reimbursement ৮০০, homeowner cash ০ | বর্তমান সরাসরি reimbursement |
| পুরোনো অস্পষ্ট payment/adjustment                 | source অক্ষত; review; guessed settlement নয়  | বর্তমান                      |
| save/reopen/backup/restore                        | facts, receipt ও semantic report থাকে        | বর্তমান                      |
| frozen retry, stale proposal, revision regression | duplicate/overwrite নয়; স্পষ্ট conflict      | বর্তমান                      |
| supplier liability worker-কে আনুষ্ঠানিক transfer  | দুটি creditor-এর একই দায় যাচাই করে সরানো     | ভবিষ্যৎ আলাদা workflow       |
| custody account ও নিজের টাকার mixed funding       | homeowner-owned account/transfer আলাদা       | বর্তমানে নেই                 |
| বাস্তব cash balance/opening workflow              | source-confirmed opening ছাড়া incomplete     | বর্তমানে wallet feature নেই  |
| full relational Postgres/per-entity network sync  | পরিমাপ করা প্রয়োজন হলে বিকল্প                | এখন নির্বাচিত নয়             |

## ১১. code ও পরীক্ষার যোগসূত্র

- `src/domain/housePayments.ts`: payment plan, stale-preview check, record এবং advance প্রয়োগ।
- `src/domain/partyLedger.ts`, `ledger.ts`, `adjustmentMath.ts`, `contractObligations.ts`: bill/credit/cash projection, earned basis ও অস্পষ্ট legacy adjustment।
- `src/data/entityStorage.ts`, `database.ts`, `repository.ts`, `sync.ts`: entity storage, checksum, transaction, source recovery, backup ও revisioned snapshot transport।
- `src/domain/architectureMigration.ts`, `migrationReview.ts`, `scripts/migrate-architecture.ts`: mapping, source reconciliation ও developer-এর reconciliation report।
- `src/features/write/HouseWrite.flow.test.tsx`, `src/domain/housePayments.test.ts`, `src/data/entityStorage.test.ts`, `architectureMigration.test.ts`, `sync.test.ts`, `conflictMigration.test.ts`: পর্দা থেকে রাখা, draft/ভাউচার, storage upgrade, checksum, retry ও conflict-এর প্রমাণ।

```sh
npm test
npm run typecheck
npm run build
node --import tsx scripts/backend-architecture-check.ts
node --import tsx scripts/backend-shared-allocations-check.ts
node --import tsx scripts/backend-earned-obligations-check.ts
```

শেষ তিনটি check কেবল নির্ধারিত স্থানীয় backend-এর জন্য; production target দিয়ে চালানো নয়। পূর্ণ পরীক্ষা/পর্যালোচনার চূড়ান্ত ফল delivery-তে থাকবে। ভবিষ্যৎ relational schema চাইলে `projects`, `parties`, `party_roles`, `cost_documents`, `cost_lines`, `cash_movements`, `obligations`, `settlement_allocations`, `entity_versions` ও `change_journal`-এ একই source facts map করা যেতে পারে। সেই বিকল্পের জন্য মূল তথ্য অক্ষত রেখে rehearsal ও আলাদা cutover লাগবে।
