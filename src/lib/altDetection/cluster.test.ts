import { describe, it, expect } from "vitest";
import { ObjectId } from "mongodb";
import type { AltLink, AltLinkSignal } from "@/lib/db/types/altDetection";
import { buildAltClusters } from "./cluster";

const NOW = new Date("2026-07-20T12:00:00Z");

function sig(
  overrides: Partial<AltLinkSignal> & Pick<AltLinkSignal, "type" | "weight">
): AltLinkSignal {
  return {
    contribution: overrides.weight,
    evidence: `${overrides.type} evidence`,
    detectedAt: NOW,
    ...overrides,
  };
}

function link(a: ObjectId, b: ObjectId, confidence: number, signals: AltLinkSignal[]): AltLink {
  const [userA, userB] = a.toString() <= b.toString() ? [a, b] : [b, a];
  return { _id: new ObjectId(), userA, userB, confidence, signals, updatedAt: NOW, turn: 100 };
}

describe("buildAltClusters — jbm-shaped ring", () => {
  const operator = new ObjectId();
  const burner1 = new ObjectId();
  const burner2 = new ObjectId();
  const associate = new ObjectId();

  // Two strong direct-evidence edges from the operator to its burners (shared
  // device fingerprint / device key), plus one weak, circumstantial-only edge
  // to a fourth account. The weak pair remains available in altLinks but must
  // not expand the reviewable ring.
  const edges: AltLink[] = [
    link(operator, burner1, 0.95, [sig({ type: "device_fingerprint_exact", weight: 0.95 })]),
    link(operator, burner2, 0.93, [sig({ type: "deviceKey_exact", weight: 0.93 })]),
    link(operator, associate, 0.3, [sig({ type: "email_pattern_family", weight: 0.3 })]),
  ];

  it("reconstructs the strong connected-component ring from the edges", () => {
    const clusters = buildAltClusters(edges, { turn: 100 });
    expect(clusters).toHaveLength(1);
    const [cluster] = clusters;
    expect(cluster.size).toBe(3);
    const memberStrings = cluster.memberUserIds.map((id) => id.toString()).sort();
    expect(memberStrings).toEqual([operator, burner1, burner2].map((id) => id.toString()).sort());
  });

  it("names the operator as the highest strong-degree node", () => {
    const [cluster] = buildAltClusters(edges, { turn: 100 });
    expect(cluster.roles.operator?.toString()).toBe(operator.toString());
  });

  it("classifies the strongly-linked accounts as burners", () => {
    const [cluster] = buildAltClusters(edges, { turn: 100 });
    const burnerStrings = cluster.roles.burners.map((id) => id.toString()).sort();
    expect(burnerStrings).toEqual([burner1, burner2].map((id) => id.toString()).sort());
  });

  it("keeps a weakly-linked account out of the reviewable ring", () => {
    const [cluster] = buildAltClusters(edges, { turn: 100 });
    const memberStrings = cluster.memberUserIds.map((id) => id.toString());
    expect(memberStrings).not.toContain(associate.toString());
    expect(cluster.roles.burners.map((id) => id.toString())).not.toContain(associate.toString());
  });

  it("ring confidence is the mean of the strong edges (0.95, 0.93), not diluted by the weak edge", () => {
    const [cluster] = buildAltClusters(edges, { turn: 100 });
    expect(cluster.confidence).toBeCloseTo((0.95 + 0.93) / 2, 10);
  });

  it("rolls up a signal summary and top evidence across the ring's edges", () => {
    const [cluster] = buildAltClusters(edges, { turn: 100 });
    const types = cluster.signalSummary.map((s) => s.type).sort();
    expect(types).toEqual(["deviceKey_exact", "device_fingerprint_exact"].sort());
    expect(cluster.topEvidence.length).toBeGreaterThan(0);
    expect(cluster.topEvidence.length).toBeLessThanOrEqual(5);
  });

  it("defaults new clusters to status 'open' with the given turn stamped", () => {
    const [cluster] = buildAltClusters(edges, { turn: 100 });
    expect(cluster.status).toBe("open");
    expect(cluster.turn).toBe(100);
  });
});

describe("buildAltClusters — thresholds and edge cases", () => {
  it("drops edges below the link threshold entirely (no cluster formed)", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const clusters = buildAltClusters([
      link(a, b, 0.1, [sig({ type: "referral_link", weight: 0.1 })]),
    ]);
    expect(clusters).toHaveLength(0);
  });

  it("does not surface a cluster made only of weak edges", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const c = new ObjectId();
    const edges = [
      link(a, b, 0.4, [sig({ type: "email_pattern_family", weight: 0.4 })]),
      link(b, c, 0.35, [sig({ type: "ip_exact_nonCF", weight: 0.35 })]),
    ];
    expect(buildAltClusters(edges)).toHaveLength(0);
  });

  it("respects custom tuned topology thresholds", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const edges = [link(a, b, 0.5, [sig({ type: "wire_graph_link", weight: 0.5 })])];
    expect(buildAltClusters(edges, { thresholds: { link: 0.6, strongLink: 0.4 } })).toHaveLength(0);
    expect(buildAltClusters(edges, { thresholds: { link: 0.4, strongLink: 0.4 } })).toHaveLength(1);
  });

  it("separates two independent pairs into two clusters", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const c = new ObjectId();
    const d = new ObjectId();
    const edges = [
      link(a, b, 0.9, [sig({ type: "device_fingerprint_exact", weight: 0.9 })]),
      link(c, d, 0.9, [sig({ type: "deviceKey_exact", weight: 0.9 })]),
    ];
    const clusters = buildAltClusters(edges);
    expect(clusters).toHaveLength(2);
  });

  it("does not merge strong rings through a weak transitive bridge", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const c = new ObjectId();
    const d = new ObjectId();
    const edges = [
      link(a, b, 0.95, [sig({ type: "device_fingerprint_exact", weight: 0.95 })]),
      link(c, d, 0.93, [sig({ type: "deviceKey_exact", weight: 0.93 })]),
      link(b, c, 0.3, [sig({ type: "behavioral_similarity", weight: 0.3 })]),
    ];

    const clusters = buildAltClusters(edges);

    expect(clusters).toHaveLength(2);
    expect(clusters.map((cluster) => cluster.size)).toEqual([2, 2]);
  });

  it("returns clusters sorted by confidence descending", () => {
    const a = new ObjectId();
    const b = new ObjectId();
    const c = new ObjectId();
    const d = new ObjectId();
    const e = new ObjectId();
    const f = new ObjectId();
    const edges = [
      link(a, b, 0.85, [sig({ type: "email_pattern_family", weight: 0.85 })]),
      link(c, d, 0.9, [sig({ type: "device_fingerprint_exact", weight: 0.9 })]),
      link(e, f, 0.82, [sig({ type: "ip_exact_nonCF", weight: 0.82 })]),
    ];
    const clusters = buildAltClusters(edges);
    const confidences = clusters.map((c) => c.confidence);
    expect(confidences).toEqual([...confidences].sort((x, y) => y - x));
  });
});
