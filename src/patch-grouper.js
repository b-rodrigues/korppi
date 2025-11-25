// src/patch-grouper.js

const TIME_WINDOW_MS = 600; // grouping horizon in ms
const MAX_GROUP_SIZE = 100; // prevent unbounded growth

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

    // Flush if: time gap too large OR group too large
    if (timeGap > TIME_WINDOW_MS || currentGroup.patches.length >= MAX_GROUP_SIZE) {
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
// Returns null if no group exists.
export function flushGroup(author = "local") {
  if (!currentGroup) return null;
  
  try {
    const record = buildRecord(currentGroup);
    return record;
  } finally {
    // Always clear the group, even if building the record fails
    currentGroup = null;
  }
}

// Get current group stats (for debugging)
export function getGroupStats() {
  if (!currentGroup) {
    return { active: false };
  }
  
  return {
    active: true,
    patchCount: currentGroup.patches.length,
    ageMs: Date.now() - currentGroup.startTimestamp,
    author: currentGroup.author,
  };
}
