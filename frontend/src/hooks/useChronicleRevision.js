import { useCallback, useSyncExternalStore } from 'react';

// Chronicle tabs stay mounted while hidden. A confirmed capture/correction
// invalidates every mounted view of that author's archive, including dialogs
// built from the previous result or sharing state.
const revisions = new Map();
const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishChronicleChange(userId) {
  if (!Number.isInteger(userId) || userId <= 0) return;
  revisions.set(userId, (revisions.get(userId) ?? 0) + 1);
  for (const listener of listeners) listener();
}

export default function useChronicleRevision(userId) {
  const snapshot = useCallback(() => revisions.get(userId) ?? 0, [userId]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
