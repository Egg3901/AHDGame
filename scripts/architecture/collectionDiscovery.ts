import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

export interface CollectionCallSite {
  file: string;
  line: number;
  argument: string;
  names: string[];
}

export interface UnresolvedCollectionCallSite {
  file: string;
  owner: string;
  line: number;
  argument: string;
  type: string;
  receiverType: string;
  scopeHash: string;
}

export interface CollectionDiscovery {
  calls: CollectionCallSite[];
  unresolved: UnresolvedCollectionCallSite[];
}

const EXCLUDED_DIRECTORY_NAMES = new Set([
  "__tests__",
  "__mocks__",
  "__fixtures__",
  "mocks",
  "test-utils",
  "test",
  "tests",
]);

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return EXCLUDED_DIRECTORY_NAMES.has(entry.name) ? [] : collectSourceFiles(path);
    }
    if (
      !/\.(ts|tsx|mts|cts)$/.test(entry.name) ||
      /\.(test|spec)\.(ts|tsx|mts|cts)$/.test(entry.name) ||
      /TestDb\.(ts|tsx|mts|cts)$/.test(entry.name)
    )
      return [];
    return [path];
  });
}

function hasCollectionCall(source: string): boolean {
  return /\.collection\b/.test(source);
}

function literalStrings(type: ts.Type, checker: ts.TypeChecker): string[] | undefined {
  const parts = type.isUnion() ? type.types : [type];
  const values: string[] = [];
  for (const part of parts) {
    if ((part.flags & ts.TypeFlags.StringLiteral) !== 0) {
      values.push((part as ts.StringLiteralType).value);
      continue;
    }
    if ((part.flags & ts.TypeFlags.TemplateLiteral) !== 0) {
      const template = part as ts.TemplateLiteralType;
      if (template.texts.length === 1) {
        values.push(template.texts[0]);
        continue;
      }
    }
    // `as const` arrays and enums can also produce finite literal types.
    if ((part.flags & ts.TypeFlags.EnumLiteral) !== 0) {
      const value = checker.typeToString(part);
      if (value.includes(".")) {
        values.push(value.slice(value.lastIndexOf(".") + 1).replace(/^"|"$/g, ""));
        continue;
      }
    }
    return undefined;
  }
  return [...new Set(values)].sort();
}

function isCollectionCall(node: ts.Node): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "collection" &&
    node.arguments.length > 0
  );
}

function callTargetDeclarations(
  expression: ts.LeftHandSideExpression,
  checker: ts.TypeChecker
): ts.SignatureDeclaration[] {
  const lookup = ts.isPropertyAccessExpression(expression) ? expression.name : expression;
  let symbol = checker.getSymbolAtLocation(lookup);
  if (symbol && (symbol.flags & ts.SymbolFlags.Alias) !== 0) {
    try {
      symbol = checker.getAliasedSymbol(symbol);
    } catch {
      return [];
    }
  }
  const declarations: ts.SignatureDeclaration[] = [];
  for (const declaration of symbol?.declarations ?? []) {
    if (
      ts.isFunctionDeclaration(declaration) ||
      ts.isMethodDeclaration(declaration) ||
      ts.isFunctionExpression(declaration) ||
      ts.isArrowFunction(declaration)
    ) {
      declarations.push(declaration);
    } else if (
      (ts.isVariableDeclaration(declaration) || ts.isPropertyDeclaration(declaration)) &&
      declaration.initializer &&
      (ts.isFunctionExpression(declaration.initializer) ||
        ts.isArrowFunction(declaration.initializer))
    ) {
      declarations.push(declaration.initializer);
    }
  }
  return declarations;
}

function enclosingOwner(node: ts.Node): string {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) {
      return current.name?.getText() ?? "<anonymous-function>";
    }
    if (ts.isFunctionExpression(current) || ts.isArrowFunction(current)) {
      const parent = current.parent;
      if (ts.isVariableDeclaration(parent)) return parent.name.getText();
      if (ts.isPropertyAssignment(parent)) return parent.name.getText();
      if (ts.isMethodDeclaration(parent)) return parent.name.getText();
      return "<anonymous-function>";
    }
  }
  return "<module-scope>";
}

function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current)
    )
      return current;
  }
  return undefined;
}

