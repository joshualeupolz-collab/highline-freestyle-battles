# Browser tests (`@hfb/e2e`)

End-to-end tests with [Playwright](https://playwright.dev): two "phones" (Chromium browser
contexts with a fake camera) use the real app against a local Worker – built PWA, API, D1 and R2
all local, nothing from Cloudflare is needed.

| Test | What it checks |
|---|---|
| `tests/video-battle.spec.ts` | open request → accept → record with the camera → one phone reserves and records offline, upload starts by itself when back online → choose the attempt → videos unlock and play → both vote → decided with margin |
| `tests/onsite.spec.ts` | on-site result entered by one side, confirmed by the other, both ratings change |
| `tests/signup.spec.ts` | sign-up in the app → waiting for approval → an athlete approves → the app opens |
| `tests/offline-reservation.spec.ts` | offline without reservation refused → reserve → record offline → a second device takes over (provisional) → the first device reports and hands back → the take-over attempt becomes valid |
| `tests/film-for-friend.spec.ts` | a friend films with the chosen athlete code, online and offline after preparing |

## Run

```bash
pnpm e2e                                   # builds the web app, then runs every test
pnpm --filter @hfb/e2e e2e video           # only tests whose file name contains "video" (no rebuild)
pnpm --filter @hfb/e2e e2e --headed        # watch the browser (needs a display)
```

The first time, install the browser: `pnpm --filter @hfb/e2e exec playwright install chromium`.
If a Chromium is already installed elsewhere, point to it instead:
`PW_CHROMIUM=/path/to/chrome pnpm e2e`.

Each run starts `wrangler dev` on port 8790 with an empty database in `e2e/.state/` (all
migrations applied) and creates the first admin in `global-setup.ts`. Every test creates its own
athletes through the API (`helpers.ts`), so tests do not depend on each other.

On failure, Playwright keeps a trace: `pnpm --filter @hfb/e2e exec playwright show-trace
e2e/test-results/<test>/trace.zip` shows every step with screenshots. In CI the traces are
uploaded as the artifact `playwright-report`.

## Writing a test

- Find elements the way a person does: `getByRole('button', { name: 'Accept' })`,
  `getByLabel(…)`, `getByText(…, { exact: true })` – the texts come from `apps/web/src/i18n.ts`.
- Confirmation dialogs (`window.confirm`) are accepted automatically (`phoneOf` in `helpers.ts`).
- Set up what is not under test through the API (`createAthlete`), not by clicking.
