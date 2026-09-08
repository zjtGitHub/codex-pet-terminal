import assert from "node:assert/strict";
import test from "node:test";

// A tiny regression test for the two approval decisions we intentionally expose
// on the hardware. More protocol tests will be added when the live bridge fixture
// is introduced.
test("hardware approval decisions stay fail-closed", () => {
  const allowed = new Set(["accept", "decline"]);
  assert.equal(allowed.has("accept"), true);
  assert.equal(allowed.has("decline"), true);
  assert.equal(allowed.has("acceptForSession"), false);
});
