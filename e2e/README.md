# E2E Tests (Playwright)

End-to-end tests for A House Divided. Run against a local dev server.

## Setup

1. Install Playwright browsers (first time only): `npx playwright install`
2. Start the dev server: `npm run dev`
3. In another terminal: `npm run test:e2e`

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

## Test Suites

| File                     | Purpose                                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke.spec.ts`          | Home, login, register, elections, congress load; login → dashboard                                                                                                                                                                                                                                                                              |
| `critical-flows.spec.ts` | Elections list, congress bills, logged-in navigation                                                                                                                                                                                                                                                                                            |
| `performance.spec.ts`    | Page load time budgets for public hubs (home, world, map, country US, forex, stock market, central bank, wiki, news, officials, parties, commodity) plus redirect targets (`/elections`, `/congress` → legislature, `/national` → metrics); Navigation Timing sanity checks; optional logged-in **portfolio** timing when `E2E_*` creds are set |

## CI

For CI, run with `E2E_TEST_EMAIL` and `E2E_TEST_PASSWORD` as secrets to execute login tests. Without them, smoke and critical-flow tests run but login tests are skipped.
