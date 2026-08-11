import { getDb } from "../src/lib/mongodb";

async function checkElection() {
  const db = await getDb();

  const election = await db.collection("elections").findOne({
    electionType: "commons",
    status: "upcoming",
  });

  if (election) {
    const now = new Date();
    console.log("Election found:");
    console.log("Status:", election.status);
    console.log("StartTime:", election.startTime);
    console.log("EndTime:", election.endTime);
    console.log("PrimaryEndTime:", election.primaryEndTime);
    console.log("DurationHours:", election.durationHours);
    console.log("\nCurrent time:", now);
    console.log("StartTime is in future:", new Date(election.startTime) > now);
    console.log(
      "Hours until startTime:",
      ((new Date(election.startTime).getTime() - now.getTime()) / (1000 * 60 * 60)).toFixed(1)
    );
  } else {
    console.log("No upcoming commons election found");
  }

  process.exit(0);
}

checkElection();
