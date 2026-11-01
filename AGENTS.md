# বাড়ির খাতা

- This is a separate React/Vite PWA; do not modify neighboring projects.
- All user-facing app strings go through `useLanguageContext()` from `src/context/LanguageProvider.tsx`. Use simple, conversational Bengali; keep technical terms out of normal product flows.
- Amounts are integer poisha. Purchases/work bills, money handed over, reimbursements, advances and refunds are distinct events. Paying a bill never creates a second expense. Never classify a worker's material purchases as wages automatically.
- Local disk and backup files are untrusted input. Validate with Zod and reject corrupt/inconsistent financial records before committing. Do not store the ledger in localStorage.
- Keep demo data clearly labelled and isolated from the real ledger. Import personal source files only when the user explicitly requests migration; keep raw data and generated financial artifacts in gitignored private/, never public/ or bundled source.
- No silent conflict overwrites or clearing unsynced records when auth expires. An app update must preserve drafts.
- Use short comments only for non-obvious constraints.
- Verify monetary calculations, IndexedDB persistence, backup restore and the UI save/reopen flow. Run `npm test` and `npm run build`.
