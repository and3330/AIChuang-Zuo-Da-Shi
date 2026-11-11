import assert from "node:assert/strict";
import { libraryConcurrencySchema } from "../shared/libraryGeneration";

for (let count = 2; count <= 128; count += 2) {
  assert.equal(libraryConcurrencySchema.safeParse(count).success, true, `accept ${count}`);
}
for (const count of [-2, 0, 1, 3, 63, 127, 129, 130, 256, 2.5, NaN, Infinity, "128", null]) {
  assert.equal(libraryConcurrencySchema.safeParse(count).success, false, `reject ${count}`);
}
assert.equal(libraryConcurrencySchema.default(8).parse(undefined), 8);
console.log("Library concurrency: all even values 2–128 accepted; invalid values rejected; default remains 8.");
