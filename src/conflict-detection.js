// src/conflict-detection.js
// Frontend conflict detection logic for identifying overlapping patches
// Optimized with sweep line algorithm and early exit heuristics

import { calculateCharDiff } from './diff-highlighter.js';

/**
 * Detect conflicts between patches based on overlapping edit locations.
 * Uses optimized sweep line algorithm for O(n log n) range overlap detection.
 * @param {Array} patches - Array of patches with snapshot data
 * @returns {Object} - { conflictGroups: Array<Array<patchId>>, patchConflicts: Map<patchId, Array<patchId>> }
 */
export function detectPatchConflicts(patches) {
    // Only analyze patches with snapshot content
    const patchesWithContent = patches.filter(p => p.data?.snapshot);

    if (patchesWithContent.length < 2) {
        return { conflictGroups: [], patchConflicts: new Map() };
    }

    // Calculate edit ranges for each patch with bounding box
    const patchEditRanges = [];
    for (let i = 0; i < patchesWithContent.length; i++) {
        const patch = patchesWithContent[i];
        const prevPatch = i > 0 ? patchesWithContent[i - 1] : null;
        const prevContent = prevPatch?.data?.snapshot || '';
        const currentContent = patch.data.snapshot;

        const ranges = extractEditRanges(prevContent, currentContent);
        if (ranges.length > 0) {
            // Pre-compute bounding box for fast overlap rejection
            let minStart = Infinity, maxEnd = -Infinity;
            for (const r of ranges) {
                if (r.start < minStart) minStart = r.start;
                if (r.end > maxEnd) maxEnd = r.end;
            }
            patchEditRanges.push({
                patchId: patch.id,
                author: patch.author,
                ranges: ranges,
                minStart,
                maxEnd
            });
        }
    }

    // Find overlapping patches using optimized algorithm
    const conflicts = findConflictsOptimized(patchEditRanges);

    // Convert sets to arrays for easier use
    const patchConflicts = new Map();
    for (const [patchId, conflictSet] of conflicts.entries()) {
        patchConflicts.set(patchId, Array.from(conflictSet));
    }

    // Group conflicts into separate conflict groups
    const conflictGroups = groupConflicts(patchConflicts);

    return { conflictGroups, patchConflicts };
}

/**
 * Find conflicts using sweep line algorithm with bounding box pre-filtering.
 * Time complexity: O(n log n + k) where k is the number of actual overlaps.
 * @param {Array} patchEditRanges - Array of patches with ranges and bounding boxes
 * @returns {Map} - Map of patchId -> Set of conflicting patchIds
 */
function findConflictsOptimized(patchEditRanges) {
    const conflicts = new Map();
    const n = patchEditRanges.length;

    if (n < 2) return conflicts;

    // Sort patches by minStart for sweep line
    const sorted = [...patchEditRanges].sort((a, b) => a.minStart - b.minStart);

    // Sweep line: for each patch, only compare with patches whose bounding boxes overlap
    for (let i = 0; i < n; i++) {
        const patchA = sorted[i];

        for (let j = i + 1; j < n; j++) {
            const patchB = sorted[j];

            // Early exit: if patchB starts after patchA ends, no more overlaps possible
            // (since sorted by minStart, all subsequent patches will also start after)
            if (patchB.minStart > patchA.maxEnd) {
                break;
            }

            // Skip if same author (not a conflict)
            if (patchA.author === patchB.author) {
                continue;
            }

            // Bounding box overlap check (fast rejection)
            if (!boundingBoxesOverlap(patchA, patchB)) {
                continue;
            }

            // Detailed range overlap check using sweep line on ranges
            if (hasOverlappingRangesSweepLine(patchA.ranges, patchB.ranges)) {
                // Add conflict relationship
                if (!conflicts.has(patchA.patchId)) {
                    conflicts.set(patchA.patchId, new Set());
                }
                if (!conflicts.has(patchB.patchId)) {
                    conflicts.set(patchB.patchId, new Set());
                }
                conflicts.get(patchA.patchId).add(patchB.patchId);
                conflicts.get(patchB.patchId).add(patchA.patchId);
            }
        }
    }

    return conflicts;
}

/**
 * Fast bounding box overlap check
 */
function boundingBoxesOverlap(a, b) {
    return a.minStart < b.maxEnd && b.minStart < a.maxEnd;
}

/**
 * Check if two sets of ranges overlap using sweep line algorithm.
 * Time complexity: O((m + n) log (m + n)) where m and n are range counts.
 * @param {Array<{start: number, end: number}>} rangesA
 * @param {Array<{start: number, end: number}>} rangesB
 * @returns {boolean}
 */
function hasOverlappingRangesSweepLine(rangesA, rangesB) {
    // For small range sets, use simple O(n*m) comparison (faster due to lower overhead)
    const totalRanges = rangesA.length + rangesB.length;
    if (totalRanges <= 8) {
        return hasOverlappingRangesSimple(rangesA, rangesB);
    }

    // Create events: (position, type, setId)
    // type: 0 = start, 1 = end
    const events = [];

    for (const r of rangesA) {
        events.push({ pos: r.start, type: 0, set: 'A' });
        events.push({ pos: r.end, type: 1, set: 'A' });
    }
    for (const r of rangesB) {
        events.push({ pos: r.start, type: 0, set: 'B' });
        events.push({ pos: r.end, type: 1, set: 'B' });
    }

    // Sort events by position, starts before ends at same position
    events.sort((a, b) => {
        if (a.pos !== b.pos) return a.pos - b.pos;
        return a.type - b.type; // starts (0) before ends (1)
    });

    // Sweep through events, tracking active ranges from each set
    let activeA = 0;
    let activeB = 0;

    for (const event of events) {
        if (event.type === 0) {
            // Start event
            if (event.set === 'A') {
                activeA++;
                if (activeB > 0) return true; // Overlap detected
            } else {
                activeB++;
                if (activeA > 0) return true; // Overlap detected
            }
        } else {
            // End event
            if (event.set === 'A') {
                activeA--;
            } else {
                activeB--;
            }
        }
    }

    return false;
}

