/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useConfirmDialog } from "../useConfirmDialog";

function Probe({ onResult }: { onResult: (value: boolean) => void }) {
  const { confirm, dialog } = useConfirmDialog();
  return (
    <>
      <button
        onClick={async () =>
          onResult(
            await confirm({
              title: "Enter this race?",
              message: "Registers you.",
              confirmLabel: "Enter race",
            })
          )
        }
      >
        open
      </button>
      {dialog}
    </>
  );
}

describe("useConfirmDialog", () => {
  it("never calls window.confirm, which embedded iOS webviews answer with false", async () => {
    const native = vi.fn(() => false);
    vi.stubGlobal("confirm", native);
    const onResult = vi.fn();
    render(<Probe onResult={onResult} />);
    fireEvent.click(screen.getByText("open"));
    fireEvent.click(await screen.findByRole("button", { name: "Enter race" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true));
    expect(native).not.toHaveBeenCalled();
    expect(screen.queryByText("Registers you.")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("resolves false on cancel", async () => {
    const onResult = vi.fn();
    render(<Probe onResult={onResult} />);
    fireEvent.click(screen.getByText("open"));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false));
  });
});
