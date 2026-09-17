/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en/elections.json";
import { MoreCandidatesLink } from "./MoreCandidatesLink";

function show(candidateIds: string[], visibleIds: string[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <MoreCandidatesLink
        candidateIds={candidateIds}
        visibleIds={visibleIds}
        href="/elections/example?cycle=4"
      />
    </NextIntlClientProvider>
  );
}
describe("partial election summaries", () => {
  it("counts a zero-vote candidate omitted from a two-candidate summary", () => {
    show(["a", "b", "c"], ["a", "b"]);
    expect(screen.getByRole("link", { name: "+1 more candidate" }).getAttribute("href")).toBe(
      "/elections/example?cycle=4"
    );
  });
  it("deduplicates candidates across the roster and polling data", () => {
    show(["a", "b", "b", "c", "d"], ["a", "b", "historical"]);
    expect(screen.getByRole("link", { name: "+2 more candidates" })).toBeTruthy();
  });
  it("does not claim candidates are hidden when the complete field is shown", () => {
    show(["a", "b"], ["a", "b"]);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
