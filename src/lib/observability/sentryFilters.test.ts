import { describe, expect, it } from "vitest";

import { isValuelessNonErrorRejection, isMarketPollingTeardown } from "./sentryFilters";

describe("market polling teardown", () => {
  const teardown = () => ({
    exception: {
      values: [
        {
          type: "AbortError",
          value: "signal is aborted without reason",
          mechanism: { type: "auto.browser.global_handlers.onunhandledrejection" },
          stacktrace: {
            frames: [
              {
                filename:
                  "node_modules/next/dist/compiled/react-dom/cjs/react-dom-client.production.js",
                function: "commitHookEffectListUnmount",
              },
              {
                filename: "src/app/country/[code]/stockmarket/useExchangeQuotes.ts",
                function: "destroy",
                in_app: true,
              },
            ],
          },
        },
      ],
    },
  });

  it("recognizes the captured unmount cancellation in each market poller", () => {
    expect(isMarketPollingTeardown(teardown())).toBe(true);
    const chart = teardown();
    chart.exception.values[0].stacktrace.frames[1].filename =
      "src/app/country/[code]/stockmarket/components/MarketOverview.tsx";
    expect(isMarketPollingTeardown(chart)).toBe(true);
  });

  it("preserves timeouts, unexpected aborts and application failures", () => {
    for (const type of ["TimeoutError", "Error"]) {
      const event = teardown();
      event.exception.values[0].type = type;
      expect(isMarketPollingTeardown(event)).toBe(false);
    }
    const active = teardown();
    active.exception.values[0].stacktrace.frames[1].function = "refresh";
    expect(isMarketPollingTeardown(active)).toBe(false);
    const noUnmount = teardown();
    noUnmount.exception.values[0].stacktrace.frames.shift();
    expect(isMarketPollingTeardown(noUnmount)).toBe(false);
  });
});

describe("isValuelessNonErrorRejection", () => {
  it("drops the classic value: undefined rejection with no originalException", () => {
    expect(
      isValuelessNonErrorRejection(
        "Non-Error promise rejection captured with value: undefined",
        undefined
      )
    ).toBe(true);
  });

  it("drops the value: null and empty-value variants", () => {
    expect(
      isValuelessNonErrorRejection("Non-Error promise rejection captured with value: null", null)
    ).toBe(true);
    expect(
      isValuelessNonErrorRejection("Non-Error promise rejection captured with value:", undefined)
    ).toBe(true);
    expect(isValuelessNonErrorRejection("Non-Error promise rejection captured", undefined)).toBe(
      true
    );
  });

  it("tolerates surrounding whitespace", () => {
    expect(
      isValuelessNonErrorRejection(
        "  Non-Error promise rejection captured with value: undefined  ",
        undefined
      )
    ).toBe(true);
  });

  it("keeps a rejection that carries a real payload (has originalException)", () => {
    expect(
      isValuelessNonErrorRejection("Non-Error promise rejection captured with value: undefined", {
        some: "object",
      })
    ).toBe(false);
  });

  it("keeps a non-Error rejection whose reason stringifies to a real value", () => {
    expect(
      isValuelessNonErrorRejection(
        "Non-Error promise rejection captured with value: [object Object]",
        undefined
      )
    ).toBe(false);
    expect(
      isValuelessNonErrorRejection(
        "Non-Error promise rejection captured with value: Something broke",
        undefined
      )
    ).toBe(false);
  });

  it("keeps ordinary application errors", () => {
    expect(
      isValuelessNonErrorRejection("Cannot read properties of undefined (reading 'x')", undefined)
    ).toBe(false);
    expect(isValuelessNonErrorRejection("", undefined)).toBe(false);
  });
});
