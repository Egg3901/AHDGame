import { ConflictsGeneralToggle } from "./ConflictsGeneralToggle";
import { NppOffensivesToggles } from "./NppOffensivesToggles";
import { CreateColdWarConflictForm } from "./CreateColdWarConflictForm";

export function ConflictsManager() {
  return (
    <>
      <ConflictsGeneralToggle />
      <NppOffensivesToggles />
      <CreateColdWarConflictForm />
    </>
  );
}
