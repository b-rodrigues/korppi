// src/conflict-zones.js
// Conflict zone detection - clusters overlapping patch edits into independent zones

import { calculateCharDiff } from './diff-highlighter.js';

/**
 * Extract line ranges that a patch modifies compared to base
 * @param {string} base - Base text
 * @param {string} patched - Patched text
 * @returns {Array<{start: number, end: number}>} - Array of line ranges (0-indexed)
 */
export function extractLineRanges(base, patched) {
    const baseLines = base.split('\n');
    const patchedLines = patched.split('\n');

    // Use LCS to find which lines changed
    const lcs = longestCommonSubsequence(baseLines, patchedLines);
    const baseMatched = new Set(lcs.map(([b, _]) => b));

    const ranges = [];
    let rangeStart = null;

    for (let i = 0; i < baseLines.length; i++) {
        if (!baseMatched.has(i)) {
            // This line was modified/deleted
            if (rangeStart === null) {
                rangeStart = i;
            }
        } else {
            // This line was kept
            if (rangeStart !== null) {
                ranges.push({ start: rangeStart, end: i - 1 });
                rangeStart = null;
            }
        }
    }

    // Close any open range
    if (rangeStart !== null) {
        ranges.push({ start: rangeStart, end: baseLines.length - 1 });
    }

    // Also detect insertions (lines in patched that aren't in base)
    const patchedMatched = new Set(lcs.map(([_, p]) => p));
    let insertionRanges = [];
    let insStart = null;

    for (let i = 0; i < patchedLines.length; i++) {
        if (!patchedMatched.has(i)) {
            if (insStart === null) insStart = i;
        } else {
            if (insStart !== null) {
                // Map back to base line position
                const baseLineIdx = findInsertionPoint(lcs, insStart);
                insertionRanges.push({ start: baseLineIdx, end: baseLineIdx });
                insStart = null;
            }
        }
    }

    if (insStart !== null) {
        const baseLineIdx = findInsertionPoint(lcs, insStart);
        insertionRanges.push({ start: baseLineIdx, end: baseLineIdx });
    }

    // Merge all ranges
    const allRanges = [...ranges, ...insertionRanges];
    return mergeOverlappingRanges(allRanges);
}

/**
 * Find where in the base an insertion would go
 */
function findInsertionPoint(lcs, patchedLineIdx) {
    // Find the last matched base line before this patched line
    let lastBaseIdx = 0;
    for (const [b, p] of lcs) {
        if (p < patchedLineIdx) {
            lastBaseIdx = b;
        } else {
            break;
        }
    }
    return lastBaseIdx;
}

/**
 * Compute LCS pairs between two arrays
 * @returns {Array<[number, number]>} - Array of [baseIdx, patchedIdx] pairs
 */
