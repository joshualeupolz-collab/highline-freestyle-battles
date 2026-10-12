# Deployment (Cloudflare, free tier)

The app runs as **one Cloudflare Worker**: it serves the web app as static files and the API under
`/api`. The database is Cloudflare D1. Publishing is automatic: every push to `main` runs
`.github/workflows/deploy.yml` (checks, tests, build, database migrations, deploy).

Everything below stays within the free tiers of Cloudflare and GitHub. Button and menu names in the
Cloudflare dashboard change from time to time; look for the closest match.

## One-time setup

### 1. Cloudflare

1. **Account:** sign up at <https://dash.cloudflare.com/sign-up> (free plan).
2. **Account ID:** in the dashboard, open *Workers & Pages*. The *Account ID* is shown in the right
   column (it is also the long hex string in the dashboard URL). Copy it.
3. **workers.dev subdomain:** still in *Workers & Pages*, set your `workers.dev` subdomain if asked
   (e.g. `highline`). The app will be at
   `https://highline-freestyle-battles.<subdomain>.workers.dev`.
4. **Database:** *Storage & Databases → D1 SQL Database → Create database*.
   Name: `hfb`. Location: *Western Europe* (data stays in the EU, GDPR). Copy the **Database ID**.
5. **API token** (lets GitHub publish the app): *My Profile → API Tokens → Create Token* →
   template **Edit Cloudflare Workers** → *Use template*. Add one permission:
   *Account → D1 → Edit*. Account resources: your account. Zone resources: *All zones*.
   *Continue → Create token*. Copy the token – it is shown only once.

### 2. GitHub

In the repository: *Settings → Secrets and variables → Actions*.

**Secrets** tab → *New repository secret*:

| Name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | the token from step 1.5 |
| `PASSWORD_PEPPER` | a long random text, at least 32 characters (e.g. from a password manager). **Never change it** once people have accounts – all passwords would stop working. Keep a copy somewhere safe. |
| `SETUP_TOKEN` | another random text. Whoever signs up with it becomes the first admin (only while no admin exists). |

**Variables** tab → *New repository variable*:

| Name | Value |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | the Account ID from step 1.2 |
| `D1_DATABASE_ID` | the Database ID from step 1.4 |

### 3. Publish

Merge the changes into `main`, or start it by hand: *Actions → Deploy → Run workflow*.
The run takes about two minutes. If a setting is missing, the step *Check configuration* says which.

### 4. First admin

Open `https://highline-freestyle-battles.<subdomain>.workers.dev/register?setup`, fill in the form
including the setup token, and sign up. This account is an approved admin. Then:

- approve new accounts under *Approvals*,
- on a phone: open the address in the browser and choose *Add to Home Screen* to install the app.

The `SETUP_TOKEN` has no effect once an admin exists; you may delete the secret.

## Videos (Cloudflare R2)

Videos are stored in the R2 bucket **`hfb-videos`** (location hint Western Europe). R2 is free up
to 10 GB of storage, 1 million uploads and 10 million downloads per month; downloads cost no
traffic fees. Activating R2 needs a payment method on the Cloudflare account, but nothing is
charged within these limits.

1. **Activate R2** once: *Storage & Databases → R2* (asks for the payment method).
2. **Bucket and CORS rules** are created by the deploy workflow (step *Video bucket and its CORS
   rules*). If that step fails with an authentication error, the API token from step 1.5 lacks
   R2 access: edit it and add *Account → Workers R2 Storage → Edit*.
   The CORS rules (`apps/api/r2-cors.json`) allow uploads from the app's address. **If you run
   the app under a different address, put it there.**
3. **R2 access key** (recommended): lets phones upload directly to R2 and play videos from there,
   so the bytes do not pass through the Worker. *Storage & Databases → R2 → Manage API tokens →
   Create Account API token* (or *User API token*): permission **Object Read & Write**, apply to
   the bucket **`hfb-videos`** only, no expiry. Copy the **Access Key ID** and the **Secret
   Access Key** (shown only once) into two GitHub secrets:

   | Name | Value |
   |---|---|
   | `R2_ACCESS_KEY_ID` | the Access Key ID |
   | `R2_SECRET_ACCESS_KEY` | the Secret Access Key |

   Then run the deploy again (*Actions → Deploy → Run workflow*).

Without the access key everything still works: videos go through the Worker instead, limited to
95 MB per video (Workers Free accepts at most 100 MB per request). The deploy run shows a warning
in that case.

## Push notifications

Push notifications (opponent accepted, videos unlocked, review needed, chat message) use Web
Push with a VAPID key pair. It is free; the pushes go through the browsers' push services (Google,
Apple, Mozilla) and carry no content – the app fetches the texts itself.

1. On a computer with Node.js, in a normal terminal (PowerShell: use `npx.cmd`):
   `npx web-push generate-vapid-keys` – it prints a public and a private key.
2. GitHub secrets: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:…` or the
   app's https address).
3. The next deployment passes them to the Worker. Never generate new keys afterwards: every
   device would have to turn notifications on again.

Without the keys the app works as before; the profile says that notifications are not set up.
On iPhones, push only works in the installed app (home screen).

## Rating replay

`.github/workflows/replay.yml` recalculates all ratings when a recalculation was requested
(Admin page → "Recalculate all ratings", or automatically after an out-of-order battle). It runs
daily and uses the same secrets and variables as the deployment; nothing extra to set up. To run
it at once: *Actions → Rating replay → Run workflow* (tick "force" to recalculate without a request).

## Later deployments

Nothing to do: every merge into `main` publishes automatically after all checks passed.
Database migrations in `db/migrations/` are applied before the new version goes live.

## Free-tier limits to keep an eye on

| Resource | Free limit | Note |
|---|---|---|
| Worker requests | 100,000 / day | only `/api/*` counts; app files are free |
| Worker CPU | ~10 ms per request | password hashing is the heaviest operation (see architecture.md) |
| D1 | 5 GB, 5 M rows read / 100 k written per day | |
| Cron trigger | free | hourly job for abandoned battles and unfinished uploads |
| R2 | 10 GB, 1 M uploads / 10 M downloads per month | *R2 → hfb-videos → Metrics*; deleting videos after the battle follows in step 12 |

The Cloudflare dashboard shows usage under *Workers & Pages → highline-freestyle-battles → Metrics*.
