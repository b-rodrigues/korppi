// src/patch-grouper.js

const TIME_WINDOW_MS = 600; // grouping horizon in ms

let currentGroup = null;

function buildRecord(group) {
  return {
    timestamp: group.startTimestamp,
    author: group.author,
    kind: "semantic_group",
    data: group.patches,
  };
}

// Add one or more semantic patches (from one transaction).
// Returns a patchRecord if a group was flushed, or null otherwise.
export function addSemanticPatches(patches, author = "local") {
  if (!patches || patches.length === 0) return null;

  const now = Date.now();
  let recordToFlush = null;

  for (const p of patches) {
    if (!currentGroup) {
      currentGroup = {
        author,
        startTimestamp: now,
        lastTimestamp: now,
        patches: [p],
      };
      continue;
    }

    const timeGap = now - currentGroup.lastTimestamp;

    // Simple rule: if we paused too long, start a new group
    if (timeGap > TIME_WINDOW_MS) {
      recordToFlush = buildRecord(currentGroup);
      currentGroup = {
        author,
        startTimestamp: now,
        lastTimestamp: now,
        patches: [p],
      };
    } else {
      currentGroup.lastTimestamp = now;
      currentGroup.patches.push(p);
    }
  }

  return recordToFlush;
}

// Force-flush any open group (e.g. on blur/beforeunload).
export function flushGroup(author = "local") {
  if (!currentGroup) return null;
  const record = buildRecord(currentGroup);
  currentGroup = null;
  return record;
}
