/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CandidateFile } from "./CandidateFile";
import type { PickedImage } from "./useImagePick";
import type { CompassPoint } from "@/lib/registration/alignment";

const noopImage: PickedImage = {
  file: null,
  previewUrl: null,
  error: null,
  pick: () => {},
  clear: () => {},
};

const REPORTED_MISMATCH: CompassPoint = { economic: 0.3, social: 1.2 };

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

describe("CandidateFile electorate lean display", () => {
  it("does not present the combined lean as the economic compass coordinate", () => {
    renderCandidateFile("Reported region", REPORTED_MISMATCH);
    expect(
      screen.getByText("Electoral lean: Center-Right. Economic: Centrist. Social: Center-Trad.")
    ).toBeTruthy();
  });
});
