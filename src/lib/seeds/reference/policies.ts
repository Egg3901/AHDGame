import type { Policy } from "@/lib/db/types";

export const policies: Policy[] = [
  {
    _id: "economic",
    name: "Economic Policy",
    description:
      "Position on economic issues including taxation, spending, regulation, and the role of government in the economy",
    category: "economic",
    positions: [
      {
        value: -5,
        label: "Extremely Left",
        description:
          "Heavy government intervention, wealth redistribution, nationalization of industries",
      },
      {
        value: -4,
        label: "Very Left",
        description:
          "Significant government regulation, high progressive taxes, expansive social programs",
      },
      {
        value: -3,
        label: "Left",
        description: "Strong safety net, moderate regulation, progressive taxation",
      },
      {
        value: -2,
        label: "Center-Left",
        description: "Support for social programs with some market-based solutions",
      },
      {
        value: -1,
        label: "Lean Left",
        description: "Moderate government involvement, balanced approach favoring workers",
      },
      {
        value: 0,
        label: "Centrist",
        description: "Balanced mix of free market and government intervention",
      },
      {
        value: 1,
        label: "Lean Right",
        description: "Moderate free market approach, limited regulation",
      },
      {
        value: 2,
        label: "Center-Right",
        description: "Pro-business policies with some social safety nets",
      },
      {
        value: 3,
        label: "Right",
        description: "Free market emphasis, lower taxes, reduced regulation",
      },
      {
        value: 4,
        label: "Very Right",
        description: "Minimal government intervention, significantly lower taxes",
      },
      {
        value: 5,
        label: "Extremely Right",
        description: "Laissez-faire economics, minimal taxation, privatization",
      },
    ],
  },
  {
    _id: "social",
    name: "Social Policy",
    description:
      "Position on social issues including civil liberties, cultural values, and individual freedoms",
    category: "social",
    positions: [
      {
        value: -5,
        label: "Extremely Left",
        description: "Progressive on all social issues, strong civil liberties focus",
      },
      {
        value: -4,
        label: "Very Left",
        description: "Very progressive, expansive civil rights, secular governance",
      },
      {
        value: -3,
        label: "Left",
        description: "Progressive values, strong support for social equality",
      },
      {
        value: -2,
        label: "Center-Left",
        description: "Moderately progressive, supports social reform",
      },
      { value: -1, label: "Lean Left", description: "Slightly progressive, open to social change" },
      { value: 0, label: "Centrist", description: "Balanced approach to social issues" },
      {
        value: 1,
        label: "Lean Right",
        description: "Slightly traditional, cautious about rapid change",
      },
      {
        value: 2,
        label: "Center-Right",
        description: "Moderately conservative, respects tradition",
      },
      {
        value: 3,
        label: "Right",
        description: "Traditional values, emphasis on family and community",
      },
      {
        value: 4,
        label: "Very Right",
        description: "Strongly traditional, religious influence on policy",
      },
      {
        value: 5,
        label: "Extremely Right",
        description: "Highly traditional, strong emphasis on law and order",
      },
    ],
  },
];

export default policies;
