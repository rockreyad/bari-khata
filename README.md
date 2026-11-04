# বাড়ির খাতা

বাড়ি তৈরির খরচ, পরিশোধ, বাকি ও অগ্রিম রাখার বাংলা অ্যাপ। কাজ, ব্যক্তি ও দোকান অনুযায়ী হিসাব দেখা, ব্যাকআপ রাখা এবং অফলাইনে কাজ করা যায়।

[লাইভ অ্যাপ](https://bari-khata.vercel.app) · [নমুনা দেখুন](https://bari-khata.vercel.app/sample)

## নিজের কম্পিউটারে চালান

প্রয়োজন: Node.js 22 LTS (22.13+), npm ও Docker।

```sh
git clone https://github.com/rockreyad/bari-khata.git
cd bari-khata
npm ci
npm run db:start
npx supabase migration up --local
npm run db:check
npm run dev
```

অ্যাপ খুলুন [localhost:5180](http://localhost:5180)। `db:check` স্থানীয় সংযোগ যাচাই করে `.env.local` তৈরি করে।

শুধু নমুনা দেখতে Docker বা Supabase লাগে না। `npm ci`-এর পরে `npm run dev` চালিয়ে [নমুনা খাতা](http://localhost:5180/sample) খুলুন।

## পরীক্ষা ও build

```sh
npm test
npm run build
npm run preview
```

প্রস্তুত build দেখুন [localhost:4180](http://localhost:4180)।

[অ্যাকাউন্টের সেটআপ](docs/REGISTRATION.md) · [রিলিজের নিয়ম](docs/RELEASING.md) · [সব নির্দেশনা](docs/)
