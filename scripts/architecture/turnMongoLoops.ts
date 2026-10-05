/** Detect per-row Mongo operations in modules reachable from the turn engine. */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";

const OPERATIONS = new Set([
  "find",
  "findOne",
  "aggregate",
  "countDocuments",
  "estimatedDocumentCount",
  "distinct",
  "insertOne",
  "insertMany",
  "updateOne",
  "updateMany",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndReplace",
  "bulkWrite",
]);
const ITERATORS = new Set(["map", "flatMap", "forEach", "reduce", "filter", "some", "every"]);
const printer = ts.createPrinter({ removeComments: true });

export interface TurnMongoLoop {
  file: string;
  line: number;
  operation: string;
  owner: string;
  expression: string;
  fingerprint: string;
}

const isFunction = (node: ts.Node) =>
  ts.isFunctionDeclaration(node) ||
  ts.isFunctionExpression(node) ||
  ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node);

function isIterationCallback(node: ts.Node): boolean {
  const call = node.parent;
  return (
    ts.isCallExpression(call) &&
    ts.isPropertyAccessExpression(call.expression) &&
    ITERATORS.has(call.expression.name.text) &&
    call.arguments.includes(node as ts.Expression)
  );
}

function repeats(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (
      ts.isForStatement(parent) ||
      ts.isForOfStatement(parent) ||
      ts.isForInStatement(parent) ||
      ts.isWhileStatement(parent) ||
      ts.isDoStatement(parent)
    )
      return true;
    if (isFunction(parent)) return isIterationCallback(parent);
  }
  return false;
}

function ownerName(node: ts.Node): string {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if ((ts.isFunctionDeclaration(parent) || ts.isMethodDeclaration(parent)) && parent.name)
      return parent.name.getText();
    if (
      (ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) &&
      ts.isVariableDeclaration(parent.parent)
    )
      return parent.parent.name.getText();
  }
  return "module";
}

export function findMongoOperationsInLoops(source: string, file: string): TurnMongoLoop[] {
  const ast = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const aliases = new Map<ts.Node, Map<string, ts.Expression | undefined>>();
  const collections = new Map<ts.Node, Set<string>>();
  const bindingScope = (node: ts.Node): ts.Node => {
    for (let parent = node.parent; parent; parent = parent.parent) {
      if (
        ts.isBlock(parent) ||
        ts.isSourceFile(parent) ||
        ts.isForStatement(parent) ||
        ts.isForOfStatement(parent) ||
        ts.isForInStatement(parent)
      )
        return parent;
    }
    return ast;
  };
  const collect = (node: ts.Node) => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node)) && ts.isIdentifier(node.name)) {
      const scope = ts.isParameter(node) ? node.parent : bindingScope(node);
      const bindings = aliases.get(scope) ?? new Map<string, ts.Expression | undefined>();
      bindings.set(node.name.text, node.initializer);
      aliases.set(scope, bindings);
      if (ts.isParameter(node) && node.type && /^Collection\s*</.test(node.type.getText(ast))) {
        const names = collections.get(scope) ?? new Set<string>();
        names.add(node.name.text);
        collections.set(scope, names);
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(ast);
  const receiver = (node: ts.Expression, seen = new Set<string>()): boolean => {
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isAwaitExpression(node)
    )
      return receiver(node.expression, seen);
    if (ts.isIdentifier(node)) {
      if (seen.has(node.text)) return false;
      seen.add(node.text);
      for (let scope: ts.Node | undefined = node.parent; scope; scope = scope.parent) {
        if (collections.get(scope)?.has(node.text)) return true;
        const bindings = aliases.get(scope);
        if (bindings?.has(node.text)) {
          const init = bindings.get(node.text);
          return !!init && receiver(init, seen);
        }
      }
      return false;
    }
    if (ts.isCallExpression(node)) {
      if (ts.isPropertyAccessExpression(node.expression)) {
        if (node.expression.name.text === "collection") return true;
        if (
          ["withReadPreference", "withReadConcern", "withWriteConcern"].includes(
            node.expression.name.text
          )
        )
          return receiver(node.expression.expression, seen);
      }
      if (ts.isIdentifier(node.expression) && /(?:Collection|Col)$/.test(node.expression.text))
        return true;
    }
    return false;
  };
  const result: TurnMongoLoop[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      OPERATIONS.has(node.expression.name.text) &&
      repeats(node) &&
      receiver(node.expression.expression)
    ) {
      const expression = printer
        .printNode(ts.EmitHint.Expression, node, ast)
        .replace(/\s+/g, " ")
        .trim();
      const owner = ownerName(node);
      result.push({
        file,
        line: ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1,
        operation: node.expression.name.text,
        owner,
        expression,
        fingerprint: createHash("sha256").update(`${file}\n${owner}\n${expression}`).digest("hex"),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return result;
}

/** Follow static and literal dynamic imports, including domain helpers outside turn/. */
export function turnReachableSources(repoRoot: string): Map<string, string> {
  const sources = new Map<string, string>();
  const pending = [join(repoRoot, "src/lib/turnSystem.ts")];
  const locate = (specifier: string, file: string): string | undefined => {
    const base = specifier.startsWith("@/")
      ? join(repoRoot, "src", specifier.slice(2))
      : specifier.startsWith(".")
        ? resolve(dirname(file), specifier)
        : undefined;
    if (!base) return;
    return [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, "index.ts"),
      join(base, "index.tsx"),
    ].find((candidate) => /\.(?:ts|tsx)$/.test(candidate) && existsSync(candidate));
  };
  while (pending.length) {
    const file = pending.pop()!;
    if (sources.has(file) || /(?:\.test\.|\.spec\.|\.d\.ts$)/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    sources.set(file, source);
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const visit = (node: ts.Node) => {
      let specifier: string | undefined;
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        specifier = node.moduleSpecifier.text;
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        specifier = node.arguments[0].text;
      if (specifier) {
        const dependency = locate(specifier, file);
        if (dependency) pending.push(dependency);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return sources;
}

export function findTurnMongoLoops(repoRoot: string): TurnMongoLoop[] {
  return [...turnReachableSources(repoRoot)].flatMap(([file, source]) =>
    findMongoOperationsInLoops(source, relative(repoRoot, file).replaceAll("\\", "/"))
  );
}

export function newTurnMongoLoops(
  findings: TurnMongoLoop[],
  baseline: Record<string, number>
): TurnMongoLoop[] {
  const seen = new Map<string, number>();
  return findings.filter((finding) => {
    const count = (seen.get(finding.fingerprint) ?? 0) + 1;
    seen.set(finding.fingerprint, count);
    return count > (baseline[finding.fingerprint] ?? 0);
  });
}
