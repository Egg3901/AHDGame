import type { WikiSeedPage } from "../types";
import { beta1Content } from "../content/beta1";
import { beta2Content } from "../content/beta2";

export const iterationsPages: readonly WikiSeedPage[] = [
  {
    slug: "beta-1",
    title: "Beta 1",
    description:
      "First numbered iteration of A House Divided after the spring 2026 wipe — four nations, twenty-one parties, and 621 turns of escalation.",
    content: beta1Content,
    category: "iterations",
    extraTags: ["history", "beta", "iteration"],
    featured: false,
    difficulty: "beginner",
    contentType: "reference",
    estimatedReadTime: 12,
  },
  {
    slug: "beta-2",
    title: "Beta 2",
    description:
      "The current iteration of A House Divided — seven playable nations on a 1991 Cold War map, a German exit from NATO, and a British declaration of war on China.",
    content: beta2Content,
    category: "iterations",
    extraTags: ["history", "beta", "iteration"],
    featured: false,
    difficulty: "beginner",
    contentType: "reference",
    estimatedReadTime: 14,
  },
];
