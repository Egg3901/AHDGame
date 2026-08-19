import { afterAll, vi } from "vitest";

/**
 * Per-file teardown for globals stubbed with `vi.stubGlobal`.
 *
 * 11 of the 45 suites that stub global `fetch` never unstubbed it, so the stub
 * survived into whatever file vitest ran next and that file's own fetch mock
 * lost. It surfaced as `ExpandMarketModal` failing to find "Review California"
 * on PRs that touch none of this, while passing on its own.
 *
 * `afterAll` rather than `afterEach`: the boundary that leaked is the FILE, and
 * several suites deliberately stub once in `beforeAll` and rely on it across
 * their own tests. Clearing between tests would break those.
 */
afterAll(() => {
  vi.unstubAllGlobals();
});
