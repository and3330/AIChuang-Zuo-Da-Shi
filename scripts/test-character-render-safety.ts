import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const path = "client/src/pages/character-library.tsx";
const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const card = source.statements.find(
  node => ts.isFunctionDeclaration(node) && node.name?.text === "CharacterCard",
);
assert(card && ts.isFunctionDeclaration(card) && card.body);
const declarations = card.body.statements.flatMap(statement =>
  ts.isVariableStatement(statement) ? [...statement.declarationList.declarations] : [],
);
const embed = declarations.find(node => node.name.getText(source) === "embed");
assert(embed?.initializer && ts.isCallExpression(embed.initializer));
assert.equal(embed.initializer.expression.getText(source), "useEmbed");
const free = declarations.find(node => node.name.getText(source) === "freeFourView");
assert(free?.initializer);
let conditionalHook = false;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && /^use[A-Z]/.test(node.expression.getText(source))) conditionalHook = true;
  ts.forEachChild(node, visit);
}
visit(free.initializer);
assert.equal(conditionalHook, false, "Free-generation state must never control whether a hook runs");
const evaluate = new Function("user", "embed", `return ${free.initializer.getText(source)}`);
assert.equal(evaluate(null, null), false);
assert.equal(evaluate({}, null), true);
assert.equal(evaluate({ freeFourViewUsedAt: new Date() }, null), false);
assert.equal(evaluate({}, { returnOrigin: "https://example.com" }), false);
assert.match(readFileSync("client/src/main.tsx", "utf8"), /<AppErrorBoundary><App\s*\/><\/AppErrorBoundary>/);
console.log("Character render safety passed: unconditional embed hook, account-state cases and root recovery boundary");
