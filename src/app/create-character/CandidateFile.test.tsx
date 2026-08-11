/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CandidateFile } from "./CandidateFile";
import type { PickedImage } from "./useImagePick";
import type { CompassPoint } from "@/lib/registration/alignment";

/**
 * Regression coverage for the same "electorate lean flattens across every
 * region" defect fixed in HomeStatePicker.tsx: the "Distance to <region>
 * voters" verdict line rendered `getLeanLabel(electorate.economic)` directly,
 * so — since the 1953 UK Layer-1 model keeps `cachedEconomicLean` negative and
 * `cachedSocialLean` positive in EVERY region by construction (only the
 * magnitude of the social axis decides which axis dominates) — the detail
 * sentence read identically "Center-Left / Center-Trad" for every region
 * regardless of true lean. It now uses `getDisplayLean` for the headline word,
 * matching HomeStatePicker.
 */
const noopImage: PickedImage = {
  file: null,
  previewUrl: null,
  error: null,
  pick: () => {},
  clear: () => {},
};

// Real seed-derived values queried from the 1953-default world: London is
// Labour-held in 1951 (-1.49 econ / 0.61 social); the South East is a
// historically Tory Home Counties shire (-0.53 econ / 0.69 social) — same
// sign on both axes as every other UK region, differing only by which axis's
// magnitude wins.
const LON: CompassPoint = { economic: -1.49, social: 0.61 };
const SEE: CompassPoint = { economic: -0.53, social: 0.69 };

function renderCandidateFile(regionName: string, electorate: CompassPoint) {
  return render(
    <CandidateFile
      name="Test Candidate"
      countryName="United Kingdom"
      countryFlagUrl={null}
      regionName={regionName}
      electorate={electorate}
      partyName={null}
      partyAbbreviation={null}
      partyColor={null}
      partyId={null}
      partyCountryId={null}
      partyPoint={null}
      position={{ economic: 0, social: 0 }}
      demographics={{ race: "", gender: "", education: "", wealth: "" }}
      startingCapital={null}
      requirements={[]}
      isSubmitting={false}
      portrait={noopImage}
      header={noopImage}
    />
  );
}

describe("CandidateFile — UK 1953 electorate lean display", () => {
  it("does not collapse every electorate to the same lean sentence", () => {
    const { unmount } = renderCandidateFile("London", LON);
    expect(screen.getByText(/That electorate sits Center-Left \/ Center-Trad\./)).toBeTruthy();
    unmount();

    renderCandidateFile("South East England", SEE);
    // Previously this also rendered "Center-Left / Center-Trad" because the
    // sentence used the raw (always-negative) economic value directly. The
    // dominant axis here is social (0.69 > 0.53), which is positive, so the
    // headline word must now flip to "Center-Right".
    expect(screen.getByText(/That electorate sits Center-Right \/ Center-Trad\./)).toBeTruthy();
  });
});
