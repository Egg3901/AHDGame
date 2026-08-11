import type { Db } from "mongodb";
import type {
  GovernmentFormation,
  PMAppointmentVote,
  NoConfidenceVote,
} from "@/lib/db/types/governmentFormation";

export function getGovernmentFormationsCollection(db: Db) {
  return db.collection<GovernmentFormation>("governmentFormations");
}

export function getPMAppointmentVotesCollection(db: Db) {
  return db.collection<PMAppointmentVote>("pmAppointmentVotes");
}

export function getNoConfidenceVotesCollection(db: Db) {
  return db.collection<NoConfidenceVote>("noConfidenceVotes");
}
