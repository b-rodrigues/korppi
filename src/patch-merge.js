// src/patch-merge.js
// Three-way patch merge with conflict markers

/**
 * Tokenize text into words and whitespace tokens
 * @param {string} text - Text to tokenize
 * @returns {string[]} Array of tokens
 */
function tokenize(text) {
    if (!text) return [];

    const tokens = [];
    const len = text.length;
    let start = 0;
    let inWhitespace = isWhitespace(text.charCodeAt(0));

    for (let i = 1; i <= len; i++) {
        const isWs = i < len ? isWhitespace(text.charCodeAt(i)) : !inWhitespace;

        if (isWs !== inWhitespace) {
            tokens.push(text.slice(start, i));
            start = i;
            inWhitespace = isWs;
        }
    }

    return tokens;
}

/**
 * Fast whitespace check using charCode
 */
function isWhitespace(code) {
    return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

/**
 * Compute LCS (Longest Common Subsequence) pairs
 * @param {string[]} base - Base tokens
 * @param {string[]} other - Other tokens
 * @returns {Array<[number, number]>} Array of [base_idx, other_idx] pairs
 */
function lcsPairs(base, other) {
    const m = base.length;
    const n = other.length;

    if (m === 0 || n === 0) return [];

    // Use simple O(mn) space for all inputs (cleaner for this use case)
    const dp = new Array(m + 1);
    for (let i = 0; i <= m; i++) {
        dp[i] = new Uint16Array(n + 1);
    }

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (base[i - 1] === other[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to get pairs
    const pairs = [];
    let i = m;
    let j = n;

    while (i > 0 && j > 0) {
        if (base[i - 1] === other[j - 1]) {
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
 * Line-based diff for better conflict detection
 * @param {string} text1 - First text
 * @param {string} text2 - Second text
 * @returns {Object} - { added: Set<number>, removed: Set<number>, changed: Set<number> }
 */
function lineDiff(base, other) {
    const baseLines = base.split('\n');
    const otherLines = other.split('\n');

    const pairs = lcsPairs(baseLines, otherLines);
    const baseMatched = new Set(pairs.map(([b, _]) => b));
    const otherMatched = new Set(pairs.map(([_, o]) => o));

    const removed = new Set();
    const added = new Set();

    for (let i = 0; i < baseLines.length; i++) {
        if (!baseMatched.has(i)) {
            removed.add(i);
        }
    }

    for (let i = 0; i < otherLines.length; i++) {
        if (!otherMatched.has(i)) {
            added.add(i);
        }
    }

    return { removed, added, baseLines, otherLines };
}

/**
 * Detect if two patches have overlapping edits (conflict)
 * @param {string} base - Base text
 * @param {string} patchA - Text from patch A (e.g., Alice)
 * @param {string} patchB - Text from patch B (e.g., Bob)
 * @returns {boolean} - True if there are conflicts
 */
export function hasConflicts(base, patchA, patchB) {
    const diffA = lineDiff(base, patchA);
    const diffB = lineDiff(base, patchB);

    // Check if any removed lines overlap
    for (const lineNum of diffA.removed) {
        if (diffB.removed.has(lineNum)) {
            // Both removed same line - might be ok if they removed it the same way
            // but we'll flag it as potential conflict
            return true;
        }
    }

    // Check if one patch modified a line that the other also modified
    // We need to check if the same base region was changed differently
    const baseLines = base.split('\n');
    const aLines = patchA.split('\n');
    const bLines = patchB.split('\n');

    // Get LCS pairs for each patch
    const pairsA = lcsPairs(baseLines, aLines);
    const pairsB = lcsPairs(baseLines, bLines);

    // Build maps of what each patch did to base lines
    const baseToA = new Map(pairsA);
    const baseToB = new Map(pairsB);

    // Check for true conflicts: same base region modified differently
    for (let i = 0; i < baseLines.length; i++) {
        const inA = baseToA.has(i);
        const inB = baseToB.has(i);

        // If both patches kept the line, no conflict
        if (inA && inB) continue;

        // If neither kept it, both deleted - potential conflict
        if (!inA && !inB) {
            return true;
        }

        // If only one kept it, the other modified/deleted - potential conflict
        // unless the kept version is identical to base
    }

    // Check for insertions in the same location
    // This is harder to detect precisely, so we use a heuristic:
    // If both patches have additions and the merged result would be ambiguous
    const aHasAdditions = aLines.length > baseLines.length || diffA.added.size > 0;
    const bHasAdditions = bLines.length > baseLines.length || diffB.added.size > 0;

    if (aHasAdditions && bHasAdditions) {
        // Check if additions are in similar locations
        // Simplified: if both add near the same base line, flag as conflict
        for (let i = 0; i < baseLines.length; i++) {
            const aIdx = baseToA.get(i);
            const bIdx = baseToB.get(i);

            if (aIdx !== undefined && bIdx !== undefined) {
                // Check if there are insertions before this matched line
                const aInsBefore = aIdx - (baseToA.get(i - 1) ?? -1) - 1;
                const bInsBefore = bIdx - (baseToB.get(i - 1) ?? -1) - 1;

                if (aInsBefore > 0 && bInsBefore > 0) {
                    return true;
                }
            }
        }
    }

    return false;
}

/**
 * Merge two patches with conflict markers
 * @param {string} base - Base/original text (common ancestor)
 * @param {string} patchA - First patch content (e.g., Alice's version)
 * @param {string} patchB - Second patch content (e.g., Bob's version)
 * @param {string} labelA - Label for patch A (e.g., "Alice")
 * @param {string} labelB - Label for patch B (e.g., "Bob")
 * @returns {Object} - { merged: string, hasConflicts: boolean, conflictCount: number }
 */
export function mergeWithConflicts(base, patchA, patchB, labelA = 'Patch A', labelB = 'Patch B') {
    // Fast paths
    if (patchA === base && patchB === base) {
        return { merged: base, hasConflicts: false, conflictCount: 0 };
    }
    if (patchA === base) {
        return { merged: patchB, hasConflicts: false, conflictCount: 0 };
    }
    if (patchB === base) {
        return { merged: patchA, hasConflicts: false, conflictCount: 0 };
    }
    if (patchA === patchB) {
        return { merged: patchA, hasConflicts: false, conflictCount: 0 };
    }

    // Line-based merge for better conflict handling
    const baseLines = base.split('\n');
    const aLines = patchA.split('\n');
    const bLines = patchB.split('\n');

    // Get LCS pairs
    const pairsA = lcsPairs(baseLines, aLines);
    const pairsB = lcsPairs(baseLines, bLines);

    // Build maps
    const baseToA = new Map(pairsA);
    const baseToB = new Map(pairsB);
    const aToBase = new Map(pairsA.map(([b, a]) => [a, b]));
    const bToBase = new Map(pairsB.map(([b, bb]) => [bb, b]));

    const result = [];
    let aIdx = 0;
    let bIdx = 0;
    let conflictCount = 0;

    for (let baseIdx = 0; baseIdx < baseLines.length; baseIdx++) {
        const aMatch = baseToA.get(baseIdx);
        const bMatch = baseToB.get(baseIdx);

        // Collect insertions from A before this base position
        const aInsertions = [];
        if (aMatch !== undefined) {
            while (aIdx < aMatch) {
                if (!aToBase.has(aIdx)) {
                    aInsertions.push(aLines[aIdx]);
                }
                aIdx++;
            }
        }

        // Collect insertions from B before this base position
        const bInsertions = [];
        if (bMatch !== undefined) {
            while (bIdx < bMatch) {
                if (!bToBase.has(bIdx)) {
                    bInsertions.push(bLines[bIdx]);
                }
                bIdx++;
            }
        }

        // Handle insertions - check for conflicts
        if (aInsertions.length > 0 && bInsertions.length > 0) {
            // Both have insertions - check if they're the same
            if (aInsertions.join('\n') === bInsertions.join('\n')) {
                // Same insertion, no conflict
                result.push(...aInsertions);
            } else {
                // Different insertions - conflict!
                conflictCount++;
                result.push(`╔══════ ${labelA}`);
                result.push(...aInsertions);
                result.push('╠══════');
                result.push(...bInsertions);
                result.push(`╚══════ ${labelB}`);
            }
        } else if (aInsertions.length > 0) {
            result.push(...aInsertions);
        } else if (bInsertions.length > 0) {
            result.push(...bInsertions);
        }

        // Handle the base line itself
        if (aMatch !== undefined && bMatch !== undefined) {
            // Both kept the line - output it
            result.push(baseLines[baseIdx]);
            aIdx = aMatch + 1;
            bIdx = bMatch + 1;
        } else if (aMatch !== undefined && bMatch === undefined) {
            // A kept, B removed/replaced
            // Check if B replaced with something different
            const bReplacement = findReplacement(baseIdx, bLines, pairsB, baseLines.length);
            if (bReplacement !== null && bReplacement !== baseLines[baseIdx]) {
                // B replaced with different content - conflict
                conflictCount++;
                result.push(`╔══════ ${labelA}`);
                result.push(baseLines[baseIdx]);
                result.push('╠══════');
                if (bReplacement) result.push(bReplacement);
                result.push(`╚══════ ${labelB}`);
            } else {
                // B just deleted - honor B's deletion (don't output)
            }
            aIdx = aMatch + 1;
        } else if (bMatch !== undefined && aMatch === undefined) {
            // B kept, A removed/replaced
            const aReplacement = findReplacement(baseIdx, aLines, pairsA, baseLines.length);
            if (aReplacement !== null && aReplacement !== baseLines[baseIdx]) {
                // A replaced with different content - conflict
                conflictCount++;
                result.push(`╔══════ ${labelA}`);
                if (aReplacement) result.push(aReplacement);
                result.push('╠══════');
                result.push(baseLines[baseIdx]);
                result.push(`╚══════ ${labelB}`);
            } else {
                // A just deleted - honor A's deletion (don't output)
            }
            bIdx = bMatch + 1;
        } else {
            // Neither kept the line - both deleted or replaced
            const aReplacement = findReplacement(baseIdx, aLines, pairsA, baseLines.length);
            const bReplacement = findReplacement(baseIdx, bLines, pairsB, baseLines.length);

            if (aReplacement === bReplacement) {
                // Same deletion/replacement - no conflict
                if (aReplacement) result.push(aReplacement);
            } else if (aReplacement === null && bReplacement === null) {
                // Both deleted - no conflict, don't output
            } else {
                // Different modifications - conflict
                conflictCount++;
                result.push(`╔══════ ${labelA}`);
                if (aReplacement) result.push(aReplacement);
                result.push('╠══════');
                if (bReplacement) result.push(bReplacement);
                result.push(`╚══════ ${labelB}`);
            }
        }
    }

    // Handle remaining insertions at the end
    const aRemaining = [];
    while (aIdx < aLines.length) {
        if (!aToBase.has(aIdx)) {
            aRemaining.push(aLines[aIdx]);
        }
        aIdx++;
    }

    const bRemaining = [];
    while (bIdx < bLines.length) {
        if (!bToBase.has(bIdx)) {
            bRemaining.push(bLines[bIdx]);
        }
        bIdx++;
    }

    if (aRemaining.length > 0 && bRemaining.length > 0) {
        if (aRemaining.join('\n') === bRemaining.join('\n')) {
            result.push(...aRemaining);
        } else {
            conflictCount++;
            result.push(`╔══════ ${labelA}`);
            result.push(...aRemaining);
            result.push('╠══════');
            result.push(...bRemaining);
            result.push(`╚══════ ${labelB}`);
        }
    } else if (aRemaining.length > 0) {
        result.push(...aRemaining);
    } else if (bRemaining.length > 0) {
        result.push(...bRemaining);
    }

    return {
        merged: result.join('\n'),
        hasConflicts: conflictCount > 0,
        conflictCount
    };
}

/**
 * Find what a patch replaced a base line with (if anything)
 * @param {number} baseIdx - Index of line in base
 * @param {string[]} patchLines - Lines from the patch
 * @param {Array<[number, number]>} pairs - LCS pairs
 * @param {number} baseLength - Length of base
 * @returns {string|null} - Replacement text or null if just deleted
 */
function findReplacement(baseIdx, patchLines, pairs, baseLength) {
    // Find the surrounding matched lines
    let prevMatch = -1;
    let nextMatch = patchLines.length;

    for (const [b, p] of pairs) {
        if (b < baseIdx && p > prevMatch) {
            prevMatch = p;
        }
        if (b > baseIdx && p < nextMatch) {
            nextMatch = p;
        }
    }

    // The replacement would be lines between prevMatch and nextMatch
    const replacementLines = [];
    for (let i = prevMatch + 1; i < nextMatch; i++) {
        // Make sure this line isn't matched to another base line
        const isMatched = pairs.some(([_, p]) => p === i);
        if (!isMatched) {
            replacementLines.push(patchLines[i]);
        }
    }

    if (replacementLines.length === 0) {
        return null; // Just deleted
    }

    return replacementLines.join('\n');
}

/**
 * Parse conflict markers from merged text
 * @param {string} text - Text with conflict markers
 * @returns {Array<Object>} - Array of { start, end, labelA, contentA, contentB, labelB }
 */
export function parseConflicts(text) {
    const conflicts = [];
    const lines = text.split('\n');
    let i = 0;

    while (i < lines.length) {
        const startMatch = lines[i].match(/^╔═{6}\s*(.*)$/);
        if (startMatch) {
            const conflict = {
                startLine: i,
                labelA: startMatch[1],
                contentA: [],
                contentB: [],
                labelB: ''
            };

            i++;
            // Collect content A
            while (i < lines.length && !lines[i].startsWith('╠══════')) {
                conflict.contentA.push(lines[i]);
                i++;
            }

            if (i < lines.length && lines[i].startsWith('╠══════')) {
                i++;
                // Collect content B
                while (i < lines.length && !lines[i].match(/^╚═{6}/)) {
                    conflict.contentB.push(lines[i]);
                    i++;
                }

                if (i < lines.length) {
                    const endMatch = lines[i].match(/^╚═{6}\s*(.*)$/);
                    if (endMatch) {
                        conflict.labelB = endMatch[1];
                        conflict.endLine = i;
                    }
                }
            }

            conflicts.push(conflict);
        }
        i++;
    }

    return conflicts;
}

/**
 * Apply a resolution to a specific conflict in the merged text
 * @param {string} mergedText - Text with conflict markers
 * @param {number} conflictIndex - Which conflict to resolve (0-based)
 * @param {string} resolution - 'A', 'B', or custom text
 * @returns {string} - Updated text with conflict resolved
 */
export function resolveConflict(mergedText, conflictIndex, resolution) {
    const conflicts = parseConflicts(mergedText);
    if (conflictIndex < 0 || conflictIndex >= conflicts.length) {
        return mergedText;
    }

    const conflict = conflicts[conflictIndex];
    const lines = mergedText.split('\n');

    let replacementLines;
    if (resolution === 'A') {
        replacementLines = conflict.contentA;
    } else if (resolution === 'B') {
        replacementLines = conflict.contentB;
    } else if (resolution === 'both') {
        replacementLines = [...conflict.contentA, ...conflict.contentB];
    } else {
        // Custom resolution
        replacementLines = resolution.split('\n');
    }

    // Replace the conflict block with the resolution
    const before = lines.slice(0, conflict.startLine);
    const after = lines.slice(conflict.endLine + 1);

    return [...before, ...replacementLines, ...after].join('\n');
}

/**
 * Check if text contains unresolved conflict markers
 * @param {string} text - Text to check
 * @returns {boolean}
 */
export function hasUnresolvedConflicts(text) {
    return /^╔═{6}/m.test(text);
}

/**
 * Count unresolved conflicts in text
 * @param {string} text - Text to check
 * @returns {number}
 */
export function countConflicts(text) {
    const matches = text.match(/^╔═{6}/gm);
    return matches ? matches.length : 0;
}
