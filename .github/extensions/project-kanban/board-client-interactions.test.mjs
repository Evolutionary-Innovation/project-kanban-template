import assert from "node:assert/strict";
import test from "node:test";
import {
  claimPendingSuggestionApproval,
  closestElementFromEventTarget,
} from "./board-client-interactions.mjs";

test("ignores non-Element delegated event targets before calling closest", () => {
  let closestCalls = 0;
  const target = { closest: () => { closestCalls += 1; } };

  assert.equal(closestElementFromEventTarget(target, ".target"), null);
  assert.equal(closestCalls, 0);
});

test("uses closest for Element targets", () => {
  const originalElement = globalThis.Element;
  class TestElement {
    closest(selector) {
      return selector === ".target" ? this : null;
    }
  }

  globalThis.Element = TestElement;
  try {
    const target = new TestElement();
    assert.equal(closestElementFromEventTarget(target, ".target"), target);
    assert.equal(closestElementFromEventTarget(target, ".missing"), null);
  } finally {
    if (originalElement === undefined) delete globalThis.Element;
    else globalThis.Element = originalElement;
  }
});

test("prevents duplicate pending approvals while allowing a later retry", () => {
  const pendingIds = new Set();

  assert.equal(claimPendingSuggestionApproval(pendingIds, "suggestion-1"), true);
  assert.equal(claimPendingSuggestionApproval(pendingIds, "suggestion-1"), false);
  assert.equal(claimPendingSuggestionApproval(pendingIds, "suggestion-2"), true);

  pendingIds.delete("suggestion-1");
  assert.equal(claimPendingSuggestionApproval(pendingIds, "suggestion-1"), true);
});
