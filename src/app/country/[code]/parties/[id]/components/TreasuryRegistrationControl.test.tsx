import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/parties.json";
import { TreasuryRegistrationControl } from "./TreasuryRegistrationControl";
import type { PartyData } from "./types";

vi.mock("@/components/ui", () => ({ Slider: () => <input type="range" /> }));

describe("registration budget explanation", () => {
  it("describes live presence and does not promise an all-region estimate", () => {
    const html = renderToStaticMarkup(
      <NextIntlClientProvider locale="en" messages={messages}>
        <TreasuryRegistrationControl
          party={
            {
              expectedHourlyIncome: 1000,
              countryId: "UK",
              regionCount: 12,
              registrationBudgetPercent: 25,
            } as PartyData
          }
          registrationForm={{ percent: 25, saving: false }}
          dispatch={() => {}}
          onSave={() => {}}
        />
      </NextIntlClientProvider>
    );
    expect(html).toContain("local player, active NPP or regional officeholder");
    expect(html).toContain("Nothing is spent if no region can receive a boost");
    expect(html).not.toContain("all 12");
    expect(html).not.toContain("Est. registration / state");
  });
});
