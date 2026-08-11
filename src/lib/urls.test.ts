import { describe, it, expect } from "vitest";
import {
  regionUrl,
  regionLegislatureUrl,
  regionPartyUrl,
  regionMetricUrl,
  countryUrl,
  countryMapUrl,
  legislatureUrl,
  executiveUrl,
  cabinetUrl,
  countryElectionsUrl,
  electionRegionUrl,
  regionApiUrl,
  regionPartyApiUrl,
  legislatureApiUrl,
  executiveApiUrl,
  regionApiSubUrl,
  partiesUrl,
  partyUrl,
  coalitionUrl,
  politiciansUrl,
  metricsUrl,
  policyUrl,
  approvalUrl,
  budgetUrl,
  centralBankUrl,
  currencyCentralBankUrl,
  stockmarketUrl,
  partiesApiUrl,
  partyApiUrl,
  coalitionsApiUrl,
  coalitionApiUrl,
  politiciansApiUrl,
  metricsApiUrl,
  approvalApiUrl,
  policyApiUrl,
  socialAxisApiUrl,
  budgetApiUrl,
  centralBankApiUrl,
  congressMembersApiUrl,
  referendumsUrl,
  referendumDetailUrl,
} from "./urls";

describe("page URL helpers", () => {
  describe("regionUrl", () => {
    it("builds US region URL", () => {
      expect(regionUrl("US", "OR")).toBe("/country/us/region/OR");
    });
    it("builds UK region URL", () => {
      expect(regionUrl("UK", "SCO")).toBe("/country/uk/region/SCO");
    });
    it("builds CA region URL", () => {
      expect(regionUrl("CA", "ON")).toBe("/country/ca/region/ON");
    });
    it("builds DE region URL", () => {
      expect(regionUrl("DE", "BY")).toBe("/country/de/region/BY");
    });
    it("uppercases region code", () => {
      expect(regionUrl("UK", "sco")).toBe("/country/uk/region/SCO");
    });
  });

  describe("regionLegislatureUrl", () => {
    it("builds region legislature URL", () => {
      expect(regionLegislatureUrl("US", "OR")).toBe("/country/us/region/OR/legislature");
    });
  });

  describe("regionPartyUrl", () => {
    it("builds region party URL with number", () => {
      expect(regionPartyUrl("UK", "SCO", 4)).toBe("/country/uk/region/SCO/party/4");
    });
    it("builds region party URL with string", () => {
      expect(regionPartyUrl("US", "OR", "2")).toBe("/country/us/region/OR/party/2");
    });
  });

  describe("regionMetricUrl", () => {
    it("builds region metric URL", () => {
      expect(regionMetricUrl("DE", "BY", "economic", "gdp")).toBe(
        "/country/de/region/BY/metrics/economic/gdp"
      );
    });
  });

  describe("countryUrl", () => {
    it("builds country URL", () => {
      expect(countryUrl("US")).toBe("/country/us");
    });
  });

  describe("countryMapUrl", () => {
    it("builds country map URL", () => {
      expect(countryMapUrl("UK")).toBe("/country/uk/map");
    });
  });

  describe("legislatureUrl", () => {
    it("builds legislature URL", () => {
      expect(legislatureUrl("US")).toBe("/country/us/legislature");
    });
  });

  describe("executiveUrl", () => {
    it("builds executive URL", () => {
      expect(executiveUrl("US")).toBe("/country/us/executive");
    });
  });

  describe("cabinetUrl", () => {
    it("builds cabinet URL", () => {
      expect(cabinetUrl("UK")).toBe("/country/uk/executive/cabinet");
    });
  });

  describe("countryElectionsUrl", () => {
    it("builds country elections URL", () => {
      expect(countryElectionsUrl("UK")).toBe("/country/uk/elections");
    });
  });

  describe("electionRegionUrl", () => {
    it("builds election region URL", () => {
      expect(electionRegionUrl("abc123", "US", "OR")).toBe(
        "/elections/abc123/country/us/region/OR"
      );
    });
  });

  // Defensive: a caller higher up the tree may hand in undefined countryId
  // (e.g. a stale homeState payload that omits countryId). Render-path URL
  // helpers must never throw — that bubbles to global-error and shows a
  // "Critical Error" page when a user opens the navbar dropdown.
  describe("undefined-safety", () => {
    it("regionUrl tolerates undefined countryId", () => {
      expect(regionUrl(undefined as any, "WMI")).toBe("/country/us/region/WMI");
    });
    it("regionUrl tolerates undefined regionCode", () => {
      expect(regionUrl("UK", undefined as any)).toBe("/country/uk/region/");
    });
    it("regionPartyUrl tolerates undefined countryId", () => {
      expect(regionPartyUrl(undefined as any, "WMI", 1)).toBe("/country/us/region/WMI/party/1");
    });
    it("regionLegislatureUrl tolerates undefined countryId", () => {
      expect(regionLegislatureUrl(undefined as any, "WMI")).toBe(
        "/country/us/region/WMI/legislature"
      );
    });
    it("countryUrl tolerates undefined", () => {
      expect(countryUrl(undefined as any)).toBe("/country/us");
    });
    it("legislatureUrl tolerates undefined", () => {
      expect(legislatureUrl(undefined as any)).toBe("/country/us/legislature");
    });
    it("stockmarketUrl tolerates undefined", () => {
      expect(stockmarketUrl(undefined as any)).toBe("/country/us/stockmarket");
    });
  });
});

