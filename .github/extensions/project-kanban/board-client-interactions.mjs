export function closestElementFromEventTarget(target, selector) {
  if (typeof Element === "undefined" || !(target instanceof Element)) return null;
  return target.closest(selector);
}

export function claimPendingSuggestionApproval(pendingIds, suggestionId) {
  if (pendingIds.has(suggestionId)) return false;
  pendingIds.add(suggestionId);
  return true;
}
