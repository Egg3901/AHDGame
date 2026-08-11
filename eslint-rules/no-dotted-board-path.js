/**
 * Flags Mongo paths that address the political board's `values` / `residuals`
 * maps with a dot — `"values.economy.stability"`, `` `residuals.${familyId}` ``.
 *
 * WHY THIS IS A RULE AND NOT A CONVENTION. Those maps are keyed by LITERAL
 * DOTTED STRINGS ("economy.stability"), because a PoliticalMetricId is
 * "<category>.<slug>". Mongo reads a dot in a path as nesting, so:
 *
 *   { $inc: { "residuals.economy.stability": 5 } }
 *        → creates residuals: { economy: { stability: 5 } }
 *
 * which is NOT the key `residuals["economy.stability"]` that every reader looks
 * up. The update succeeds, modifiedCount is 1, nothing throws, and the effect
 * is silently lost. A projection has the mirror failure: it matches nothing and
 * the field reads as undefined, so callers fall back as though there were no
 * data. This has shipped twice — once in the legacy-legislation bridge, once in
 * workforceSkillLoader — and both times the tests passed, because asserting
 * that an update was ISSUED says nothing about whether it LANDED.
 *
 * WHAT TO DO INSTEAD.
 *   - Writing one family  → `applyBoardDelta` (politicalLegislation/boardWrite),
 *     which read-modify-writes the whole object.
 *   - Writing many/all    → `$set` the WHOLE `values` / `residuals` object, the
 *     way the dynamics phase and the seeders do.
 *   - Reading             → project `values` / `residuals` whole and index in
 *     JS: `doc.values["economy.stability"]` is correct and safe.
 *
 * The rule is deliberately shallow: it only fires on a path with a dot AFTER
 * the `values`/`residuals` head. `"values"` alone, or `{ values: 1 }`, is the
 * correct whole-object form and is never flagged.
 */
"use strict";

const HEADS = new Set(["values", "residuals"]);

/** True for "values.x…" / "residuals.x…" — a dotted path into a dotted-key map. */
function isDottedBoardPath(text) {
  if (typeof text !== "string") return false;
  const firstDot = text.indexOf(".");
  if (firstDot <= 0) return false;
  return HEADS.has(text.slice(0, firstDot));
}

/**
 * The static prefix of a template literal, so `` `residuals.${id}` `` is caught
 * by its leading "residuals." quasi. Templates are the common spelling for a
 * computed family path and were how the legislation bridge got it wrong.
 */
function templatePrefix(node) {
  const first = node.quasis[0];
  return first ? first.value.cooked : "";
}

module.exports = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow dotted Mongo paths into the political board's values/residuals maps, whose keys contain literal dots",
    },
    schema: [],
    messages: {
      dottedBoardPath:
        "'{{path}}' addresses the board's {{head}} map as a NESTED path, but its keys contain literal dots ('economy.stability'). Mongo will create a nested object instead of touching the key — the write is silently lost, or the projection silently matches nothing. Use applyBoardDelta() for one family, $set the whole {{head}} object for many, or project {{head}} whole and index in JS.",
    },
  },

  create(context) {
    function report(node, path) {
      context.report({
        node,
        messageId: "dottedBoardPath",
        data: { path, head: path.slice(0, path.indexOf(".")) },
      });
    }

    return {
      Literal(node) {
        if (isDottedBoardPath(node.value)) report(node, node.value);
      },
      TemplateLiteral(node) {
        const prefix = templatePrefix(node);
        if (isDottedBoardPath(prefix)) {
          report(node, `${prefix}\${…}`);
        }
      },
    };
  },
};