describe("API URL helpers", () => {
  describe("regionApiUrl", () => {
    it("builds US region API URL", () => {
      expect(regionApiUrl("US", "OR")).toBe("/api/country/us/region/OR");
    });
    it("builds UK region API URL", () => {
      expect(regionApiUrl("UK", "SCO")).toBe("/api/country/uk/region/SCO");
    });
  });

  describe("regionPartyApiUrl", () => {
    it("builds region party API URL", () => {
      expect(regionPartyApiUrl("UK", "SCO", 4)).toBe("/api/country/uk/region/SCO/party/4");
    });
  });

  describe("regionApiSubUrl", () => {
    it("builds region sub-resource API URL", () => {
      expect(regionApiSubUrl("US", "OR", "demographics")).toBe(
        "/api/country/us/region/OR/demographics"
      );
    });
    it("builds nested sub-resource API URL", () => {
      expect(regionApiSubUrl("US", "OR", "metrics/economic/gdp")).toBe(
        "/api/country/us/region/OR/metrics/economic/gdp"
      );
    });
    it("tolerates undefined countryId", () => {
      expect(regionApiSubUrl(undefined as any, "LON", "budget")).toBe(
        "/api/country/us/region/LON/budget"
      );
    });
  });

  describe("legislatureApiUrl", () => {
    it("builds legislature API URL", () => {
      expect(legislatureApiUrl("UK")).toBe("/api/country/uk/legislature");
    });
  });

  describe("executiveApiUrl", () => {
    it("builds executive API URL", () => {
      expect(executiveApiUrl("US")).toBe("/api/country/us/executive");
    });
  });
});

