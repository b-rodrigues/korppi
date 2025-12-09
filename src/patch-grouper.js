// src/patch-grouper.js

import { getAuthorId, getCachedProfile } from "./profile-service.js";

const TIME_WINDOW_MS = 600; // grouping horizon in ms
const MAX_GROUP_SIZE = 100; // prevent unbounded growth

let currentGroup = null;
let lastPatchUuid = null; // Track parentage in memory

function buildRecord(group) {
  const profile = getCachedProfile();

  // Generate a new UUID for this patch
  const patchUuid = crypto.randomUUID();

  const record = {
    timestamp: group.startTimestamp,
    author: group.author,
    kind: "semantic_group",
    uuid: patchUuid,
    parent_uuid: lastPatchUuid,
    data: {
      patches: group.patches,
      snapshot: group.snapshot || "",
      authorName: profile?.name || "Local User",
      authorColor: profile?.color || "#3498db"
    }
  };

  // Update parent pointer for next patch
  lastPatchUuid = patchUuid;

  return record;
}

// Add one or more semantic patches (from one transaction).
// Returns a patchRecord if a group was flushed, or null otherwise.
export function addSemanticPatches(patches, snapshot, author = null) {
  if (!patches || patches.length === 0) return null;

  // Use the cached profile author ID if not provided
  const authorId = author !== null ? author : getAuthorId();
  const now = Date.now();
  let recordToFlush = null;

  for (const p of patches) {
    if (!currentGroup) {
      currentGroup = {
        author: authorId,
        startTimestamp: now,
        lastTimestamp: now,
        patches: [p],
        snapshot: snapshot // Store the latest snapshot
      };
      continue;
    }

    const timeGap = now - currentGroup.lastTimestamp;

    // Flush if: time gap too large OR group too large
    if (timeGap > TIME_WINDOW_MS || currentGroup.patches.length >= MAX_GROUP_SIZE) {
      recordToFlush = buildRecord(currentGroup);
      currentGroup = {
        author: authorId,
        startTimestamp: now,
        lastTimestamp: now,
        patches: [p],
        snapshot: snapshot
      };
    } else {
      currentGroup.lastTimestamp = now;
      currentGroup.patches.push(p);
      currentGroup.snapshot = snapshot; // Update snapshot to latest
    }
  }

  return recordToFlush;
}

// Force-flush any open group (e.g. on blur/beforeunload).
// Returns null if no group exists.
export function flushGroup(snapshot = null, author = null) {
  if (!currentGroup) return null;

  try {
    // Update author if provided (for backwards compatibility)
    if (author !== null) {
      currentGroup.author = author;
    }
    // Update snapshot if provided
    if (snapshot !== null) {
      currentGroup.snapshot = snapshot;
    }

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

// Allow setting the last patch UUID explicitly (e.g. on document load)
export function setLastPatchUuid(uuid) {
  lastPatchUuid = uuid;
}
