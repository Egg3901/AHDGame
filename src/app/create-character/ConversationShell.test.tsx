/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ConversationShell } from "./ConversationShell";
import { buildConversationSteps, type ConversationStepId } from "./conversationSteps";

/**
 * Player-flow harness: the shell owns progression while the parent owns every
 * answer, mirroring how the creator page will drive it. Completeness of the
 * middle step follows the same shape as the real name rule (2+ characters).
 */
function Harness() {
  const [answer, setAnswer] = useState("");

  const steps = buildConversationSteps({
    regionNoun: "state",
    rpgStatsEnabled: false,
    complete: {
      country: true,
      politician: answer.trim().length >= 2,
      region: true,
      compass: true,
      party: true,
      stats: false,
      review: true,
    },
    summary: {
      country: "United States",
      politician: answer.trim().length >= 2 ? answer.trim() : null,
      region: "California",
      compass: "Dead center",
      party: "Independent",
      stats: null,
      review: null,
    },
  });

  return (
    <ConversationShell
      steps={steps}
      renderStep={(id: ConversationStepId) =>
        id === "politician" ? (
          <input
            aria-label="Politician name"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
        ) : id === "review" ? (
          <>
            <p>{`Content for ${id}`}</p>
            {/* Mirrors production: the review step owns final submission
                (CandidateFile's submit), the shell never submits itself. */}
            <button type="submit">File character</button>
          </>
        ) : (
          <p>{`Content for ${id}`}</p>
        )
      }
    />
  );
}

function continueButton(): HTMLElement {
  return screen.getByRole("button", { name: /Continue|Review your file/ });
}

/** Walk forward until the review step renders (intermediate steps are complete). */
function advanceToReview(): void {
  for (let i = 0; i < 10; i++) {
    const reviewButton = screen.queryByRole("button", { name: "Review your file" });
    if (reviewButton) {
      fireEvent.click(reviewButton);
      return;
    }
    fireEvent.click(continueButton());
  }
  throw new Error("never reached the review step");
}

describe("ConversationShell player flow", () => {
  it("shows only the active step and gates Continue on completeness", () => {
    render(<Harness />);

    expect(screen.getByText("Content for country")).toBeTruthy();
    expect(screen.queryByText("Content for politician")).toBeNull();

    // Country is complete, so Continue advances to the politician step.
    fireEvent.click(continueButton());
    expect(screen.queryByText("Content for country")).toBeNull();
    expect(screen.getByLabelText("Politician name")).toBeTruthy();

    // Empty answer: Continue stays disabled under the 2+ character rule.
    expect(continueButton()).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("Politician name"), {
      target: { value: "Al" },
    });
    expect(continueButton()).toHaveProperty("disabled", false);
  });

  it("collects answered steps in an editable transcript", () => {
    render(<Harness />);
    fireEvent.click(continueButton());
    fireEvent.change(screen.getByLabelText("Politician name"), {
      target: { value: "Eleanor Vance" },
    });
    advanceToReview();

    expect(screen.getByText("Content for review")).toBeTruthy();
    // No Continue on the final step: review owns submission.
    expect(screen.queryByRole("button", { name: /Continue|Review your file/ })).toBeNull();

    const transcript = screen.getByRole("list", { name: "Your answers so far" });
    expect(transcript.textContent).toContain("United States");
    expect(transcript.textContent).toContain("Eleanor Vance");

    // Reopening an earlier answer lands back on its inputs.
    fireEvent.click(screen.getByRole("button", { name: "Edit Country" }));
    expect(screen.getByText("Content for country")).toBeTruthy();
  });

  it("editing an earlier answer never drops a later answer", () => {
    render(<Harness />);
    fireEvent.click(continueButton());
    fireEvent.change(screen.getByLabelText("Politician name"), {
      target: { value: "Eleanor Vance" },
    });
    advanceToReview();

    // Jump back to the first step, then forward again: the typed name survives
    // because answers live with the parent, not the shell.
    fireEvent.click(screen.getByRole("button", { name: "Edit Country" }));
    fireEvent.click(continueButton());
    expect(screen.getByLabelText("Politician name")).toHaveProperty("value", "Eleanor Vance");
  });

  it("keeps Back and the outer Back action reachable", () => {
    render(<Harness />);

    // On the first step there is no Back; the outer action is reachable.
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByRole("link", { name: "Back to dashboard" })).toBeTruthy();

    fireEvent.click(continueButton());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByText("Content for country")).toBeTruthy();
  });

  it("moves focus on step change but not on first render", () => {
    render(<Harness />);

    // A restored chat session must not yank focus past the page heading and
    // the flow toggle on load.
    expect(document.activeElement).not.toBe(screen.getByRole("heading", { name: "Country" }));

    fireEvent.click(continueButton());
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "The politician" }));
  });

  it("leaves final submission to the review step", () => {
    render(<Harness />);
    fireEvent.click(continueButton());
    fireEvent.change(screen.getByLabelText("Politician name"), {
      target: { value: "Eleanor Vance" },
    });
    advanceToReview();

    expect(screen.getByText("Content for review")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Continue|Review your file/ })).toBeNull();
    expect(screen.getByRole("button", { name: "File character" })).toBeTruthy();
  });

  it("opens any reached step directly from the stepper", () => {
    render(<Harness />);
    fireEvent.click(continueButton());
    fireEvent.change(screen.getByLabelText("Politician name"), {
      target: { value: "Al" },
    });
    advanceToReview();

    fireEvent.click(screen.getByRole("button", { name: "Go to The politician" }));
    expect(screen.getByLabelText("Politician name")).toBeTruthy();
  });
});