describe("page URL helpers (pass 2)", () => {
  it("partiesUrl", () => {
    expect(partiesUrl("US")).toBe("/country/us/parties");
    expect(partiesUrl("UK")).toBe("/country/uk/parties");
  });
  it("partyUrl", () => {
    expect(partyUrl("UK", 4)).toBe("/country/uk/parties/4");
    expect(partyUrl("US", "2")).toBe("/country/us/parties/2");
  });
  it("coalitionUrl", () => {
    expect(coalitionUrl("UK", "abc123")).toBe("/country/uk/parties/coalition/abc123");
  });
  it("politiciansUrl", () => {
    expect(politiciansUrl("US")).toBe("/country/us/politicians");
  });
  it("metricsUrl", () => {
    expect(metricsUrl("US")).toBe("/country/us/metrics");
    expect(metricsUrl("UK")).toBe("/country/uk/metrics");
  });
  it("policyUrl", () => {
    expect(policyUrl("UK")).toBe("/country/uk/policy");
  });
  it("approvalUrl", () => {
    expect(approvalUrl("US")).toBe("/country/us/approval");
  });
  it("budgetUrl", () => {
    expect(budgetUrl("UK")).toBe("/country/uk/budget");
  });
  it("centralBankUrl", () => {
    expect(centralBankUrl("US")).toBe("/centralbank/usd");
    expect(centralBankUrl("us")).toBe("/centralbank/usd");
    expect(centralBankUrl("DE")).toBe("/centralbank/eur");
    // IE has its own Central Bank of Ireland (IEP), not shared with DE's ECB.
    expect(centralBankUrl("IE")).toBe("/centralbank/iep");
    // Sterlingized SCO shares the UK's GBP bank page.
    expect(centralBankUrl("SCO")).toBe("/centralbank/gbp");
    // SUR members resolve to the shared Soviet-ruble page (anchor RU).
    expect(centralBankUrl("BLR")).toBe("/centralbank/sur");
  });
  it("currencyCentralBankUrl", () => {
    expect(currencyCentralBankUrl("USD")).toBe("/centralbank/usd");
    expect(currencyCentralBankUrl("EUR")).toBe("/centralbank/eur");
  });
  it("stockmarketUrl", () => {
    expect(stockmarketUrl("UK")).toBe("/country/uk/stockmarket");
  });
});

describe("API URL helpers (pass 2)", () => {
  it("partiesApiUrl", () => {
    expect(partiesApiUrl("US")).toBe("/api/country/us/parties");
  });
  it("partyApiUrl", () => {
    expect(partyApiUrl("UK", 4)).toBe("/api/country/uk/parties/4");
  });
  it("coalitionsApiUrl", () => {
    expect(coalitionsApiUrl("US")).toBe("/api/country/us/coalitions");
  });
  it("coalitionApiUrl", () => {
    expect(coalitionApiUrl("UK", "abc")).toBe("/api/country/uk/coalitions/abc");
  });
  it("politiciansApiUrl", () => {
    expect(politiciansApiUrl("US")).toBe("/api/country/us/politicians");
  });
  it("metricsApiUrl", () => {
    expect(metricsApiUrl("UK")).toBe("/api/country/uk/metrics");
  });
  it("approvalApiUrl", () => {
    expect(approvalApiUrl("US")).toBe("/api/country/us/approval");
  });
  it("policyApiUrl", () => {
    expect(policyApiUrl("UK")).toBe("/api/country/uk/policy");
  });
  it("socialAxisApiUrl", () => {
    expect(socialAxisApiUrl("CN")).toBe("/api/country/cn/social-axis");
  });
  it("budgetApiUrl", () => {
    expect(budgetApiUrl("US")).toBe("/api/country/us/budget/federal");
  });
  it("centralBankApiUrl", () => {
    expect(centralBankApiUrl("US")).toBe("/api/country/us/central-bank");
  });
  it("congressMembersApiUrl", () => {
    expect(congressMembersApiUrl("US")).toBe("/api/country/us/congress/members");
  });

  describe("referendum URLs", () => {
    it("referendumsUrl", () => {
      expect(referendumsUrl("UK")).toBe("/country/uk/referendums");
    });
    it("referendumDetailUrl without a cycle", () => {
      expect(referendumDetailUrl("UK", "NIR")).toBe("/country/uk/referendums/nir");
    });
    it("referendumDetailUrl with a cycle", () => {
      expect(referendumDetailUrl("UK", "NIR", 2)).toBe("/country/uk/referendums/nir?cycle=2");
    });
  });
});
