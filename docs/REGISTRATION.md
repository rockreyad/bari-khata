# Registration

The app now supports self-service email/password registration at `/register`. Registration does not grant access until the email address is confirmed. A new account starts with its own empty notebook; the existing owner records and private vouchers remain protected by owner-only RLS.

The local backend has email signup enabled, email confirmation required, an eight-character minimum password, a one-minute resend interval and a one-hour confirmation-token lifetime. Phone registration remains disabled. Sign-in/signup and token-verification requests are limited to30per5minutes perIP; the configured email limit is30perhour where enforced by the SMTP service. Production delivery and abuse limits need configuration on the hosted project.

The confirmation email sends the user to an allowlisted `/auth/confirm` URL. The hashed token is in the URL fragment so it is not part of the HTTP request or referrer. Confirmation is explicit: the page verifies the token through an isolated, nonpersistent client, and the user then signs in with their email/password. No returned confirmation session replaces an already open owner account or its drafts.

Local emails are captured at `http://127.0.0.1:55434`; they are not sent to an actual inbox. For production, configure Supabase SMTP, enable email signup and confirmation, set the exact hosted callback URL, and install the template in `supabase/templates/confirmation.html` in the hosted Email Templates settings. Local TOML/template settings do not configure a hosted project.

The template uses:

```html
<a href="{{ .RedirectTo }}#token_hash={{ .TokenHash }}&amp;type=email"
  >ইমেইল নিশ্চিত করি</a
>
```

Allow only trusted frontend callback URLs in Supabase. The current local configuration includes ports4180,5180and5186onlocalhost/127.0.0.1. Remove staging URLs when preparing a hosted production project.

## Verification

Run `./node_modules/.bin/tsx scripts/backend-registration-check.ts` against the local stack. It creates disposable accounts and verifies:

- Server-side password validation and malformed-email rejection.
- Actual Mailpit confirmation delivery, fragment-only token links and callback allowlisting.
- Unconfirmed sign-in denial, invalid token rejection and single-use confirmation.
- Password sign-in after confirmation and duplicate-registration handling without a new session.
- An empty independent notebook for a new account, cross-owner ledger/private-voucher denial and anonymous denial.

Disposable users, uploaded voucher and test confirmation messages are removed at the end. Do not run this script against a hosted project: it refuses nonlocal API and mail URLs.

The configuration was applied locally using `supabase stop` followed by `supabase start` without `--no-backup`. Existing ledger documents, revisions and timestamps matched their pre-restart snapshot exactly. No database reset or owner reseed was performed.

References: [Supabase signup](https://supabase.com/docs/reference/javascript/auth-signup), [CLI configuration](https://supabase.com/docs/guides/local-development/cli/config), [local email templates](https://supabase.com/docs/guides/local-development/customizing-email-templates), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates).