/**
 * Simple O(n*m) range overlap check for small range sets
 */
function hasOverlappingRangesSimple(rangesA, rangesB) {
    for (const rangeA of rangesA) {
        for (const rangeB of rangesB) {
            if (rangeA.start < rangeB.end && rangeB.start < rangeA.end) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Extract character ranges affected by edits between two texts
 * @param {string} oldText - Previous text
 * @param {string} newText - Current text
 * @returns {Array<{start: number, end: number}>} - Array of affected character ranges
 */
function extractEditRanges(oldText, newText) {
    // Fast path: identical texts
    if (oldText === newText) {
        return [];
    }

    const diff = calculateCharDiff(oldText, newText);
    const ranges = [];
    let newTextPos = 0;

    for (const op of diff) {
        if (op.type === 'add') {
            // Addition in new text
            ranges.push({
                start: newTextPos,
                end: newTextPos + op.text.length
            });
            newTextPos += op.text.length;
        } else if (op.type === 'delete') {
            // Deletion - mark the position
            ranges.push({
                start: newTextPos,
                end: newTextPos
            });
        } else {
            // Equal - advance position
            newTextPos += op.text.length;
        }
    }

    // Merge adjacent/overlapping ranges
    return mergeRanges(ranges);
}

/**
 * Merge adjacent or overlapping ranges
 * @param {Array<{start: number, end: number}>} ranges
 * @returns {Array<{start: number, end: number}>}
 */
function mergeRanges(ranges) {
    if (ranges.length <= 1) return ranges;

    // Sort by start position
    const sorted = ranges.length > 1
        ? [...ranges].sort((a, b) => a.start - b.start)
        : ranges;

    const merged = [{ ...sorted[0] }];

    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        const last = merged[merged.length - 1];

        // If ranges overlap or are adjacent, merge them
        if (current.start <= last.end) {
            last.end = Math.max(last.end, current.end);
        } else {
            merged.push({ ...current });
        }
    }

    return merged;
}

/**
 * Group conflicts into separate conflict groups using Union-Find for efficiency.
 * If A conflicts with B, and B conflicts with C, they form one group [A, B, C]
 * @param {Map<number, Array<number>>} patchConflicts - Map of patchId to array of conflicting patchIds
 * @returns {Array<Array<number>>} - Array of conflict groups
 */
function groupConflicts(patchConflicts) {
    if (patchConflicts.size === 0) return [];

    // Union-Find data structure for efficient grouping
    const parent = new Map();
    const rank = new Map();

    function find(x) {
        if (!parent.has(x)) {
            parent.set(x, x);
            rank.set(x, 0);
        }
        if (parent.get(x) !== x) {
            parent.set(x, find(parent.get(x))); // Path compression
        }
        return parent.get(x);
    }

    function union(x, y) {
        const rootX = find(x);
        const rootY = find(y);
        if (rootX === rootY) return;

        // Union by rank
        const rankX = rank.get(rootX);
        const rankY = rank.get(rootY);
        if (rankX < rankY) {
            parent.set(rootX, rootY);
        } else if (rankX > rankY) {
            parent.set(rootY, rootX);
        } else {
            parent.set(rootY, rootX);
            rank.set(rootX, rankX + 1);
        }
    }

    // Build unions from conflicts
    for (const [patchId, conflictIds] of patchConflicts) {
        for (const conflictId of conflictIds) {
            union(patchId, conflictId);
        }
    }

    // Group by root
    const groupMap = new Map();
    for (const [patchId] of patchConflicts) {
        const root = find(patchId);
        if (!groupMap.has(root)) {
            groupMap.set(root, []);
        }
        groupMap.get(root).push(patchId);
    }

    // Convert to sorted arrays
    const groups = [];
    for (const members of groupMap.values()) {
        if (members.length > 1) {
            groups.push(members.sort((a, b) => a - b));
        }
    }

    return groups;
}

/**
 * Check if a patch is involved in any conflict
 * @param {number} patchId
 * @param {Map<number, Array<number>>} patchConflicts
 * @returns {boolean}
 */
export function isInConflict(patchId, patchConflicts) {
    return patchConflicts.has(patchId);
}

/**
 * Get the conflict group for a specific patch
 * @param {number} patchId
 * @param {Array<Array<number>>} conflictGroups
 * @returns {Array<number>|null} - The conflict group containing this patch, or null
 */
export function getConflictGroup(patchId, conflictGroups) {
    for (const group of conflictGroups) {
        if (group.includes(patchId)) {
            return group;
        }
    }
    return null;
}

/**
 * Format conflict information for display
 * @param {number} patchId
 * @param {Array<number>} conflictingPatchIds
 * @returns {string}
 */
export function formatConflictInfo(patchId, conflictingPatchIds) {
    if (conflictingPatchIds.length === 0) return '';

    const others = conflictingPatchIds.filter(id => id !== patchId);
    if (others.length === 0) return '';

    const ids = others.map(id => `#${id}`).join(', ');
    return `⚠️ Conflicts with ${ids}`;
}
