import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAuthCookieOptions: vi.fn(async () => ({
    httpOnly: true,
    secure: false,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  })),
}));

type SetFn = (name: string, value: string, options: Record<string, unknown>) => void;

describe("setCharacterGateCookie", () => {
  let store: { set: ReturnType<typeof vi.fn<SetFn>> };

  beforeEach(() => {
    vi.clearAllMocks();
    store = { set: vi.fn<SetFn>() };
  });

  it('sets the hint to "1" with the auth cookie options when a character is needed', async () => {
    const { setCharacterGateCookie } = await import("./characterGateCookie");
    const { CHARACTER_GATE_COOKIE } = await import("./characterGate");

    await setCharacterGateCookie(store, true);

    expect(store.set).toHaveBeenCalledTimes(1);
    const [name, value, options] = store.set.mock.calls[0];
    expect(name).toBe(CHARACTER_GATE_COOKIE);
    expect(value).toBe("1");
    expect(options.path).toBe("/");
    expect(options.maxAge).toBeGreaterThan(0);
  });

  it("clears the hint (maxAge 0) when a character is no longer needed", async () => {
    const { setCharacterGateCookie } = await import("./characterGateCookie");
    const { CHARACTER_GATE_COOKIE } = await import("./characterGate");

    await setCharacterGateCookie(store, false);

    expect(store.set).toHaveBeenCalledTimes(1);
    const [name, value, options] = store.set.mock.calls[0];
    expect(name).toBe(CHARACTER_GATE_COOKIE);
    expect(value).toBe("");
    expect(options.maxAge).toBe(0);
  });
});
