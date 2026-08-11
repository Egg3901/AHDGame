module.exports = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow hardcoded country ID literals outside of config files",
      category: "Best Practices",
      recommended: true,
    },
    messages: {
      countryLiteral: 'Avoid hardcoded country literal "{{literal}}". Use CountryConfig instead.',
    },
  },
  create(context) {
    const filename = context.getFilename();

    // Allow in config files and tests
    if (
      filename.includes("countries.ts") ||
      filename.includes("countries.test.ts") ||
      filename.includes(".test.ts") ||
      filename.includes(".test.tsx")
    ) {
      return {};
    }

    return {
      BinaryExpression(node) {
        // Check for countryId === "US" patterns
        if (
          node.operator === "===" &&
          node.left.type === "Identifier" &&
          node.left.name === "countryId" &&
          node.right.type === "Literal" &&
          typeof node.right.value === "string" &&
          ["US", "UK", "CA", "DE", "JP"].includes(node.right.value)
        ) {
          context.report({
            node: node.right,
            messageId: "countryLiteral",
            data: { literal: node.right.value },
          });
        }
      },
      ConditionalExpression(node) {
        // Check for country === "UK" ? ... : ... patterns
        if (
          node.test.type === "BinaryExpression" &&
          node.test.operator === "===" &&
          node.test.right.type === "Literal"
        ) {
          const left = node.test.left;
          if (
            left.type === "Identifier" &&
            (left.name === "countryId" || left.name === "country") &&
            ["US", "UK", "CA", "DE", "JP"].includes(node.test.right.value)
          ) {
            context.report({
              node: node.test.right,
              messageId: "countryLiteral",
              data: { literal: node.test.right.value },
            });
          }
        }
      },
    };
  },
};
