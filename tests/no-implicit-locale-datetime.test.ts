/**
 * Guards the file-level gate, not the date detection. The rule used to run only
 * on files carrying a `"use client"` directive, which silently skipped every
 * client component that gets its client-ness from the subtree that imports it
 * (#569). A gate that stops matching produces no error and no other test
 * failure, so the escapes just come back.
 */
import { RuleTester } from "eslint";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rule = require("../eslint-rules/no-implicit-locale-datetime.js");

const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: "module" },
});

const UNPINNED = "const s = new Date(x).toLocaleString();";

ruleTester.run("no-implicit-locale-datetime", rule, {
  valid: [
    // A server component: no directive and no hook import, so it never hydrates.
    { code: `import { getDb } from "@/lib/mongodb";\n${UNPINNED}`, filename: "src/a.tsx" },
    // A locally declared `useThing` is not an import and must not flip the gate.
    {
      code: `function useThing() {}\n${UNPINNED}`,
      filename: "src/b.tsx",
    },
    // Non-tsx is out of scope entirely.
    { code: UNPINNED, filename: "src/c.ts" },
    // An explicit timeZone is the sanctioned escape hatch.
    {
      code: `import { useState } from "react";\nconst s = new Date(x).toLocaleString("en-US", { timeZone: "UTC" });`,
      filename: "src/d.tsx",
    },
    // Number formatting is not date formatting.
    {
      code: `import { useState } from "react";\nconst s = count.toLocaleString();`,
      filename: "src/e.tsx",
    },
  ],
  invalid: [
    // The original gate: an explicit directive.
    {
      code: `"use client";\n${UNPINNED}`,
      filename: "src/f.tsx",
      errors: [{ messageId: "unpinnedTimezone" }],
    },
    // #569: a React hook import makes this a client module with no directive.
    {
      code: `import { useState } from "react";\n${UNPINNED}`,
      filename: "src/g.tsx",
      errors: [{ messageId: "unpinnedTimezone" }],
    },
    // #569: a CUSTOM hook import counts too — TimelineStepper's actual shape.
    {
      code: `import { useActivePreset } from "@/contexts/RegisteredCountriesContext";\n${UNPINNED}`,
      filename: "src/h.tsx",
      errors: [{ messageId: "unpinnedTimezone" }],
    },
    // A default-imported hook is still a hook.
    {
      code: `import useThing from "./useThing";\n${UNPINNED}`,
      filename: "src/i.tsx",
      errors: [{ messageId: "unpinnedTimezone" }],
    },
    // toLocaleDateString on a hook-importing module.
    {
      code: `import { useMemo } from "react";\nconst s = new Date(x).toLocaleDateString();`,
      filename: "src/j.tsx",
      errors: [{ messageId: "unpinnedTimezone" }],
    },
  ],
});
