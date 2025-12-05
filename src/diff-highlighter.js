// src/diff-highlighter.js
// Character-level diff highlighting for patch preview

/**
 * Calculate word-level diff between two texts
 * Returns an array of diff operations
 * @param {string} oldText - Previous text
 * @param {string} newText - Current text
 * @returns {Array} Array of {type: 'add'|'delete'|'equal', text: string}
 */
export function calculateCharDiff(oldText, newText) {
    // Tokenize into words and whitespace
    const tokenize = (text) => {
        const tokens = [];
        // Match words (non-whitespace) or whitespace sequences
        const regex = /(\S+|\s+)/g;
        let match;
        while ((match = regex.exec(text)) !== null) {
            tokens.push(match[0]);
        }
        return tokens;
    };

    const oldTokens = tokenize(oldText);
    const newTokens = tokenize(newText);

    // LCS-based diff on tokens
    const m = oldTokens.length;
    const n = newTokens.length;
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldTokens[i - 1] === newTokens[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to build diff
    const diff = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldTokens[i - 1] === newTokens[j - 1]) {
            diff.unshift({ type: 'equal', text: oldTokens[i - 1] });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            diff.unshift({ type: 'add', text: newTokens[j - 1] });
            j--;
        } else {
            diff.unshift({ type: 'delete', text: oldTokens[i - 1] });
            i--;
        }
    }

    // Merge consecutive operations of the same type
    const merged = [];
    for (const op of diff) {
        if (merged.length > 0 && merged[merged.length - 1].type === op.type) {
            merged[merged.length - 1].text += op.text;
        } else {
            merged.push({ ...op });
        }
    }

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
