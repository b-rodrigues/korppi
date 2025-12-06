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
