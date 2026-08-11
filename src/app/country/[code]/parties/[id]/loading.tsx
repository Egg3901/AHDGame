import { PartyPageSkeleton } from "./PartyPageSkeleton";

// Party detail is a large client page (party header, leadership, member roster,
// history). The shared skeleton keeps the shell visible during the segment
// load and is reused by the client page's own loading states.
export default function PartyLoading() {
  return <PartyPageSkeleton />;
}
