# সরাসরি জানানো কোড দিয়ে প্রবেশ

এই পদ্ধতিতে ফোন নম্বর ও অ্যাপের মালিকের জানানো কোড লাগে। কোনো SMS বা ইমেইল পাঠানো হয় না। এটি একবার ব্যবহারযোগ্য OTP নয়; ফোন নম্বরের মালিকানা যাচাইও করে না। সবার একই কোড হলে কোড ও অন্যের নম্বর জানা ব্যক্তি সেই নম্বরের খাতায় ঢুকতে পারেন। এই সীমা জেনেই মালিক shared-code পদ্ধতি বেছে নিয়েছেন।

## অনলাইনের সেটিং

Vercel-এর শুধু Production পরিবেশে নিচের মানগুলো দিন। গোপন মানগুলো Secret হিসেবে রাখুন; কোনোটির নামে `VITE_` যোগ করবেন না।

| নাম                              | কাজ                                                              |
| -------------------------------- | ---------------------------------------------------------------- |
| `BARI_PHONE_AUTH_MODE=manual`    | সরাসরি জানানো কোডের পর্দা চালু করে                               |
| `BARI_MANUAL_PHONE_CODE`         | চার থেকে আট অঙ্কের প্রবেশের কোড                                  |
| `BARI_PHONE_AUTH_SECRET`         | অন্তত ৩২ অক্ষরের স্থায়ী গোপন কী; ফোনের account পরিচয় তৈরিতে লাগে |
| `BARI_SUPABASE_SERVICE_ROLE_KEY` | একই Supabase project-এর প্রশাসনিক কী; কেবল server ব্যবহার করে    |
| `BARI_PUBLIC_APP_ORIGIN`         | ঠিক `https://bari-khata.vercel.app`; অন্য domain হলে বদলাতে হবে  |

আগের `VITE_SUPABASE_URL` ও `VITE_SUPABASE_ANON_KEY` একই project-এর public মান থাকবে। `VERCEL=1` Vercel নিজে দেয়। এই endpoint localhost-এর পরীক্ষার gateway বদলায় না। `mock` পদ্ধতি আগের মতো স্থানীয় Docker-এই সীমিত। Production-এর secret Preview বা Development-এ কপি করবেন না।

Supabase-এ migration `202611020001_manual_phone_login.sql` প্রয়োগ করুন। Phone provider বা SMS সেবা চালু করার দরকার নেই। Server ফোনের সঙ্গে HMAC-এ তৈরি একটি স্থায়ী `@phone.bari.invalid` ঠিকানা এবং শক্ত ভিতরের password দিয়ে Supabase session নেয়। এই ঠিকানা ব্যবহারকারীকে দিতে বা লিখতে হয় না; কোনো চিঠিও পাঠানো হয় না। Admin দিয়ে account তৈরির সময় phone ও এই ভিতরের পরিচয় নিশ্চিত করা থাকে। অ্যাপ শুধু ফোন নম্বর দেখায়। Public signup বন্ধ রাখুন—নতুন account এই server-এর মাধ্যমে তৈরি হয়। Existing email account-এর password login চালু থাকে।

## কীভাবে কাজ করে

ফোন লেখার প্রথম ধাপে কোনো network request বা বার্তা পাঠানো হয় না। কোড জমা দিলে একই origin-এর `/api/phone-login`-এ যায়। Server code মেলানোর আগে database-এ চেষ্টার সংখ্যা রাখে। প্রত্যেক ফোনে ১৫ মিনিটে পাঁচবার এবং প্রত্যেক IP-তে পাঁচ মিনিটে ত্রিশবার চেষ্টা করা যায়; সফল চেষ্টাও গোনা হয়। আলাদা Vercel instance বা restart দিয়েও এই সীমা এড়ানো যায় না। Database সাড়া না দিলে লগইন বন্ধ থাকে।

Server ফোনের জন্য আলাদা HMAC password এবং ভিতরের ঠিকানা দিয়ে Supabase-এর আসল session নেয়। Browser কখনও সেই password, HMAC কী বা প্রশাসনিক কী পায় না। প্রথমবার account তৈরি হয়; আগে থাকা account-এর password বদলানো, পরিচয় জোড়া দেওয়া বা আর্থিক তথ্য সরানো হয় না। একই সময়ে প্রথমবার দুজন চেষ্টা করলে account-এর অনন্য পরিচয় বজায় থাকে।

Code বদলালে আগের খাতা থাকে। HMAC কী স্থায়ী রাখুন: সেটি বদলালে আগের account-এর ভিতরের password মিলবে না; পরিবর্তন করতে হলে আলাদা account-recovery পরিকল্পনা দরকার। Code বদলানো ইতিমধ্যে খোলা session বাতিল করে না।

Database-এর private table-এ ফোন বা IP সরাসরি থাকে না; server-এর HMAC hash থাকে। সাধারণ ব্যবহারকারী table বা limiter RPC ব্যবহার করতে পারেন না। আগের owner-only ledger RLS ও private receipt storage বহাল থাকে।

## যাচাই

Unit/UI পরীক্ষায় wrong code, account mismatch, network failure, server cooldown, logout-এর সময় চলতে থাকা অনুরোধ ও কোড না দেখানো পরীক্ষা হয়। স্থানীয় আসল Supabase-এ একই account-এ আবার প্রবেশ, code বদলেও একই পরিচয়, বিশটি সমান্তরাল চেষ্টা থেকে ঠিক পাঁচটি অনুমোদন, আলাদা client-এ সীমা বহাল থাকা এবং অন্য account না বদলানো যাচাই হয়েছে। পরীক্ষা শেষে শুধু ওই পরীক্ষার account সরানো হয়েছে।

সাধারণ browser-এ secret কখনও খুলবেন না বা URL-এ দেবেন না। Vercel-এর server env ছাড়া production প্রশাসনিক কী অন্য কোথাও রাখতে হবে না।

তথ্যসূত্র: [Supabase phone/password](https://supabase.com/docs/guides/auth/passwords#with-phone), [প্রশাসনিক account তৈরি](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [Vercel Node Function](https://vercel.com/docs/functions/runtimes/node-js), [Vercel forwarding headers](https://vercel.com/docs/headers/request-headers)।
