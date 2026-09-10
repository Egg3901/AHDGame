/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../messages/en/elections.json";
import { CanvassingPanel } from "./CanvassingPanel";
vi.mock("@/contexts/CurrencyContext", () => ({
  useCurrency: () => ({ formatFull: (n: number) => `₳${n}` }),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("preserves a selected US ideology category when the census preview arrives", async () => {
  let finishPreview!: (response: unknown) => void;
  const pending = new Promise((resolve) => {
    finishPreview = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url.endsWith("/eligibility")
        ? Promise.resolve({
            ok: true,
            json: async () => ({ ok: true, stateId: "GA", source: "home" }),
          })
        : pending
    )
  );
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <CanvassingPanel countryId="US" />
    </NextIntlClientProvider>
  );
  const category = (await screen.findByRole("combobox")) as HTMLSelectElement;
  fireEvent.change(category, { target: { value: "ideology" } });
  finishPreview({
    ok: true,
    json: async () => ({
      stateId: "GA",
      targets: [
        { dimension: "race", bucket: "white" },
        { dimension: "income", bucket: "middle" },
      ],
      preview: null,
    }),
  });
  await screen.findByRole("option", { name: "income" });
  expect(category.value).toBe("ideology");
  expect([...category.options].map((option) => option.value)).toContain("ideology");
});

describe("country target vocabulary", () => {
  it.each(["UK", "JP", "DE", "IE", "CN", "BR", "DD"])(
    "unions %s voter groups with native census dimensions",
    async (countryId) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string) => ({
          ok: true,
          json: async () =>
            url.endsWith("/eligibility")
              ? { ok: true, stateId: "region", source: "home" }
              : {
                  stateId: "region",
                  targets: [{ dimension: "education", bucket: "tertiary" }],
                  preview: null,
                },
        }))
      );
      render(
        <NextIntlClientProvider locale="en" messages={messages}>
          <CanvassingPanel countryId={countryId} />
        </NextIntlClientProvider>
      );
      await screen.findByRole("option", { name: "education" });
      const categories = screen.getAllByRole("combobox")[0] as HTMLSelectElement;
      expect([...categories.options].map((option) => option.value)).toContain(
        `${countryId.toLowerCase()}_voterGroups`
      );
      expect([...categories.options].map((option) => option.value)).toContain("education");
    }
  );
});
