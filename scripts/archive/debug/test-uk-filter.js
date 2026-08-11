const http = require("http");

http
  .get("http://localhost:3000/api/policy?scope=national&country=uk", (res) => {
    let data = "";
    res.on("data", (chunk) => (data += chunk));
    res.on("end", () => {
      try {
        const policies = JSON.parse(data);
        console.log("Total policies returned:", policies.length);

        const usSpecific = policies.filter(
          (p) =>
            p.legislationTypeId.startsWith("federal_") || p.legislationTypeId.startsWith("state_")
        );

        console.log("US-specific policies (should be 0):", usSpecific.length);

        if (usSpecific.length > 0) {
          console.log("\nERROR: Still showing US policies:");
          usSpecific.slice(0, 5).forEach((p) => console.log("  -", p.legislationTypeId));
        } else {
          console.log("\n✓ SUCCESS: No US-specific policies showing on UK page");
          console.log("\nUK/International policies:");
          policies.slice(0, 10).forEach((p) => console.log("  -", p.legislationTypeId));
        }
      } catch (err) {
        console.error("Error:", err.message);
        console.log("Response:", data.substring(0, 200));
      }
    });
  })
  .on("error", (err) => {
    console.error("Request failed:", err.message);
    console.log("Make sure dev server is running: npm run dev");
  });
