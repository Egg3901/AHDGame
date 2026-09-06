import { ConflictsGeneralToggle } from "./ConflictsGeneralToggle";
import { NppOffensivesToggles } from "./NppOffensivesToggles";
import { NppIntelligenceToggle } from "./NppIntelligenceToggle";
import { CreateColdWarConflictForm } from "./CreateColdWarConflictForm";

export function ConflictsManager() {
  return (
    <>
      <ConflictsGeneralToggle />
      <NppOffensivesToggles />
      <NppIntelligenceToggle />
      <CreateColdWarConflictForm />
    </>
  );
}
