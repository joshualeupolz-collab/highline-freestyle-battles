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

## Later deployments

Nothing to do: every merge into `main` publishes automatically after all checks passed.
Database migrations in `db/migrations/` are applied before the new version goes live.

## Free-tier limits to keep an eye on

| Resource | Free limit | Note |
|---|---|---|
| Worker requests | 100,000 / day | only `/api/*` counts; app files are free |
| Worker CPU | ~10 ms per request | password hashing is the heaviest operation (see architecture.md) |
| D1 | 5 GB, 5 M rows read / 100 k written per day | |
| Cron trigger | free | hourly job for abandoned battles |

The Cloudflare dashboard shows usage under *Workers & Pages → highline-freestyle-battles → Metrics*.
