// src/diff-highlighter.js
// Character-level diff highlighting for patch preview

/**
 * Calculate word-level diff between two texts
 * Returns an array of diff operations
 * @param {string} oldText - Previous text
 * @param {string} newText - Current text
 * @returns {Array} Array of {type: 'add'|'delete'|'equal', text: string}
 */
// Reusable tokenizer regex - compiled once
const TOKEN_REGEX = /(\S+|\s+)/g;

/**
 * Tokenize text into words and whitespace tokens
 * @param {string} text - Text to tokenize
 * @returns {string[]} Array of tokens
 */
function tokenize(text) {
    if (!text) return [];
    const tokens = [];
    TOKEN_REGEX.lastIndex = 0; // Reset regex state
    let match;
    while ((match = TOKEN_REGEX.exec(text)) !== null) {
        tokens.push(match[0]);
    }
    return tokens;
}

export function calculateCharDiff(oldText, newText) {
    // Fast path: identical texts
    if (oldText === newText) {
        return oldText ? [{ type: 'equal', text: oldText }] : [];
    }

    // Fast path: one side empty
    if (!oldText) {
        return newText ? [{ type: 'add', text: newText }] : [];
    }
    if (!newText) {
        return [{ type: 'delete', text: oldText }];
    }

    const oldTokens = tokenize(oldText);
    const newTokens = tokenize(newText);

    // Fast path: one side has no tokens
    if (oldTokens.length === 0) {
        return newText ? [{ type: 'add', text: newText }] : [];
    }
    if (newTokens.length === 0) {
        return [{ type: 'delete', text: oldText }];
    }

    const m = oldTokens.length;
    const n = newTokens.length;

    // For small inputs, use the simpler O(mn) space algorithm
    // For larger inputs, use O(n) space with direction tracking
    if (m * n <= 10000) {
        return lcsSmall(oldTokens, newTokens, m, n);
    } else {
        return lcsLarge(oldTokens, newTokens, m, n);
    }
}

/**
 * LCS diff for small inputs - O(mn) space but simpler
 */
function lcsSmall(oldTokens, newTokens, m, n) {
    // Use typed arrays for better performance
    const dp = new Array(m + 1);
    for (let i = 0; i <= m; i++) {
        dp[i] = new Uint16Array(n + 1);
    }

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldTokens[i - 1] === newTokens[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to build diff (in reverse, then reverse array)
    const diff = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
            diff.push({ type: 'equal', text: oldTokens[i - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            diff.push({ type: 'add', text: newTokens[j - 1] });
            j--;
        } else {
            diff.push({ type: 'delete', text: oldTokens[i - 1] });
            i--;
        }
    }
    diff.reverse();

    return mergeDiffOps(diff);
}

/**
 * LCS diff for large inputs - O(n) space
 * Uses two-row DP with direction tracking
 */
function lcsLarge(oldTokens, newTokens, m, n) {
    // Two rows for DP values
    let prev = new Uint16Array(n + 1);
    let curr = new Uint16Array(n + 1);

    // Direction matrix: 0=diagonal, 1=up, 2=left
    // Stored as a single array with row-major order
    const dirs = new Uint8Array((m + 1) * (n + 1));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const idx = i * (n + 1) + j;
            if (oldTokens[i - 1] === newTokens[j - 1]) {
                curr[j] = prev[j - 1] + 1;
                dirs[idx] = 0; // diagonal
            } else if (prev[j] >= curr[j - 1]) {
                curr[j] = prev[j];
                dirs[idx] = 1; // up
            } else {
                curr[j] = curr[j - 1];
                dirs[idx] = 2; // left
            }
        }
        // Swap rows
        [prev, curr] = [curr, prev];
        curr.fill(0);
    }

    // Backtrack using direction matrix
    const diff = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        const idx = i * (n + 1) + j;
        if (i > 0 && j > 0 && dirs[idx] === 0) {
            diff.push({ type: 'equal', text: oldTokens[i - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dirs[idx] === 2)) {
            diff.push({ type: 'add', text: newTokens[j - 1] });
            j--;
        } else {
            diff.push({ type: 'delete', text: oldTokens[i - 1] });
            i--;
        }
    }
    diff.reverse();

    return mergeDiffOps(diff);
}

/**
 * Merge consecutive operations of the same type
 */
function mergeDiffOps(diff) {
    if (diff.length === 0) return diff;

    const merged = [];
    let current = { type: diff[0].type, text: diff[0].text };

    for (let i = 1; i < diff.length; i++) {
        if (diff[i].type === current.type) {
            current.text += diff[i].text;
        } else {
            merged.push(current);
            current = { type: diff[i].type, text: diff[i].text };
        }
    }
    merged.push(current);

    return merged;
}

/**
 * Convert diff operations to position-based ranges for ProseMirror
 * @param {Array} diff - Diff operations from calculateCharDiff
 * @returns {Object} {additions: [{from, to}], deletions: [{text, pos}]}
 */
export function diffToRanges(diff) {
    const additions = [];
    const deletions = [];
    let currentPos = 0;

    for (const op of diff) {
        if (op.type === 'add') {
            additions.push({
                from: currentPos,
                to: currentPos + op.text.length
            });
            currentPos += op.text.length;
        } else if (op.type === 'delete') {
            deletions.push({
                text: op.text,
                pos: currentPos
            });
            // Don't increment position for deletions (they're not in the new text)
        } else {
            // equal
            currentPos += op.text.length;
        }
    }

    return { additions, deletions };
}

/**
 * Build inline diff text (with deletions inserted as strikethrough)
 * @param {Array} diff - Diff operations
 * @returns {string} Text with markers for deletions
 */
export function buildInlineDiffText(diff) {
    let result = '';
    for (const op of diff) {
        if (op.type === 'delete') {
            // Mark deletions with special markers we'll style later
            result += op.text;
        } else if (op.type === 'add' || op.type === 'equal') {
            result += op.text;
        }
    }
    return result;
}
