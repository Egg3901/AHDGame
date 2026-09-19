import { describe, expect, it } from "vitest";
import { decorateAdTargets, groupAdTargets } from "./adTargets";

const PRESET = "1953-default";

/** Ticket 1314 screenshot: Wales first-cell buckets, then later cells. */
const WALES_SCREENSHOT_ORDER = [
  { dimension: "ethnicity", bucket: "white_british" },
  { dimension: "age", bucket: "mature" },
  { dimension: "education", bucket: "no_qualifications" },
  { dimension: "income", bucket: "middle" },
  { dimension: "urbanization", bucket: "suburban" },
  { dimension: "age", bucket: "mid" },
  { dimension: "income", bucket: "low" },
  { dimension: "urbanization", bucket: "rural" },
  { dimension: "age", bucket: "senior" },
  { dimension: "education", bucket: "gcse_equivalent" },
  { dimension: "urbanization", bucket: "urban" },
  { dimension: "education", bucket: "a_level_equivalent" },
  { dimension: "education", bucket: "degree_plus" },
  { dimension: "income", bucket: "high" },
  { dimension: "age", bucket: "young" },
] as const;

describe("targeted ad audience grouping", () => {
  it("groups the ticket 1314 Wales list by dimension in model order", () => {
    const grouped = groupAdTargets([...WALES_SCREENSHOT_ORDER], "UK", PRESET);
    expect(grouped.map((section) => section.dim)).toEqual([
      "ethnicity",
      "age",
      "education",
      "income",
      "urbanization",
    ]);
    expect(grouped.map((section) => section.dimLabel)).toEqual([
      "Background",
      "Age",
      "Education",
      "Income",
      "Where they live",
    ]);
    expect(
      grouped.flatMap((section) => section.options.map((option) => option.target.bucket))
    ).toEqual([
      "white_british",
      "young",
      "mid",
      "mature",
      "senior",
      "no_qualifications",
      "gcse_equivalent",
      "a_level_equivalent",
      "degree_plus",
      "low",
      "middle",
      "high",
      "urban",
      "suburban",
      "rural",
    ]);
    expect(grouped.find((section) => section.dim === "age")?.options.map((o) => o.label)).toEqual([
      "Under 30s",
      "30s and 40s",
      "50s and 60s",
      "Over 65s",
    ]);
  });

  it("keeps US census dimensions together in race, age, education, wealth order", () => {
    const shuffled = [
      { dimension: "wealth", bucket: "middle" },
      { dimension: "age", bucket: "mature" },
      { dimension: "education", bucket: "no_college" },
      { dimension: "race", bucket: "white" },
      { dimension: "age", bucket: "young" },
      { dimension: "wealth", bucket: "low" },
      { dimension: "race", bucket: "black" },
      { dimension: "education", bucket: "graduate" },
      { dimension: "wealth", bucket: "high" },
      { dimension: "age", bucket: "senior" },
      { dimension: "education", bucket: "college" },
      { dimension: "age", bucket: "mid" },
    ];
    expect(
      decorateAdTargets(shuffled, "US", PRESET).map(
        (target) => `${target.dimension}:${target.bucket}`
      )
    ).toEqual([
      "race:white",
      "race:black",
      "age:young",
      "age:mid",
      "age:mature",
      "age:senior",
      "education:no_college",
      "education:college",
      "education:graduate",
      "wealth:low",
      "wealth:middle",
      "wealth:high",
    ]);
  });

  it("still groups unknown-country leftovers by dimension instead of first-seen order", () => {
    const shuffled = [
      { dimension: "income", bucket: "middle" },
      { dimension: "age", bucket: "mature" },
      { dimension: "age", bucket: "young" },
      { dimension: "income", bucket: "low" },
    ];
    expect(
      decorateAdTargets(shuffled, "ZZ").map((target) => `${target.dimension}:${target.bucket}`)
    ).toEqual(["age:mature", "age:young", "income:low", "income:middle"]);
  });
});
