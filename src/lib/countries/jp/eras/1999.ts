import type { CountryEraOverride } from "../../contract";

/**
 * Japan, 1999. Phase D3.
 *
 * ⚠️ DIFFERENCES ONLY. Everything not named here comes from the base modules.
 *
 * No config override: this era uses Japan's base configuration.
 */
export const JP_1999: CountryEraOverride = {
  preset: "1999-default",
  institutions: {
    military: {
      ordersOfBattle: [
        {
          branchId: "jgsdf",
          type: "Infantry Division",
          count: 5,
        },
        {
          branchId: "jgsdf",
          type: "Mechanized Brigade",
          count: 2,
        },
        {
          branchId: "jgsdf",
          type: "Artillery Regiment",
          count: 1,
        },
        {
          branchId: "jgsdf",
          type: "Air Defense Battalion",
          count: 2,
        },
        {
          branchId: "jmsdf",
          type: "Frigate Squadron",
          count: 4,
        },
        {
          branchId: "jmsdf",
          type: "Attack Submarine",
          count: 4,
        },
        {
          branchId: "jmsdf",
          type: "Guided-Missile Destroyer",
          count: 3,
        },
        {
          branchId: "jasdf",
          type: "Fighter Wing",
          count: 4,
        },
        {
          branchId: "jasdf",
          type: "Air Defense Wing",
          count: 2,
        },
        {
          branchId: "jasdf",
          type: "Airlift Wing",
          count: 1,
        },
      ],
    },
  },
};
