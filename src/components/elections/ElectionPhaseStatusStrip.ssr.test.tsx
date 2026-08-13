/**
 * SSR regression test for React #418 on /country/[code]/elections
 * (GlitchTip AHD-17C).
 *
 * The strip's absolute deadlines used to render via
 * `clock.formatAbsoluteDeadline` → `toLocaleString(undefined, …)`, whose
 * output depends on the host locale AND timezone — the server emitted one
 * string, the browser another, and hydration threw #418 once the elections
 * page became server-rendered. Deadlines must render through <LocalTime>,
 * whose SSR pass is a deterministic en-US/UTC string inside a <time> element.
 */
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { ElectionPhaseStatusStrip } from "./ElectionPhaseStatusStrip";
import { formatStableUtc } from "@/lib/time/localTime";
import enElections from "../../../messages/en/elections.json";

describe("ElectionPhaseStatusStrip SSR determinism (React #418 regression)", () => {
  it("server-renders absolute deadlines as <time> with the stable UTC string", () => {
    const endTime = "2026-07-15T04:00:00.000Z";
    const primaryEndTime = "2026-07-13T04:00:00.000Z";
    const html = renderToString(
      <NextIntlClientProvider locale="en" messages={enElections}>
        <ElectionPhaseStatusStrip
          phaseStatus={{
            status: "active",
            inPrimary: true,
            startTime: "2026-07-09T04:00:00.000Z",
            endTime,
            primaryEndTime,
            startTurn: null,
            endTurn: null,
            primaryEndTurn: null,
          }}
        />
      </NextIntlClientProvider>
    );

    // Deadlines come out as hydration-safe <time> elements…
    expect(html).toContain(`dateTime="${endTime}"`);
    expect(html).toContain(`dateTime="${primaryEndTime}"`);
    // …showing the deterministic locale-pinned UTC string on the SSR pass.
    expect(html).toContain(formatStableUtc(endTime));
    expect(html).toContain(formatStableUtc(primaryEndTime));
  });
});
