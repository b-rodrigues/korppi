// src/hunk-calculator.js
// Calculates hunks (contiguous groups of changed lines) between documents
// A hunk represents a localized, logical unit of change

/**
 * Calculate hunks between a base document and a modified document
 * @param {string} baseText - The original/base text
 * @param {string} modifiedText - The modified text (e.g., from a patch)
 * @returns {Array<Hunk>} Array of hunks
 * 
 * Each hunk has:
 * - type: 'add' | 'delete' | 'modify'
 * - baseStartLine: starting line in base (0-indexed)
 * - baseEndLine: ending line in base (exclusive)
 * - modifiedStartLine: starting line in modified (0-indexed)
 * - modifiedEndLine: ending line in modified (exclusive)
 * - baseLines: array of lines from base (for deletions/modifications)
 * - modifiedLines: array of lines from modified (for additions/modifications)
 */
export function calculateHunks(baseText, modifiedText) {
    const baseLines = baseText.split('\n');
    const modifiedLines = modifiedText.split('\n');

    // Calculate LCS (Longest Common Subsequence) to find the diff
    const lcs = computeLCS(baseLines, modifiedLines);

    // Convert LCS to a diff script
    const diffOps = lcsToEditScript(baseLines, modifiedLines, lcs);

    // Group consecutive operations into hunks
    const hunks = groupIntoHunks(diffOps);

    return hunks;
}

/**
 * Compute Longest Common Subsequence between two arrays of lines
 * Returns the LCS as an array of {baseIdx, modifiedIdx} pairs
 */
function computeLCS(baseLines, modifiedLines) {
    const m = baseLines.length;
    const n = modifiedLines.length;

    // DP table
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    // Fill DP table
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (baseLines[i - 1] === modifiedLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to find LCS
    const lcs = [];
    let i = m, j = n;

    while (i > 0 && j > 0) {
        if (baseLines[i - 1] === modifiedLines[j - 1]) {
            lcs.push({ baseIdx: i - 1, modifiedIdx: j - 1 });
            i--;
            j--;
        } else if (dp[i - 1][j] > dp[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }

    lcs.reverse();
    return lcs;
}

/**
 * Convert LCS to an edit script (sequence of operations)
 * Operations: 'equal', 'delete', 'add'
 */
function lcsToEditScript(baseLines, modifiedLines, lcs) {
    const ops = [];
    let basePtr = 0;
    let modPtr = 0;
    let lcsPtr = 0;

    while (basePtr < baseLines.length || modPtr < modifiedLines.length) {
        const lcsMatch = lcs[lcsPtr];

        // Check if current positions match LCS
        if (lcsMatch && basePtr === lcsMatch.baseIdx && modPtr === lcsMatch.modifiedIdx) {
            ops.push({
                type: 'equal',
                baseLine: basePtr,
                modifiedLine: modPtr,
                content: baseLines[basePtr]
            });
            basePtr++;
            modPtr++;
            lcsPtr++;
        } else {
            // Lines before the next LCS match are changes
            const nextBaseMatch = lcsMatch ? lcsMatch.baseIdx : baseLines.length;
            const nextModMatch = lcsMatch ? lcsMatch.modifiedIdx : modifiedLines.length;

            // Deletions (lines in base but not in modified)
            while (basePtr < nextBaseMatch) {
                ops.push({
                    type: 'delete',
                    baseLine: basePtr,
                    content: baseLines[basePtr]
                });
                basePtr++;
            }

            // Additions (lines in modified but not in base)
            while (modPtr < nextModMatch) {
                ops.push({
                    type: 'add',
                    modifiedLine: modPtr,
                    content: modifiedLines[modPtr]
                });
                modPtr++;
            }
        }
    }

    return ops;
}

/**
 * Group consecutive edit operations into hunks
 * A hunk is a contiguous region of changes, possibly with some context
 */
function groupIntoHunks(ops) {
    const hunks = [];
    let currentHunk = null;

    for (let i = 0; i < ops.length; i++) {
        const op = ops[i];

        if (op.type === 'equal') {
            // End current hunk if there was one
            if (currentHunk) {
                hunks.push(finalizeHunk(currentHunk));
                currentHunk = null;
            }
        } else {
            // Start a new hunk if needed
            if (!currentHunk) {
                currentHunk = {
                    baseStartLine: op.baseLine ?? ops.slice(0, i).filter(o => o.type !== 'add').length,
                    modifiedStartLine: op.modifiedLine ?? ops.slice(0, i).filter(o => o.type !== 'delete').length,
                    deletions: [],
                    additions: []
                };
            }

            // Add operation to current hunk
            if (op.type === 'delete') {
                currentHunk.deletions.push({
                    line: op.baseLine,
                    content: op.content
                });
            } else if (op.type === 'add') {
                currentHunk.additions.push({
                    line: op.modifiedLine,
                    content: op.content
                });
            }
        }
    }

    // Don't forget the last hunk
    if (currentHunk) {
        hunks.push(finalizeHunk(currentHunk));
    }

    return hunks;
}

/**
 * Finalize a hunk by determining its type and line ranges
 */
function finalizeHunk(hunk) {
    const baseLines = hunk.deletions.map(d => d.content);
    const modifiedLines = hunk.additions.map(a => a.content);

    let type;
    if (hunk.deletions.length > 0 && hunk.additions.length > 0) {
        type = 'modify';
    } else if (hunk.deletions.length > 0) {
        type = 'delete';
    } else {
        type = 'add';
    }

    return {
        type,
        baseStartLine: hunk.baseStartLine,
        baseEndLine: hunk.baseStartLine + hunk.deletions.length,
        modifiedStartLine: hunk.modifiedStartLine,
        modifiedEndLine: hunk.modifiedStartLine + hunk.additions.length,
        baseLines,
        modifiedLines
    };
}

/**
 * Calculate hunks for a patch compared to current content
 * @param {string} currentContent - Current document content
 * @param {Object} patch - Patch object with data.snapshot
 * @returns {Array<Hunk>} Hunks with patch metadata attached
 */
export function calculatePatchHunks(currentContent, patch) {
    if (!patch.data?.snapshot) {
        return [];
    }

    const hunks = calculateHunks(currentContent, patch.data.snapshot);

    // Attach patch metadata to each hunk
    return hunks.map((hunk, index) => ({
        ...hunk,
        hunkId: `${patch.id}-${index}`,
        patchId: patch.id,
        patchUuid: patch.uuid,
        author: patch.author,
        authorName: patch.data?.authorName || patch.author,
        authorColor: patch.data?.authorColor || '#3498db',
        timestamp: patch.timestamp
    }));
}

/**
 * Debug utility: print hunks in a readable format
 */
export function formatHunksForDebug(hunks) {
    return hunks.map(h => {
        const baseRange = h.baseEndLine > h.baseStartLine
            ? `base:${h.baseStartLine}-${h.baseEndLine}`
            : `base:${h.baseStartLine}`;
        const modRange = h.modifiedEndLine > h.modifiedStartLine
            ? `mod:${h.modifiedStartLine}-${h.modifiedEndLine}`
            : `mod:${h.modifiedStartLine}`;

        let content = '';
        if (h.baseLines.length > 0) {
            content += `\n  - ${h.baseLines.join('\n  - ')}`;
        }
        if (h.modifiedLines.length > 0) {
            content += `\n  + ${h.modifiedLines.join('\n  + ')}`;
        }

        return `[${h.type.toUpperCase()}] ${baseRange} → ${modRange}${content}`;
    }).join('\n\n');
}
