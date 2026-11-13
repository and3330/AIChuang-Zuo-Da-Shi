import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

// Exercise the actual route pre-validation guards without DB writes or paid AI.
const text = readFileSync("server/routes.ts", "utf8");
const source = ts.createSourceFile("routes.ts", text, ts.ScriptTarget.Latest, true);
for (const [path, boundary] of [
  ["/api/image-generations", "isBatch"],
  ["/api/video-generations", "videoType"],
]) {
  let handler: ts.ArrowFunction | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === "app.post"
      && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === path) {
      const last = node.arguments[node.arguments.length - 1];
      if (ts.isArrowFunction(last)) handler = last;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert(handler && ts.isBlock(handler.body));
  const block = handler.body.statements.find(ts.isTryStatement)?.tryBlock;
  assert(block);
  const index = block.statements.findIndex(statement =>
    ts.isVariableStatement(statement)
    && statement.declarationList.declarations.some(d => d.name.getText(source) === boundary));
  assert(index >= 0);
  const guardText = block.statements.slice(0, index).map(n => n.getText(source)).join("\n");
  const guardJs = ts.transpileModule(guardText, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const run = new Function("storage", "req", "res",
    `return (async () => { ${guardJs}; return "validation-reached"; })();`);
  let dailyCountReads = 0;
  const storage = {
    getUser: async () => ({ id: "test", isAdmin: false, credits: 1000 }),
    getUserDailyImageCount: async () => { dailyCountReads++; return 10000; },
    getUserDailyVideoCount: async () => { dailyCountReads++; return 10000; },
  };
  const res = {
    code: 200,
    status(code: number) { this.code = code; return this; },
    json(body: unknown) { return body; },
  };
  for (const body of [{}, { prompts: Array(128).fill("test") }, { sequentialGeneration: true, maxImages: 128 }]) {
    assert.equal(await run(storage, { session: { userId: "test" }, body }, res), "validation-reached");
    assert.equal(res.code, 200);
  }
  assert.equal(dailyCountReads, 0, "Generating must not depend on daily usage");
  const handlerText = handler.getText(source);
  assert.match(handlerText, /status\(402\)/, "Credit checks must remain");
  assert.match(handlerText, /\.parse\(req\.body\)/, "Request validation must remain");
  assert.match(handlerText, /promptRefusal/, "Content checks must remain");
  console.log(`PASS ${path}: no daily cap; batch, credit, validation and content guards retained`);
}
