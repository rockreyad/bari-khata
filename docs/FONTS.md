# বাংলা ও ইংরেজি ফন্ট

বাংলা লেখায় `FN Akkhor`, বাংলা অঙ্ক ও টাকার চিহ্নে `Codepotro Ekush` এবং ইংরেজিতে `Hind Siliguri` ব্যবহার হয়। Akkhor-এর Regular ও Italic WOFF2 ফাইল `src/assets/fonts/fn-akkhor/`-এ আছে। `unicode-range` দিয়ে বাংলা অক্ষর আলাদা করা হয়েছে। Hind Siliguri-এর Latin 400, 500, 600 ও 700 weight npm package থেকে স্থানীয়ভাবে আসে; কোনো CDN লাগে না। অনুপস্থিত বাংলা অক্ষরের জন্য `Noto Sans Bengali Variable` বিকল্প থাকে।

Hind-এর জন্য শুধু WOFF2 নেওয়া হয়। একই font-এর পুরোনো WOFF fallback-গুলো build ও offline cache-এ রাখা হয় না; প্রয়োজনীয় চারটি weight অক্ষত থাকে।

আগের `FN Mahin Rafid`-এর চারটি ফাইল ও তার ১২০% scaling সরানো হয়েছে। Akkhor-এ মূল আকার ও আসল Regular/Italic রাখা হয়েছে; কৃত্রিম মোটা অক্ষর তৈরি করা হয় না। বাংলা শিরোনাম ও টাকার অঙ্কের ঋণাত্মক letter spacing সরেছে। টাকার চিহ্ন ও অঙ্কের মাঝে ছোট না-ভাঙা ফাঁক থাকে: `৳ ১,৫০০`। খরচ লেখার ঘরেও চিহ্ন ও input-এর আলাদা জায়গা আছে।

## উৎস

