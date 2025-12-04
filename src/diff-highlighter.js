// src/diff-highlighter.js
// Character-level diff highlighting for patch preview

/**
 * Calculate character-level diff between two texts
 * Returns an array of diff operations
 * @param {string} oldText - Previous text
 * @param {string} newText - Current text
 * @returns {Array} Array of {type: 'add'|'delete'|'equal', text: string}
 */
export function calculateCharDiff(oldText, newText) {
    // Simple character-level diff using Myers algorithm concept
    const old = oldText.split('');
    const neu = newText.split('');

    const dp = Array(old.length + 1).fill(null).map(() => Array(neu.length + 1).fill(0));

    // Fill DP table
    for (let i = 0; i <= old.length; i++) {
        for (let j = 0; j <= neu.length; j++) {
            if (i === 0) {
                dp[i][j] = j;
            } else if (j === 0) {
                dp[i][j] = i;
            } else if (old[i - 1] === neu[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1];
            } else {
                dp[i][j] = 1 + Math.min(
                    dp[i - 1][j],     // delete
                    dp[i][j - 1],     // insert
                    dp[i - 1][j - 1]  // replace
                );
            }
        }
    }

    // Backtrack to build diff
    const diff = [];
    let i = old.length;
    let j = neu.length;

    while (i > 0 || j > 0) {
        if (i === 0) {
            diff.unshift({ type: 'add', text: neu[j - 1] });
            j--;
        } else if (j === 0) {
            diff.unshift({ type: 'delete', text: old[i - 1] });
            i--;
        } else if (old[i - 1] === neu[j - 1]) {
            diff.unshift({ type: 'equal', text: old[i - 1] });
            i--;
            j--;
        } else {
            const deleteCost = dp[i - 1][j];
            const insertCost = dp[i][j - 1];
            const replaceCost = dp[i - 1][j - 1];

            if (replaceCost <= deleteCost && replaceCost <= insertCost) {
                diff.unshift({ type: 'delete', text: old[i - 1] });
                diff.unshift({ type: 'add', text: neu[j - 1] });
                i--;
                j--;
            } else if (deleteCost <= insertCost) {
                diff.unshift({ type: 'delete', text: old[i - 1] });
                i--;
            } else {
                diff.unshift({ type: 'add', text: neu[j - 1] });
                j--;
            }
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
