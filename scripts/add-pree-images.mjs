// One-shot: insert a verified Unsplash `image` field after the `kind:` line
// for every PREE seed definition. Every photo ID below has been HEAD-verified
// to resolve on images.unsplash.com. Run: node scripts/add-pree-images.mjs
import { readFileSync, writeFileSync } from "node:fs";

const U = (id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=1200&q=70`;

// kind -> unsplash photo id (all verified resolving + unique across the set)
const MAP = {
  // ── global (seedDefinitions.ts) ──
  "pree.lotteryWin": "photo-1599946347371-68eb71b16afc",
  "pree.stafferScandal": "photo-1520525003249-2b9cdda513bc",
  "pree.campaignViral": "photo-1595798896730-9fdf2e709649",
  "pree.corruptDonor": "photo-1566404791232-af9fe0ae8f8b",
  "pree.ceoWhistleblower": "photo-1602743297108-4c9061884285",
  "pree.taxAudit": "photo-1542744173-8e7e53415bb0",
  "pree.oldFriendVenture": "photo-1454165804606-c3d57bc86b40",
  "pree.memoirOffer": "photo-1504384308090-c894fdcc538d",
  "pree.townHallAmbush": "photo-1520452112805-c6692c840af0",
  "pree.endorsementDilemma": "photo-1594581979864-36977b15d0dc",
  "pree.debateGaffe": "photo-1764874299006-bf4266427ec9",
  "pree.productRecall": "photo-1497015289639-54688650d173",
  "pree.insiderTip": "photo-1611974789855-9c2a0a7236a3",
  "pree.charityGala": "photo-1540574163026-643ea20ade25",
  "pree.localInterview": "photo-1496247749665-49cf5b1022e9",
  "pree.speakingFee": "photo-1774025395295-6d5f23f272bd",
  "pree.juryDuty": "photo-1518688248740-7c31f1a945c4",
  "pree.ribbonCutting": "photo-1505373877841-8d25f7d46678",
  "pree.constituentLetters": "photo-1455390582262-044cdead277a",
  "pree.partyFundraiser": "photo-1531058020387-3be344556be6",
  "pree.earningsCall": "photo-1554224154-26032ffc0d07",
  "pree.employeeMorale": "photo-1557804506-e969d7b32a4b",
  "pree.vendorRenewal": "photo-1503676260728-1c00da094a0b",
  "pree.canvassWeekend": "photo-1521587760476-6c12a4b040da",
  "pree.yardSignDrive": "photo-1570941144223-7e4f5d0624ee",
  "pree.minorityStrategyPressure": "photo-1607778417094-1fef13315e6e",
  "pree.minorityExpansionDemand": "photo-1536181783029-1097aaf179de",
  "pree.minorityExtractionObjection": "photo-1554007460-791a7b8945d8",
  "pree.boardroomUltimatum": "photo-1450101499163-c8848c66ca85",
  // ── country (countryDefinitions.ts) ──
  "pree.us.classAction": "photo-1715520928476-cd350276d96e",
  "pree.us.goFundMe": "photo-1597932552386-ad91621e4c8a",
  "pree.us.secComment": "photo-1554224155-6726b3ff858f",
  "pree.us.plantClosure": "photo-1497015455546-1da71faf8d06",
  "pree.us.filibuster": "photo-1611010638643-051de75362ff",
  "pree.us.primetimeTownHall": "photo-1770097320291-08fc5ba9f7d7",
  "pree.uk.ulez": "photo-1513635269975-59663e0ac1ad",
  "pree.uk.pubBuyout": "photo-1529655683826-aba9b3e77383",
  "pree.uk.cmaProbe": "photo-1526129318478-62ed807ebdf9",
  "pree.uk.selectCommittee": "photo-1607778102165-6a418ee9adf2",
  "pree.uk.pmqs": "photo-1607778413290-6bc9b4cf30f1",
  "pree.uk.threeLineWhip": "photo-1610026378085-15d0e8f685db",
  "pree.jp.furusatoNozei": "photo-1513407030348-c983a97b98d8",
  "pree.jp.bosaiDrill": "photo-1545569341-9eb8b30979d9",
  "pree.jp.keiretsu": "photo-1540959733332-eab4deabeeaf",
  "pree.jp.sokaiya": "photo-1604928141064-207cea6f571f",
  "pree.jp.koenkai": "photo-1526481280693-3bfa7568e0f3",
  "pree.jp.nhkDebate": "photo-1480796927426-f609979314bd",
  "pree.de.autobahnAccident": "photo-1593115057322-e94b77572f20",
  "pree.de.schrebergarten": "photo-1416879595882-3373a0480b5b",
  "pree.de.kartellamt": "photo-1636652966850-5ac4d02370e9",
  "pree.de.factoryRestructure": "photo-1649709253652-5aa6623ca4cc",
  "pree.de.bundestagSpeech": "photo-1603644448048-28a7e5122f0a",
  "pree.de.talkshow": "photo-1717386255773-1e3037c81788",
  // ── "everyday" events (seedDefinitions.ts, after boardroomUltimatum) ──
  "pree.lostWallet": "photo-1587330979470-3595ac045ab0",
  "pree.highSchoolReunion": "photo-1527525443983-6e60c75fff46",
  "pree.fenceDispute": "photo-1533929736458-ca588d08c8be",
  "pree.volunteerFirefighter": "photo-1579772330569-945775ca97ca",
  "pree.podcastInvite": "photo-1610891015188-5369212db097",
  "pree.annualCheckup": "photo-1531431199010-1f9985f83baa",
  "pree.almaMaterCall": "photo-1653410772359-0ef817e04207",
  "pree.repairMixup": "photo-1561491431-71b89da6056a",
  "pree.communityGarden": "photo-1609051589207-264fb1f91000",
  "pree.propertyReassessment": "photo-1506501139174-099022df5260",
  "pree.parkingTicket": "photo-1520986606214-8b456906c813",
  "pree.lostDogReward": "photo-1612349317150-e413f6a5b16d",
  "pree.civicAwardNomination": "photo-1711895834951-fc4020e20b05",
  "pree.paradeMarshal": "photo-1515150144380-bca9f1650ed9",
  "pree.candidateForum": "photo-1773828991534-58c40247255c",
  "pree.opEdOffer": "photo-1547895749-888a559fc2a7",
  "pree.minorLeagueSponsor": "photo-1490187763999-9f273a5b7516",
  "pree.tradeAssociationBoard": "photo-1607037183811-2a54d746cd35",
  "pree.viralReview": "photo-1647427060118-4911c9821b82",
  "pree.officeLeaseRenewal": "photo-1559523161-0fc0d8b38a7a",
  "pree.doppelganger": "photo-1762158007969-eb58e74ee3d3",
  "pree.greatAuntBequest": "photo-1454793147212-9e7e57e89a4f",
  "pree.childhoodTimeCapsule": "photo-1553242072-345b34e7b55b",
  "pree.meteorite": "photo-1530281700549-e82e7bf110d6",
};

const FILES = [
  "src/lib/events/pree/seedDefinitions.ts",
  "src/lib/events/pree/countryDefinitions.ts",
];

let totalInserted = 0;
let alreadyHad = 0;

for (const rel of FILES) {
  const path = new URL(`../${rel}`, import.meta.url);
  let src = readFileSync(path, "utf8");
  let fileInserted = 0;

  for (const [kind, photoId] of Object.entries(MAP)) {
    // Only apply kinds that actually appear in this file.
    const kindRe = new RegExp(`^(\\s*)kind:\\s*"${kind.replace(/\./g, "\\.")}",\\s*$`, "m");
    const m = src.match(kindRe);
    if (!m) continue;

    const indent = m[1];
    const kindLine = m[0];
    // Skip if an image field already follows this kind line.
    const after = src.slice(m.index + kindLine.length);
    const nextField = after.match(/^\s*(\w+):/m);
    if (nextField && nextField[1] === "image") {
      alreadyHad++;
      continue;
    }

    const imageLine = `${indent}image: "${U(photoId)}",`;
    src =
      src.slice(0, m.index + kindLine.length) +
      "\n" +
      imageLine +
      src.slice(m.index + kindLine.length);
    fileInserted++;
  }

  writeFileSync(path, src);
  totalInserted += fileInserted;
  console.log(`${rel}: inserted ${fileInserted}`);
}

console.log(`\nTotal inserted: ${totalInserted} | already-had: ${alreadyHad}`);

// Verify every kind declared in either file has an `image` field following it.
const allSrc = FILES.map((rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8")).join(
  "\n"
);
const declaredKinds = [...allSrc.matchAll(/^\s*kind:\s*"(pree\.[^"]+)",/gm)].map((m) => m[1]);
const missingImage = declaredKinds.filter((k) => {
  const re = new RegExp(`kind:\\s*"${k.replace(/\./g, "\\.")}",[\\s\\S]*?\\n\\s*image:\\s*"`);
  return !re.test(allSrc);
});
if (missingImage.length) {
  console.error("Kinds declared without a following `image` field:", missingImage);
  process.exit(1);
} else {
  console.log(`All ${declaredKinds.length} declared kinds now have an \`image\` field ✓`);
}
