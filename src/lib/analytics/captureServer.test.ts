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
  const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
  expect(bodies[0]).toMatchObject({
    event: "turn_lock_stuck",
    properties: { lock_age_ms: 1200000, phase: "economy" },
  });
  expect(bodies[1]).toMatchObject({
    events: [{ event_type: "turn_lock_stuck", event_properties: { phase: "economy" } }],
  });
});
