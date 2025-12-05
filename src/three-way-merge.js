// src/three-way-merge.js
// 3-way merge algorithm ported from Rust

/**
 * Tokenize text into words and whitespace tokens
 * @param {string} text - Text to tokenize
 * @returns {string[]} Array of tokens
 */
function tokenize(text) {
    if (!text) return [];

    const tokens = [];
    let current = '';
    let inWhitespace = null;

    for (const char of text) {
        const isWs = /\s/.test(char);

        if (inWhitespace === null) {
            inWhitespace = isWs;
            current += char;
        } else if (inWhitespace === isWs) {
            current += char;
        } else {
            tokens.push(current);
            current = char;
            inWhitespace = isWs;
        }
    }

    if (current) {
        tokens.push(current);
    }

    return tokens;
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

    // Build DP table
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

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
 * Perform 3-way merge of text
 * @param {string} base - Original base text (A)
 * @param {string} local - Current/local text (A + your changes)
 * @param {string} canonical - Incoming text (A + their changes)
 * @returns {string} Merged text
 */
export function mergeText(base, local, canonical) {
    // Fast paths
    if (local === base && canonical === base) return base;
    if (local === base) return canonical;
    if (canonical === base) return local;
    if (local === canonical) return local;

    const baseTokens = tokenize(base);
    const localTokens = tokenize(local);
    const canonTokens = tokenize(canonical);

    // Get LCS pairs for base↔local and base↔canonical
    const localPairs = lcsPairs(baseTokens, localTokens);
    const canonPairs = lcsPairs(baseTokens, canonTokens);

    // Build maps
    const baseToLocal = new Map(localPairs);
    const baseToCanon = new Map(canonPairs);
    const localToBase = new Map(localPairs.map(([b, l]) => [l, b]));
    const canonToBase = new Map(canonPairs.map(([b, c]) => [c, b]));

    const result = [];
    let localIdx = 0;
    let canonIdx = 0;

    for (let baseIdx = 0; baseIdx < baseTokens.length; baseIdx++) {
        const localMatch = baseToLocal.get(baseIdx);
        const canonMatch = baseToCanon.get(baseIdx);

        // Output canonical insertions that come before this base position
        if (canonMatch !== undefined) {
            while (canonIdx < canonMatch) {
                // Only output if this canon token is not matched to any base token
                if (!canonToBase.has(canonIdx)) {
                    result.push(canonTokens[canonIdx]);
                }
                canonIdx++;
            }
        }

        // Output local insertions that come before this base position
        if (localMatch !== undefined) {
            while (localIdx < localMatch) {
                // Only output if this local token is not matched to any base token
                if (!localToBase.has(localIdx)) {
                    result.push(localTokens[localIdx]);
                }
                localIdx++;
            }
        }

        // Handle the base token
        if (localMatch !== undefined && canonMatch !== undefined) {
            // Both sides kept this token - output it
            result.push(baseTokens[baseIdx]);
            localIdx = localMatch + 1;
            canonIdx = canonMatch + 1;
        } else if (localMatch !== undefined) {
            // Local kept it, canonical removed/replaced it
            // Honor canonical's change (don't output base token)
            localIdx = localMatch + 1;
        } else if (canonMatch !== undefined) {
            // Canonical kept it, local removed/replaced it
            // Honor local's change (don't output base token)
            canonIdx = canonMatch + 1;
        }
        // If neither matched, both removed - don't output
    }

    // Output any remaining canonical insertions
    while (canonIdx < canonTokens.length) {
        if (!canonToBase.has(canonIdx)) {
            result.push(canonTokens[canonIdx]);
        }
        canonIdx++;
    }

    // Output any remaining local insertions
    while (localIdx < localTokens.length) {
        if (!localToBase.has(localIdx)) {
            result.push(localTokens[localIdx]);
        }
        localIdx++;
    }

    return result.join('');
}
