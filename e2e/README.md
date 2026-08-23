# E2E Tests (Playwright)

End-to-end tests for A House Divided. Run against a local dev server.

## Setup

1. Install Playwright browsers (first time only): `npx playwright install`
2. Start the dev server: `npm run dev`
3. In another terminal: `npm run test:e2e`

Set `PLAYWRIGHT_BASE_URL` to test a server other than `http://localhost:3000`.

## Login Tests

Tests that require a logged-in user (e.g. dashboard, post-login navigation) are **skipped** unless credentials are provided:

- `E2E_TEST_EMAIL` — Email or username of a test account
- `E2E_TEST_PASSWORD` — Password for that account

Add these to `.env.local` to enable full E2E coverage:

```env
E2E_TEST_EMAIL=your-test-user@example.com
E2E_TEST_PASSWORD=your-test-password
```

Create a test account via the register page if needed. Login tests will skip with a clear message when these are unset.

The CDN privacy suite requires two isolated test accounts and a deployed URL:

```env
CACHE_PRIVACY_BASE_URL=https://sandbox.example.com
CACHE_PRIVACY_EMAIL_A=first-test-user@example.com
CACHE_PRIVACY_PASSWORD_A=first-test-password
CACHE_PRIVACY_EMAIL_B=second-test-user@example.com
CACHE_PRIVACY_PASSWORD_B=second-test-password
```

It alternates both sessions against identical private URLs, verifies that their
identities never cross, and confirms authenticated requests bypass otherwise
cacheable public responses.

## Test Suites

| File                     | Purpose                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke.spec.ts`          | Home, login, register, elections, congress load; login → dashboard                                                                                                                                                                                                                                                                              |
| `critical-flows.spec.ts` | Elections list, congress bills, logged-in navigation                                                                                                                                                                                                                                                                                            |
| `cache-privacy.spec.ts`  | Two-session CDN isolation, private-route bypass, and authenticated access to public-cache URLs                                                                                                                                                                                                                                                  |
| `performance.spec.ts`    | Page load time budgets for public hubs (home, world, map, country US, forex, stock market, central bank, wiki, news, officials, parties, commodity) plus redirect targets (`/elections`, `/congress` → legislature, `/national` → metrics); Navigation Timing sanity checks; optional logged-in **portfolio** timing when `E2E_*` creds are set |

## Automation

The current GitHub Actions workflows do not run Playwright. If you add these suites to another CI runner, provide `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD` as secrets to include login tests. Without them, the public smoke and critical-flow checks still run while login tests skip.
