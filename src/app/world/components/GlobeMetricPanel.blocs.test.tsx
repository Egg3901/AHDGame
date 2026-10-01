import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import GlobeMetricPanel from "./GlobeMetricPanel";
import { buildBlocPalette } from "../worldBlocs";

describe("GlobeMetricPanel Bloc legend", () => {
  it("names a player-founded Bloc beside its selected color", () => {
    const markup = renderToStaticMarkup(
      <GlobeMetricPanel
        filter={{ type: "blocs" }}
        onFilterChange={() => undefined}
        availableCategories={[]}
        availableMetrics={{}}
        blocsAvailable
        blocPalette={buildBlocPalette([
          { poleId: "ORG:andes-pact", label: "Andes Pact", accentToken: "warning" },
        ])}
      />
    );

    expect(markup).toContain("Andes Pact");
    expect(markup).toContain("rgba(197, 139, 32, 0.78)");
  });
});
