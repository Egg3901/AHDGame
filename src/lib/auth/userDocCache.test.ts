import { afterEach, describe, expect, it, vi } from "vitest";
import type { User } from "@/lib/db/types";

const user = { username: "cached-user" } as User;

describe("userDocCache", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("caps cached documents and evicts the least recently used user", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.resetModules();
    const { getCachedUser, setCachedUser } = await import("./userDocCache");

    for (let index = 0; index < 3_000; index++) {
      setCachedUser(`user-${index}`, user);
    }

    expect(getCachedUser("user-0")).toBe(user);
    setCachedUser("user-3000", user);

    expect(getCachedUser("user-0")).toBe(user);
    expect(getCachedUser("user-1")).toBeUndefined();
    expect(getCachedUser("user-3000")).toBe(user);
  });
});