function parameterCallValues(
  parameter: ts.ParameterDeclaration,
  checker: ts.TypeChecker,
  callsByName: ReadonlyMap<string, ts.CallExpression[]>,
  callsByDeclaration: ReadonlyMap<ts.SignatureDeclaration, ts.CallExpression[]>,
  resolvedParameters: Map<ts.ParameterDeclaration, string[] | undefined>,
  incompleteParameters: Set<ts.ParameterDeclaration>,
  seen: Set<ts.Node>
): string[] | undefined {
  if (resolvedParameters.has(parameter)) return resolvedParameters.get(parameter);
  const fn = parameter.parent;
  if (!ts.isFunctionLike(fn) || seen.has(parameter)) return undefined;
  seen.add(parameter);
  const index = fn.parameters.indexOf(parameter);
  const functionName =
    fn.name?.getText() ??
    (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)
      ? ts.isVariableDeclaration(fn.parent)
        ? fn.parent.name.getText()
        : undefined
      : undefined);

  const values: string[] = [];
  const calls = [
    ...(callsByDeclaration.get(fn) ?? []),
    ...(functionName ? (callsByName.get(functionName) ?? []) : []),
  ];
  let matched = false;
  for (const call of calls) {
    const signature = checker.getResolvedSignature(call);
    if (signature?.getDeclaration() !== fn) continue;
    const actual = call.arguments[index];
    if (!actual || ts.isSpreadElement(actual)) return undefined;
    matched = true;
    const names = finiteNamesAt(
      actual,
      checker,
      callsByName,
      callsByDeclaration,
      resolvedParameters,
      incompleteParameters,
      seen
    );
    if (!names) {
      incompleteParameters.add(parameter);
      continue;
    }
    if (isIncompleteParameter(actual, checker, incompleteParameters))
      incompleteParameters.add(parameter);
    values.push(...names);
  }
  const result = matched && values.length > 0 ? [...new Set(values)].sort() : undefined;
  resolvedParameters.set(parameter, result);
  return result;
}

function finiteNamesAt(
  node: ts.Expression,
  checker: ts.TypeChecker,
  callsByName: ReadonlyMap<string, ts.CallExpression[]>,
  callsByDeclaration: ReadonlyMap<ts.SignatureDeclaration, ts.CallExpression[]>,
  resolvedParameters: Map<ts.ParameterDeclaration, string[] | undefined>,
  incompleteParameters: Set<ts.ParameterDeclaration>,
  seen = new Set<ts.Node>()
): string[] | undefined {
  const byType = literalStrings(checker.getTypeAtLocation(node), checker);
  if (byType) return byType;

  if (ts.isIdentifier(node)) {
    const symbol = checker.getSymbolAtLocation(node);
    for (const declaration of symbol?.declarations ?? []) {
      if (ts.isVariableDeclaration(declaration) && declaration.initializer) {
        const names = finiteNamesAt(
          declaration.initializer,
          checker,
          callsByName,
          callsByDeclaration,
          resolvedParameters,
          incompleteParameters,
          seen
        );
        if (names) return names;
      }
      if (ts.isParameter(declaration)) {
        const names = parameterCallValues(
          declaration,
          checker,
          callsByName,
          callsByDeclaration,
          resolvedParameters,
          incompleteParameters,
          seen
        );
        if (names) return names;
      }
    }
  }
  return undefined;
}

function isIncompleteParameter(
  node: ts.Expression,
  checker: ts.TypeChecker,
  incompleteParameters: ReadonlySet<ts.ParameterDeclaration>
): boolean {
  if (!ts.isIdentifier(node)) return false;
  const symbol = checker.getSymbolAtLocation(node);
  return (symbol?.declarations ?? []).some(
    (declaration) => ts.isParameter(declaration) && incompleteParameters.has(declaration)
  );
}

/**
 * Finds production Mongo collection calls and resolves finite string choices
 * using TypeScript's checker, including imported constants and parameter types.
 */
