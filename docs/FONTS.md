# বাংলা ফন্ট

অ্যাপের বাংলা লেখা ও বাংলা সংখ্যায় `FN Mahin Rafid` ব্যবহার হয়। Regular ও Italic মুখের WOFF2 ফাইল `src/fonts.css` থেকে লোড হয়। `unicode-range` থাকার কারণে ইংরেজি অক্ষরের আগের ফন্ট থাকে; কোনো অক্ষর না থাকলে `Noto Sans Bengali Variable` বিকল্প হিসেবে কাজ করে।

একই CSS মাপে অক্ষরগুলো ছোট দেখায় বলে `size-adjust: 120%` দেওয়া আছে। এতে ছোট label পড়তে সুবিধা হয়, ইংরেজি অক্ষরের মাপ বদলায় না।

চারটি দেওয়া TTF ফাইলের WOFF2 কপি `src/assets/fonts/fn-mahin-rafid/`-এ আছে। মূল TTF বদলানো হয়নি। Book সংস্করণের দুটি ফাইলও রূপান্তর করা আছে; বর্তমানে অ্যাপে সাধারণ Regular ও Italic ব্যবহার হয়। এগুলো static 400 weight; শিরোনামের মোটা লেখা ব্রাউজারের synthetic weight দিয়ে দেখানো হয়।

ফন্টগুলো প্রকল্পের মালিক দিয়েছেন। তিনি লেখকের সঙ্গে কথা বলে এই অ্যাপের production ও Git-এ ব্যবহারের অনুমতি আছে বলে জানিয়েছেন। ফন্টের নাম, নকশা বা লেখকের পরিচয় পরিবর্তন করা হয়নি।

## আবার রূপান্তর

অস্থায়ী Python পরিবেশে `fonttools[woff]` install করে চালানো যায়। ফন্ট কোনো বাইরের converter-এ পাঠানোর প্রয়োজন নেই।

```sh
python3 -m venv /tmp/bari-font-tools
/tmp/bari-font-tools/bin/python -m pip install 'fonttools[woff]'
/tmp/bari-font-tools/bin/python scripts/convert-fonts.py /path/to/FNMahinRafid
```

স্ক্রিপ্ট WOFF2 পুনরায় খুলে অক্ষরের তালিকা, অক্ষরের মাপ এবং `GSUB`, `GPOS`, `GDEF` মিলিয়ে তারপর ফাইল রাখে। বাংলা যুক্তাক্ষরের জন্য দরকারি টেবিল বাদ দেওয়া বা অক্ষর কমিয়ে ফাইল ছোট করা হয় না।

Vite এই ফাইলগুলোর hash-সহ নাম তৈরি করে। অ্যাপের service worker তৈরি build-এর অন্য ফাইলের সঙ্গে ব্যবহৃত ফন্টও cache করে; আলাদা CDN বা ইন্টারনেট থেকে ফন্ট আনার প্রয়োজন নেই। শুধু ফন্ট বদলালে সংরক্ষিত অঙ্ক বা টাকার হিসাব বদলায় না।

## যাচাই

চারটি TTF-এর মোট ৪৮১,০০৮ byte থেকে WOFF2-তে ১৬২,২৭৬ byte হয়েছে। প্রতিটি রূপান্তরের পর অক্ষর, মাপ ও যুক্তাক্ষরের টেবিল মিলেছে। মূল ফাইল অক্ষত আছে।

`npm test -- --maxWorkers=4`-এ ৯৬টি ফাইলের ৯৪৪টি পরীক্ষা এবং `npm run build` পাস করেছে। তৈরি CSS ও service worker-এ Regular এবং Italic-এর hash-সহ ফাইল আছে। ৩২০px ও ৩৯০px মোবাইল preview-তে login, খাতার শিরোনাম ও বাংলা টাকার অঙ্ক আড়াআড়ি overflow ছাড়া দেখা গেছে। এটি আসল iPhone hardware পরীক্ষা নয়।
