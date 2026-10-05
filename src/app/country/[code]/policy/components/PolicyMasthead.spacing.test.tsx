// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PolicyMasthead } from "./PolicyMasthead";

// Round-three walkthrough reported "114statutes·12titles". The rendered DOM
// keeps the spaces; the report came from joining trimmed text nodes.
describe("PolicyMasthead count chip spacing", () => {
  it("renders the statute and title counts with their spaces", () => {
    const { container } = render(
      <PolicyMasthead
        countryId="US"
        statuteCount={114}
        titleCount={12}
        lastEnactedStamp={null}
        axes={null}
        view="code"
        onViewChange={() => {}}
      />
    );
    expect(container.textContent).toContain("114 statutes · 12 titles");
  });
});
