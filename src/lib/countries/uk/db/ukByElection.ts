import type { Db } from "mongodb";
import type { UkCommonsVacancy, UkRecallPetition } from "@/lib/db/types/ukByElection";

export function getUkCommonsVacanciesCollection(db: Db) {
  return db.collection<UkCommonsVacancy>("ukCommonsVacancies");
}

export function getUkRecallPetitionsCollection(db: Db) {
  return db.collection<UkRecallPetition>("ukRecallPetitions");
}
