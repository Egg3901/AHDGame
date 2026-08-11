import { describe, expect, it } from "vitest";

import { isValuelessNonErrorRejection } from "./sentryFilters";

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