Akkhor ফন্ট প্রকল্পের মালিক দিয়েছেন; ফাইলের copyright-এ `Mashbik Bin Anam` আছে। মূল TTF বদলানো হয়নি। Hind Siliguri এসেছে `@fontsource/hind-siliguri` থেকে; এটি Indian Type Foundry-এর font, `OFL-1.1` লাইসেন্সের কপি `public/licenses/Hind-Siliguri-OFL.txt`-এ আছে। ইংরেজি অংশের নকশার তথ্য [Google Fonts-এর মূল বিবরণে](https://github.com/google/fonts/blob/main/ofl/hindsiliguri/DESCRIPTION.en_us.html) পাওয়া যায়।

## আবার রূপান্তর

```sh
python3 -m venv /tmp/bari-font-tools
/tmp/bari-font-tools/bin/python -m pip install 'fonttools[woff]'
/tmp/bari-font-tools/bin/python scripts/convert-fonts.py '/path/to/FN Akkhor'
```

ফন্ট কোনো বাইরের converter-এ পাঠাতে হয় না। স্ক্রিপ্ট WOFF2 আবার খুলে অক্ষরের তালিকা, মাপ এবং `GSUB`, `GPOS`, `GDEF` মিলিয়ে তারপর ফাইল রাখে। বাংলা যুক্তাক্ষর বা অবস্থান ঠিক করার কোনো lookup বাদ দেওয়া হয় না।

দেওয়া Akkhor Regular-এর `GPOS` table-এর একেবারে শেষে empty `ClassDef1`-এর চারটি শূন্য byte অনুপস্থিত ছিল। শুধু নির্দিষ্ট SHA-256 মেলা table-টিতে এই ঘাটতি পূরণ করা হয়। অন্য আটটি বৈধ positioning subtable, বাংলা এ/ঐ-কার kerning, GSUB/GDEF, অক্ষরের মাপ ও নকশা অক্ষত থাকে। Italic-এ এই মেরামত লাগে না। মূল TTF-তে লেখা হয় না।

Vite hash-সহ font asset তৈরি করে। Service worker ব্যবহৃত font-ও build-এর সঙ্গে cache করে, তাই প্রথমবার app সংরক্ষিত হওয়ার পর অফলাইনেও font পাওয়া যায়। সংরক্ষিত টাকা বা হিসাবের নিয়মে এই typography কোনো পরিবর্তন করে না।

## যাচাই

দুটি TTF-এর ২,৪১,১৮০ byte থেকে WOFF2-তে ৯০,৪১৬ byte হয়েছে। রূপান্তরের পর দুই font-এর cmap, অক্ষরের মাপ, glyph order এবং বাংলা shaping table মিলেছে। Regular-এর ওই নির্দিষ্ট অসম্পূর্ণ অংশ ছাড়া আর কিছু মেরামত করা হয়নি।

`npm test -- --maxWorkers=4`-এ ৯৬টি ফাইলে ৯৫২টি পরীক্ষা পাস; `npm run build`, API runtime ও formatting-ও পাস। টাকার নতুন ফাঁকসহ অঙ্ক calculator ও parser-এ কপি করলে একই পয়সার মান ফেরত আসে। CSV-এর আসল সংখ্যার ঘর বদলায়নি।

৩২০px ও ৩৯০px মোবাইল preview-তে বাংলা ও ইংরেজি দেখা হয়েছে। ছোট পর্দায় বড় মোট অঙ্কের জন্য পূর্ণ সারি রাখা হয়েছে; সংখ্যা আলাদা লাইনে ভাঙে না। হোমের ছোট কার্ড ও খাতার বড় অঙ্ক, ফোন নম্বর এবং legacy entry form-এর চিহ্নের সঙ্গে ১০px ফাঁক যাচাই হয়েছে। শেষ build-এর নমুনা পাতায় নতুন font ও ফাঁক দেখা গেছে, page overflow বা console error ছিল না। পুরোনো Mahin Rafid asset build-এ নেই। এটি আসল iPhone hardware পরীক্ষা নয়।

## বাংলা অঙ্ক ও ইংরেজি টাকার চিহ্ন

Ekush-এর WOFF2 `src/assets/fonts/ekush/`-এ আছে। CSS-এ `U+09E6–09EF` দিয়ে শুধু দশটি বাংলা অঙ্ক, `U+09F3` দিয়ে `৳` এবং `U+202F` দিয়ে ছোট ফাঁক নেওয়া হয়। বাংলা অক্ষরের Akkhor বদলায় না। মূল Ekush TTF-তে কোনো পরিবর্তন করা হয়নি; তার OFL কপি `public/licenses/Codepotro-Ekush-OFL.txt`-এ আছে।

ইংরেজিতে Ekush-এর ASCII অঙ্ক নেওয়া হয় না, কারণ তার কিছু অঙ্ক baseline-এর নিচে নামে। ভাষা ইংরেজি হলে `Hind Currency` face থেকে শুধু `৳` আসে। Hind Siliguri-এর বাংলা subset-এর 400/500/600/700 weight থেকে এটি তৈরি; একই weight-এর Latin অঙ্কের সঙ্গে উচ্চতা মেলে। টাকার চিহ্নের মূল outline ও advance রূপান্তরের আগে ও পরে মিলিয়ে দেখা হয়। প্রতিটি ছোট currency WOFF2 প্রায় ২.৬ KB।

আগের U+00A0-এর বদলে U+202F ব্যবহৃত হয়। Ekush numeral ও Hind currency font-এ এই ফাঁকের advance এক em-এর আট ভাগের এক ভাগ রাখা হয়েছে। ফলে platform-এর fallback space-এর ওপর মাপ নির্ভর করে না। অক্ষর ও অঙ্কের মূল নকশা বদলানো হয়নি। একই না-ভাঙা ফাঁক exact/compact টাকা, calculator-এ কপি এবং রপ্তানিতে থাকে; সংরক্ষিত পয়সা অপরিবর্তিত।

```sh
/tmp/bari-font-tools/bin/python scripts/convert-fonts.py '/path/to/Codepotro Ekush' --family ekush
/tmp/bari-font-tools/bin/python scripts/convert-fonts.py node_modules/@fontsource/hind-siliguri/files --family hind-currency
```

এই পরিবর্তনের পরে ৯৬টি ফাইলে ৯৫২টি test এবং build আবার পাস করেছে। বাংলা ও ইংরেজি mobile preview-তে ছোট ফাঁক, একই উচ্চতার ইংরেজি চিহ্ন/অঙ্ক এবং Ekush-এর বাংলা অঙ্ক যাচাই হয়েছে।
