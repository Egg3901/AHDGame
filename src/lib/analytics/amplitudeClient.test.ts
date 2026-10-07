import { beforeEach, describe, expect, it, vi } from "vitest";

const { init, setOptOut } = vi.hoisted(() => ({ init: vi.fn(), setOptOut: vi.fn() }));

vi.mock("@/components/CookieConsent", () => ({ getStoredConsent: () => "accepted" }));
vi.mock("@amplitude/analytics-browser", () => ({ init, setOptOut }));

describe("Amplitude client configuration", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_AMPLITUDE_API_KEY", "test-key");
    init.mockReset().mockReturnValue({ promise: Promise.resolve() });
    setOptOut.mockReset();
  });

  it("does not request unused remote configuration", async () => {
    const { getAmplitudeModule } = await import("./amplitudeClient");

    await getAmplitudeModule();

    expect(init).toHaveBeenCalledWith(
      "test-key",
      undefined,
      expect.objectContaining({
        autocapture: false,
        defaultTracking: false,
        fetchRemoteConfig: false,
      })
    );
  });
});