export function discoverCollectionCalls(
  repositoryRoot: string,
  additionalFiles: readonly string[] = []
): CollectionDiscovery {
  const srcRoot = resolve(repositoryRoot, "src");
  const productionFiles = collectSourceFiles(srcRoot);
  const candidateFiles = productionFiles.filter((file) =>
    hasCollectionCall(readFileSync(file, "utf8"))
  );
  const additional = additionalFiles.map((file) => resolve(file));
  const rootNames = [...new Set([...candidateFiles, ...additional])];
  const configPath = ts.findConfigFile(repositoryRoot, ts.sys.fileExists, "tsconfig.json");
  const config = configPath
    ? ts.readConfigFile(configPath, ts.sys.readFile)
    : { config: {}, error: undefined };
  const parsed = ts.parseJsonConfigFileContent(config.config ?? {}, ts.sys, repositoryRoot);
  const options: ts.CompilerOptions = {
    ...parsed.options,
    noEmit: true,
    incremental: false,
    skipLibCheck: true,
  };
  const program = ts.createProgram({ rootNames, options });
  const checker = program.getTypeChecker();
  const calls: CollectionCallSite[] = [];
  const unresolved: UnresolvedCollectionCallSite[] = [];
  const callsByName = new Map<string, ts.CallExpression[]>();
  const callsByDeclaration = new Map<ts.SignatureDeclaration, ts.CallExpression[]>();
  const resolvedParameters = new Map<ts.ParameterDeclaration, string[] | undefined>();
  const incompleteParameters = new Set<ts.ParameterDeclaration>();
  const importedAliases = new Set<string>();

  for (const sourceFile of program.getSourceFiles()) {
    const findAliases = (node: ts.Node): void => {
      if (ts.isImportSpecifier(node) && node.propertyName) importedAliases.add(node.name.text);
      ts.forEachChild(node, findAliases);
    };
    findAliases(sourceFile);
  }

  for (const sourceFile of program.getSourceFiles()) {
    const indexCalls = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        const name = ts.isIdentifier(expression)
          ? expression.text
          : ts.isPropertyAccessExpression(expression)
            ? expression.name.text
            : undefined;
        if (name) {
          const entries = callsByName.get(name) ?? [];
          entries.push(node);
          callsByName.set(name, entries);
        }
        if (name && importedAliases.has(name)) {
          for (const declaration of callTargetDeclarations(expression, checker)) {
            const entries = callsByDeclaration.get(declaration) ?? [];
            entries.push(node);
            callsByDeclaration.set(declaration, entries);
          }
        }
      }
      ts.forEachChild(node, indexCalls);
    };
    indexCalls(sourceFile);
  }

  for (const sourceFile of program.getSourceFiles()) {
    const normalized = resolve(sourceFile.fileName);
    const inProduction =
      normalized.startsWith(`${srcRoot}/`) && productionFiles.includes(normalized);
    const inAdditional = additional.includes(normalized);
    if (!inProduction && !inAdditional) continue;

    const visit = (node: ts.Node): void => {
      if (isCollectionCall(node)) {
        const argumentNode = node.arguments[0];
        const type = checker.getTypeAtLocation(argumentNode);
        const names = finiteNamesAt(
          argumentNode,
          checker,
          callsByName,
          callsByDeclaration,
          resolvedParameters,
          incompleteParameters
        );
        const { line } = sourceFile.getLineAndCharacterOfPosition(argumentNode.getStart());
        const entry = {
          file: relative(repositoryRoot, normalized).replaceAll("\\", "/"),
          line: line + 1,
          argument: argumentNode.getText(sourceFile),
        };
        const incomplete = isIncompleteParameter(argumentNode, checker, incompleteParameters);
        if (names && names.length > 0) calls.push({ ...entry, names });
        if (!names || names.length === 0 || incomplete)
          unresolved.push({
            ...entry,
            owner: enclosingOwner(node),
            type: checker.typeToString(type, argumentNode),
            receiverType: checker.typeToString(
              checker.getTypeAtLocation(node.expression.expression)
            ),
            scopeHash: createHash("sha256")
              .update(enclosingFunction(node)?.getText(sourceFile) ?? sourceFile.text)
              .digest("hex"),
          });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  // Config-driven collection references often use a `collection` field whose
  // interface widens the literal. Keep those concrete declarations discoverable.
  for (const sourceFile of program.getSourceFiles()) {
    const normalized = resolve(sourceFile.fileName);
    const inProduction =
      normalized.startsWith(`${srcRoot}/`) && productionFiles.includes(normalized);
    if (!inProduction) continue;
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        /collection$/i.test(node.name.text) &&
        ts.isStringLiteralLike(node.initializer) &&
        node.initializer.text !== "unknown"
      ) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.initializer.getStart());
        calls.push({
          file: relative(repositoryRoot, normalized).replaceAll("\\", "/"),
          line: line + 1,
          argument: `${node.name.text}: ${node.initializer.getText(sourceFile)}`,
          names: [node.initializer.text],
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return {
    calls: calls.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
    unresolved: unresolved.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line),
  };
}
