// src/utils.js
// Shared utility functions

/**
 * Convert hex color to rgba
 * @param {string} hex - Hex color (e.g., '#ff0000')
 * @param {number} alpha - Alpha value (0-1)
 * @returns {string} rgba string
 */
export function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Escape HTML characters to prevent XSS
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
export function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Fast whitespace check using charCode
 * @param {number} code - Character code
 * @returns {boolean} True if whitespace
 */
export function isWhitespace(code) {
    return code === 32 || code === 9 || code === 10 || code === 13 || code === 12;
}

/**
 * Tokenize text into words and whitespace tokens.
 * Uses character-based approach (faster than regex).
 * @param {string} text - Text to tokenize
 * @returns {string[]} Array of tokens
 */
export function tokenize(text) {
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
