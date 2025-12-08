// src/conflict-detection.js
// Frontend conflict detection logic for identifying overlapping patches

import { calculateCharDiff } from './diff-highlighter.js';

/**
 * Detect conflicts between patches based on overlapping edit locations.
 * @param {Array} patches - Array of patches with snapshot data
 * @returns {Object} - { conflictGroups: Array<Array<patchId>>, patchConflicts: Map<patchId, Array<patchId>> }
 */
export function detectPatchConflicts(patches) {
    // Only analyze patches with snapshot content
    const patchesWithContent = patches.filter(p => p.data?.snapshot);

    if (patchesWithContent.length < 2) {
        return { conflictGroups: [], patchConflicts: new Map() };
    }

    // Calculate edit ranges for each patch
    const patchEditRanges = [];
    for (let i = 0; i < patchesWithContent.length; i++) {
        const patch = patchesWithContent[i];
        const prevPatch = i > 0 ? patchesWithContent[i - 1] : null;
        const prevContent = prevPatch?.data?.snapshot || '';
        const currentContent = patch.data.snapshot;

        const ranges = extractEditRanges(prevContent, currentContent);
        if (ranges.length > 0) {
            patchEditRanges.push({
                patchId: patch.id,
                author: patch.author,
                ranges: ranges
            });
        }
    }

    // Find overlapping patches
    const conflicts = new Map(); // patchId -> Set of conflicting patchIds

    for (let i = 0; i < patchEditRanges.length; i++) {
        for (let j = i + 1; j < patchEditRanges.length; j++) {
            const patchA = patchEditRanges[i];
            const patchB = patchEditRanges[j];

            // Skip if same author (not a conflict)
            if (patchA.author === patchB.author) {
                continue;
            }

            // Check if any ranges overlap
            if (hasOverlappingRanges(patchA.ranges, patchB.ranges)) {
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
 * Extract character ranges affected by edits between two texts
 * @param {string} oldText - Previous text
 * @param {string} newText - Current text
 * @returns {Array<{start: number, end: number}>} - Array of affected character ranges
 */
function extractEditRanges(oldText, newText) {
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
    if (ranges.length === 0) return [];

    // Sort by start position
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const merged = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        const last = merged[merged.length - 1];

        // If ranges overlap or are adjacent, merge them
        if (current.start <= last.end) {
            last.end = Math.max(last.end, current.end);
        } else {
            merged.push(current);
        }
    }

    return merged;
}

/**
 * Check if two sets of ranges overlap
 * @param {Array<{start: number, end: number}>} rangesA
 * @param {Array<{start: number, end: number}>} rangesB
 * @returns {boolean}
 */
function hasOverlappingRanges(rangesA, rangesB) {
    for (const rangeA of rangesA) {
        for (const rangeB of rangesB) {
            // Check if ranges overlap
            if (rangeA.start < rangeB.end && rangeB.start < rangeA.end) {
                return true;
            }
        }
    }
    return false;
}

/**
 * Group conflicts into separate conflict groups
 * If A conflicts with B, and B conflicts with C, they form one group [A, B, C]
 * @param {Map<number, Array<number>>} patchConflicts - Map of patchId to array of conflicting patchIds
 * @returns {Array<Array<number>>} - Array of conflict groups
 */
function groupConflicts(patchConflicts) {
    const visited = new Set();
    const groups = [];

    for (const [patchId] of patchConflicts) {
        if (visited.has(patchId)) continue;

        // BFS to find all connected patches
        const group = new Set();
        const queue = [patchId];

        while (queue.length > 0) {
            const current = queue.shift();
            if (visited.has(current)) continue;

            visited.add(current);
            group.add(current);

            const conflicts = patchConflicts.get(current) || [];
            for (const conflictId of conflicts) {
                if (!visited.has(conflictId)) {
                    queue.push(conflictId);
                }
            }
        }

        if (group.size > 1) {
            groups.push(Array.from(group).sort((a, b) => a - b));
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
