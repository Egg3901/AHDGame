import { describe, expect, it } from "vitest";
import { primaryMetrics } from "./catalog";
import {
  metricAggregationLabel,
  metricOwnerLabel,
  metricRefreshLabel,
  playerMetricDescription,
  playerMetricDescriptionIds,
} from "./presentation";

describe("reset metric player presentation", () => {
  it("authors readable drilldown copy for every primary metric", () => {
    expect(new Set(playerMetricDescriptionIds)).toEqual(
      new Set(primaryMetrics.map((row) => row.id))
    );
    for (const metric of primaryMetrics) {
      const description = playerMetricDescription(metric);
      expect(description.length).toBeGreaterThan(40);
      expect(description).not.toMatch(/[a-z][A-Z]/);
    }
  });

  it("translates internal measurement values into player language", () => {
    const unemployment = primaryMetrics.find((metric) => metric.id === "01")!;
    expect(playerMetricDescription(unemployment)).not.toContain("laborParticipation");
    expect(metricOwnerLabel(unemployment.owner)).toBe("Labor market");
    expect(metricRefreshLabel(unemployment.refresh)).toBe("Every year (48 turns)");
    expect(metricAggregationLabel(unemployment.aggregation)).toContain(
      "underlying people or events"
    );
  });
});
