import { describe, expect, it } from "vitest";
import {
  JP_PUBLIC_CORPORATION_OID,
  JP_PUBLIC_CEO_OID,
  JP_PUBLIC_USER_OID,
  JP_PUBLIC_SEQUENTIAL_ID,
} from "./jp/jpCorporations";
import {
  DE_PUBLIC_CORPORATION_OID,
  DE_PUBLIC_CEO_OID,
  DE_PUBLIC_USER_OID,
  DE_PUBLIC_SEQUENTIAL_ID,
} from "./de/deCorporations";
import {
  IE_PUBLIC_CORPORATION_OID,
  IE_PUBLIC_CEO_OID,
  IE_PUBLIC_USER_OID,
  IE_PUBLIC_SEQUENTIAL_ID,
} from "./ie/ieCorporations";
import {
  BR_PUBLIC_CORPORATION_OID,
  BR_PUBLIC_CEO_OID,
  BR_PUBLIC_USER_OID,
  BR_PUBLIC_SEQUENTIAL_ID,
} from "./br/brCorporations";
import {
  CN_PUBLIC_CORPORATION_OID,
  CN_PUBLIC_CEO_OID,
  CN_PUBLIC_USER_OID,
  CN_PUBLIC_SEQUENTIAL_ID,
} from "./cn/cnCorporations";
import {
  NG_PUBLIC_CORPORATION_OID,
  NG_PUBLIC_CEO_OID,
  NG_PUBLIC_USER_OID,
  NG_PUBLIC_SEQUENTIAL_ID,
} from "./ng/ngCorporations";

// One spec per seeded sovereign issuer. Each country's corporation/CEO/user
// ObjectIds and reserved sequentialId must be globally unique — a duplicate
// upserts one country's sovereign corporation over another's at seed time,
// orphaning the clobbered country's nationalized sectors (Nigeria reused
// China's …061 block + 900_007, wiping out China's NatCorp on live).
const SOVEREIGN_ISSUERS = [
  {
    countryId: "JP",
    corp: JP_PUBLIC_CORPORATION_OID,
    ceo: JP_PUBLIC_CEO_OID,
    user: JP_PUBLIC_USER_OID,
    seq: JP_PUBLIC_SEQUENTIAL_ID,
  },
  {
    countryId: "DE",
    corp: DE_PUBLIC_CORPORATION_OID,
    ceo: DE_PUBLIC_CEO_OID,
    user: DE_PUBLIC_USER_OID,
    seq: DE_PUBLIC_SEQUENTIAL_ID,
  },
  {
    countryId: "IE",
    corp: IE_PUBLIC_CORPORATION_OID,
    ceo: IE_PUBLIC_CEO_OID,
    user: IE_PUBLIC_USER_OID,
    seq: IE_PUBLIC_SEQUENTIAL_ID,
  },
  {
    countryId: "BR",
    corp: BR_PUBLIC_CORPORATION_OID,
    ceo: BR_PUBLIC_CEO_OID,
    user: BR_PUBLIC_USER_OID,
    seq: BR_PUBLIC_SEQUENTIAL_ID,
  },
  {
    countryId: "CN",
    corp: CN_PUBLIC_CORPORATION_OID,
    ceo: CN_PUBLIC_CEO_OID,
    user: CN_PUBLIC_USER_OID,
    seq: CN_PUBLIC_SEQUENTIAL_ID,
  },
  {
    countryId: "NG",
    corp: NG_PUBLIC_CORPORATION_OID,
    ceo: NG_PUBLIC_CEO_OID,
    user: NG_PUBLIC_USER_OID,
    seq: NG_PUBLIC_SEQUENTIAL_ID,
  },
];

describe("sovereign issuer seed identifiers", () => {
  it("assigns every country a globally unique ObjectId across corp/ceo/user", () => {
    const allOids = SOVEREIGN_ISSUERS.flatMap((s) => [s.corp, s.ceo, s.user]);
    const dupes = allOids.filter((oid, i) => allOids.indexOf(oid) !== i);
    expect(dupes).toEqual([]);
    expect(new Set(allOids).size).toBe(allOids.length);
  });

  it("assigns every country a unique reserved sequentialId", () => {
    const seqs = SOVEREIGN_ISSUERS.map((s) => s.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });
});