function longestCommonSubsequence(arr1, arr2) {
    const m = arr1.length;
    const n = arr2.length;

    if (m === 0 || n === 0) return [];

    // DP table
    const dp = new Array(m + 1);
    for (let i = 0; i <= m; i++) {
        dp[i] = new Uint16Array(n + 1);
    }

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (arr1[i - 1] === arr2[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack
    const pairs = [];
    let i = m, j = n;
    while (i > 0 && j > 0) {
        if (arr1[i - 1] === arr2[j - 1]) {
            pairs.push([i - 1, j - 1]);
            i--;
            j--;
        } else if (dp[i - 1][j] >= dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }

    pairs.reverse();
    return pairs;
}

/**
 * Merge overlapping or adjacent ranges
 */
function mergeOverlappingRanges(ranges) {
    if (ranges.length === 0) return [];

    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const merged = [{ ...sorted[0] }];

    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        const last = merged[merged.length - 1];

        // Merge if overlapping or adjacent (within 2 lines for context)
        if (current.start <= last.end + 2) {
            last.end = Math.max(last.end, current.end);
        } else {
            merged.push({ ...current });
        }
    }

    return merged;
}

/**
 * Detect conflict zones from a set of patches
 * Groups overlapping edit regions into independent zones
 *
 * @param {string} baseContent - The base/original content
 * @param {Array<{id: number, content: string, author: string, authorName: string, authorColor: string}>} patches
 * @returns {Array<ConflictZone>}
 *
 * ConflictZone: {
 *   id: number,
 *   startLine: number,
 *   endLine: number,
 *   patches: Array<{id, author, authorName, authorColor, ranges}>,
 *   hasConflict: boolean (true if 2+ patches from different authors)
 * }
 */
export function detectConflictZones(baseContent, patches) {
    if (!baseContent || patches.length === 0) {
        return [];
    }

    // Extract edit ranges for each patch
    const patchRanges = patches.map(patch => {
        const ranges = extractLineRanges(baseContent, patch.content);
        return {
            id: patch.id,
            author: patch.author,
            authorName: patch.authorName || patch.author,
            authorColor: patch.authorColor || '#808080',
            content: patch.content,
            ranges
        };
    });

    // Collect all range endpoints to find zone boundaries
    const events = []; // {line, type: 'start'|'end', patchIdx}

    patchRanges.forEach((patch, patchIdx) => {
        patch.ranges.forEach(range => {
            events.push({ line: range.start, type: 'start', patchIdx });
            events.push({ line: range.end + 1, type: 'end', patchIdx }); // +1 to make end exclusive
        });
    });

    // Sort events by line, starts before ends at same line
    events.sort((a, b) => {
        if (a.line !== b.line) return a.line - b.line;
        return a.type === 'start' ? -1 : 1;
    });

    // Sweep to find zones
    const zones = [];
    const activePatches = new Set();
    let zoneStart = null;
    let zoneId = 0;

    for (const event of events) {
        // If we have active patches and hit a new event, we may need to close/open zones
        if (activePatches.size > 0 && zoneStart !== null && event.line > zoneStart) {
            // Create zone from zoneStart to event.line - 1
            const involvedPatches = [...activePatches].map(idx => patchRanges[idx]);
            const authors = new Set(involvedPatches.map(p => p.author));

            zones.push({
                id: zoneId++,
                startLine: zoneStart,
                endLine: event.line - 1,
                patches: involvedPatches,
                hasConflict: authors.size > 1
            });
        }

        // Update active patches
        if (event.type === 'start') {
            activePatches.add(event.patchIdx);
        } else {
            activePatches.delete(event.patchIdx);
        }

        // Update zone start
        if (activePatches.size > 0) {
            zoneStart = event.line;
        } else {
            zoneStart = null;
        }
    }

    // Merge adjacent zones with same patch set
    const mergedZones = mergeAdjacentZones(zones);

    // Filter to only zones with conflicts (2+ different authors) or single-patch zones for context
    return mergedZones;
}

/**
 * Merge adjacent zones that have the same set of patches
 */
function mergeAdjacentZones(zones) {
    if (zones.length === 0) return [];

    const merged = [zones[0]];

    for (let i = 1; i < zones.length; i++) {
        const current = zones[i];
        const last = merged[merged.length - 1];

        // Check if same patches and adjacent
        const samePatchSet = areSamePatchSets(last.patches, current.patches);
        const adjacent = current.startLine <= last.endLine + 3; // Within 3 lines

        if (samePatchSet && adjacent) {
            last.endLine = current.endLine;
        } else {
            merged.push({ ...current, id: merged.length });
        }
    }

    return merged;
}

/**
 * Check if two patch arrays have the same set of patch IDs
 */
function areSamePatchSets(patches1, patches2) {
    if (patches1.length !== patches2.length) return false;
    const ids1 = new Set(patches1.map(p => p.id));
    const ids2 = new Set(patches2.map(p => p.id));
    if (ids1.size !== ids2.size) return false;
    for (const id of ids1) {
        if (!ids2.has(id)) return false;
    }
    return true;
}

/**
 * Extract the content for a specific zone from a text
 * @param {string} text - Full text
 * @param {number} startLine - Start line (0-indexed)
 * @param {number} endLine - End line (0-indexed, inclusive)
 * @returns {string}
 */
export function extractZoneContent(text, startLine, endLine) {
    const lines = text.split('\n');
    const start = Math.max(0, startLine);
    const end = Math.min(lines.length - 1, endLine);
    return lines.slice(start, end + 1).join('\n');
}

/**
 * Replace a zone's content in a text
 * @param {string} text - Full text
 * @param {number} startLine - Start line (0-indexed)
 * @param {number} endLine - End line (0-indexed, inclusive)
 * @param {string} newContent - New content for the zone
 * @returns {string}
 */
export function replaceZoneContent(text, startLine, endLine, newContent) {
    const lines = text.split('\n');
    const before = lines.slice(0, startLine);
    const after = lines.slice(endLine + 1);
    const newLines = newContent.split('\n');

    return [...before, ...newLines, ...after].join('\n');
}

/**
 * Get context lines around a zone
 * @param {string} text - Full text
 * @param {number} startLine - Zone start line
 * @param {number} endLine - Zone end line
 * @param {number} contextLines - Number of context lines (default 2)
 * @returns {{before: string, after: string}}
 */
export function getZoneContext(text, startLine, endLine, contextLines = 2) {
    const lines = text.split('\n');

    const beforeStart = Math.max(0, startLine - contextLines);
    const beforeEnd = startLine;
    const before = lines.slice(beforeStart, beforeEnd).join('\n');

    const afterStart = endLine + 1;
    const afterEnd = Math.min(lines.length, endLine + 1 + contextLines);
    const after = lines.slice(afterStart, afterEnd).join('\n');

    return { before, after };
}

/**
 * Merge zone content from multiple patches
 * @param {string} baseZoneContent - Base content for this zone
 * @param {Array<{authorName: string, content: string}>} patchZoneContents - Zone content from each patch
 * @returns {{merged: string, hasConflicts: boolean, conflictCount: number}}
 */
export function mergeZoneContents(baseZoneContent, patchZoneContents) {
    if (patchZoneContents.length === 0) {
        return { merged: baseZoneContent, hasConflicts: false, conflictCount: 0 };
    }

    if (patchZoneContents.length === 1) {
        return { merged: patchZoneContents[0].content, hasConflicts: false, conflictCount: 0 };
    }

    // For 2+ patches, do sequential merging
    let current = patchZoneContents[0].content;
    let totalConflicts = 0;

    for (let i = 1; i < patchZoneContents.length; i++) {
        const result = mergeTwo(baseZoneContent, current, patchZoneContents[i].content,
            i === 1 ? patchZoneContents[0].authorName : 'Previous',
            patchZoneContents[i].authorName);
        current = result.merged;
        totalConflicts += result.conflictCount;
    }

    return {
        merged: current,
        hasConflicts: totalConflicts > 0,
        conflictCount: totalConflicts
    };
}

/**
 * Simple two-way merge with conflict markers
 */
function mergeTwo(base, contentA, contentB, labelA, labelB) {
    // If identical, no conflict
    if (contentA === contentB) {
        return { merged: contentA, hasConflicts: false, conflictCount: 0 };
    }

    // If one matches base, take the other
    if (contentA === base) {
        return { merged: contentB, hasConflicts: false, conflictCount: 0 };
    }
    if (contentB === base) {
        return { merged: contentA, hasConflicts: false, conflictCount: 0 };
    }

    // Both modified differently - create conflict marker
    const merged = `<<<<<<< ${labelA}\n${contentA}\n=======\n${contentB}\n>>>>>>> ${labelB}`;
    return { merged, hasConflicts: true, conflictCount: 1 };
}

/**
 * Format zone for display
 * @param {ConflictZone} zone
 * @param {string} baseContent
 * @returns {Object}
 */
export function formatZoneForDisplay(zone, baseContent) {
    const baseLines = baseContent.split('\n');
    const totalLines = baseLines.length;

    // Add some context for display
    const contextLines = 1;
    const displayStart = Math.max(0, zone.startLine - contextLines);
    const displayEnd = Math.min(totalLines - 1, zone.endLine + contextLines);

    const zoneContent = baseLines.slice(zone.startLine, zone.endLine + 1).join('\n');
    const preview = zoneContent.substring(0, 100) + (zoneContent.length > 100 ? '...' : '');

    return {
        ...zone,
        displayStart,
        displayEnd,
        lineCount: zone.endLine - zone.startLine + 1,
        preview,
        authorSummary: [...new Set(zone.patches.map(p => p.authorName))].join(', ')
    };
}
