import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { cookies, headers } from "next/headers";
import { clearAuthCookie } from "./auth";

vi.mock("@sentry/nextjs", () => ({ addBreadcrumb: vi.fn(), captureMessage: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock("@/lib/mongodb", () => ({ getDb: vi.fn() }));
vi.mock("@/lib/env", () => ({}));

const setCookie = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cookies).mockResolvedValue({ set: setCookie } as never);
  vi.mocked(headers).mockResolvedValue(new Headers() as never);
});

describe("auth cookie clear telemetry", () => {
  it.each(["auth_me:user_banned", "user_delete_account", "user_logout"])(
    "keeps expected account cleanup as a breadcrumb (%s)",
    async (reason) => {
      await clearAuthCookie(reason);
      expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
        expect.objectContaining({ data: { reason } })
      );
      expect(Sentry.captureMessage).not.toHaveBeenCalled();
      expect(setCookie).toHaveBeenCalledTimes(2);
      expect(setCookie.mock.calls[0][2]).toMatchObject({ maxAge: 0 });
    }
  );

  it("still reports a valid session with an unexpectedly missing account", async () => {
    await clearAuthCookie("auth_me:user_not_found");
    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      "Suspicious auth cookie clear (auth_me:user_not_found)",
      expect.objectContaining({ level: "warning" })
    );
  });
});
