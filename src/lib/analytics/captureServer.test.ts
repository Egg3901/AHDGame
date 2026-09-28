import { afterEach, expect, it, vi } from "vitest";
import { captureServerProductEvent } from "./captureServer";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("sends a recovered lock event to both analytics destinations", async () => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
  vi.stubEnv("NEXT_PUBLIC_AMPLITUDE_API_KEY", "amp_test");
  const fetchMock = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchMock);

  await captureServerProductEvent("turn_lock_stuck", { lock_age_ms: 1200000, phase: "economy" });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][0]).toBe("https://us.i.posthog.com/i/v0/e/");
  const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
  expect(bodies[0]).toMatchObject({
    event: "turn_lock_stuck",
    properties: { lock_age_ms: 1200000, phase: "economy" },
  });
  expect(bodies[1]).toMatchObject({
    events: [{ event_type: "turn_lock_stuck", event_properties: { phase: "economy" } }],
  });
});

it("reports a rejected destination without suppressing the other", async () => {
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
  vi.stubEnv("NEXT_PUBLIC_AMPLITUDE_API_KEY", "amp_test");
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 400 })
    .mockResolvedValueOnce({ ok: true, status: 200 });
  vi.stubGlobal("fetch", fetchMock);
  const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

  await captureServerProductEvent("turn_lock_stuck", { lock_age_ms: 1200000 });

  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(warning).toHaveBeenCalledWith(
    expect.stringContaining("PostHog rejected turn_lock_stuck: 400")
  );
  warning.mockRestore();
});
