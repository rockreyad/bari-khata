# Phone login

Phone login supports Bangladesh numbers, including local `01…`, `+880…` and Bengali digits. The current test mode accepts the server-configured four-digit code after a login request. Each phone gets its own real Supabase identity and private notebook; phone login never merges an existing email notebook.

## Local fixed code

The current `.env.local` contains these **server-only** settings:

```dotenv
BARI_PHONE_AUTH_MODE=mock
BARI_DEV_PHONE_OTP=1318
BARI_DEV_PHONE_AUTH_SECRET=<random stable private key>
BARI_DEV_SUPABASE_SERVICE_ROLE_KEY=<local server key>
```

Do not prefix the code or private keys with `VITE_`. Only the public mode is passed to the browser. The app sends the submitted code to the local server; it does not compare an embedded browser constant. Change `BARI_DEV_PHONE_OTP`, then restart the dev/preview server. Keep the private HMAC key stable so the same test phone continues to open the same notebook.

`node scripts/configure-phone-auth.mjs mock` prepares the local settings, retaining existing public configuration and generating the private HMAC key once. It also enables native local phone sessions without an SMS sender. It reads the administrative key from local Supabase status without printing it. `sms` and `off` select the other modes. The helper refuses a hosted backend in mock mode.

The installed Supabase CLI disables native phone auth when no SMS provider is configured, even when a test-number mapping is present. `npm run db:start` therefore runs `scripts/start-local-backend.mjs`: after normal CLI startup, `enable-local-phone-provider.mjs` enables the documented native GoTrue phone flag only when local mock mode is configured. It recreates only the stateless auth container, preserves its configuration, labels and network aliases, and retains an automatic rollback until the new container passes its health check. It never alters database containers or volumes and never invents SMS-provider credentials. Temporary recovery material is private and removed after success. The API phone settings are verified by the integration check.

The mock API exists only in the Vite development server and its local production preview. It requires a loopback request, exact same origin and a loopback Supabase API on port55431. It rejects hosted backend URLs, cross-origin requests and LAN callers. Static hosted deployments have no mock API. Email registration and its confirmation flow remain available.

A request creates a random, phone-bound challenge lasting five minutes. Resends wait60seconds; a resend invalidates the previous challenge. Five incorrect guesses lock that challenge; successful use consumes it before creating a session. Requests and verification are rate limited. Sessions use `Cache-Control: no-store` and are issued by Supabase, keeping normal logout, refresh and owner-only RLS.

The server creates only a new phone identity carrying a protected development marker and a password derived from its private HMAC key. A repeat login reuses that identity. An existing phone identity created elsewhere is rejected; the gateway never resets its password, changes its details or silently attaches it to another notebook. Those phone identities require real SMS.

## Real SMS later

Set `BARI_PHONE_AUTH_MODE=sms` and rebuild/restart the frontend. This removes the local shared-code gateway; the existing Supabase `signInWithOtp` and `verifyOtp` path is used. Configure a supported SMS provider, phone signup, delivery settings and rate limits on the hosted Supabase project. No real SMS provider or message delivery has been activated by this local change. Setting `off` hides phone login entirely.

Supabase's native `auth.sms.test_otp` supports exact phone-number mappings, not every Bangladesh number. A four-digit test code is accepted for configured numbers, but arbitrary-number fixed-code testing therefore uses the local gateway described above.

Verification: `npm test -- server/phoneOtp.test.ts` and `./node_modules/.bin/tsx scripts/backend-phone-otp-check.ts`. The backend script uses disposable phone identities and removes them afterward. `scripts/qa-phone-fixture.mjs prepare|cleanup` supports browser verification with a privately saved, previously unused test number.

References: [Supabase phone login](https://supabase.com/docs/guides/auth/phone-login), [testing auth flows](https://supabase.com/docs/guides/auth/testing-auth-flows), [native OTP lookup](https://github.com/supabase/auth/blob/master/internal/conf/configuration.go).
