// src/diff-preview.js
// Visual diff preview overlay for patches

import { calculateCharDiff } from './diff-highlighter.js';
import { getCachedProfile } from './profile-service.js';

let previewState = {
    active: false,
    mode: 'highlight', // 'highlight' or 'diff'
    patchId: null,
    oldText: '',
    newText: ''
};

/**
 * Enter preview mode for a patch
 * @param {number} patchId - Patch ID
 * @param {string} oldText - Previous version text
 * @param {string} newText - Current version text
 */
export function enterPreview(patchId, oldText, newText) {
    previewState = {
        active: true,
        mode: 'highlight',
        patchId,
        oldText,
        newText
    };

    showPreviewBanner();
    renderPreview();
}

/**
 * Exit preview mode
 */
export function exitPreview() {
    previewState = {
        active: false,
        mode: 'highlight',
        patchId: null,
        oldText: '',
        newText: ''
    };

    hidePreviewBanner();
    clearPreview();
}

/**
 * Toggle between highlight and diff modes
 * @param {string} mode - 'highlight' or 'diff'
 */
export function setPreviewMode(mode) {
    if (!previewState.active) return;

    previewState.mode = mode;
    renderPreview();

    // Update button states
    const banner = document.getElementById('diff-preview-banner');
    if (banner) {
        banner.querySelectorAll('.mode-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });
    }
}

/**
 * Show the preview banner
 */
function showPreviewBanner() {
    let banner = document.getElementById('diff-preview-banner');

    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'diff-preview-banner';
        banner.innerHTML = `
            <div class="preview-info">
                <span class="preview-label">📋 Preview Mode: Patch #<span id="preview-patch-id"></span></span>
            </div>
            <div class="preview-controls">
                <button class="mode-btn active" data-mode="highlight">🎨 Highlight</button>
                <button class="mode-btn" data-mode="diff">📝 Diff</button>
                <button class="exit-btn">✕ Exit Preview</button>
            </div>
        `;

        const editorContainer = document.getElementById('editor');
        if (editorContainer) {
            editorContainer.parentElement.insertBefore(banner, editorContainer);
        }

        // Add event listeners
        banner.querySelectorAll('.mode-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                setPreviewMode(btn.dataset.mode);
            });
        });

        banner.querySelector('.exit-btn').addEventListener('click', () => {
            exitPreview();
        });
    }

    // Update patch ID
    const patchIdEl = banner.querySelector('#preview-patch-id');
    if (patchIdEl) {
        patchIdEl.textContent = previewState.patchId;
    }

    banner.style.display = 'flex';
}

/**
 * Hide the preview banner
 */
function hidePreviewBanner() {
    const banner = document.getElementById('diff-preview-banner');
    if (banner) {
        banner.style.display = 'none';
    }
}

/**
 * Render the preview overlay
 */
function renderPreview() {
    if (!previewState.active) return;

    const diff = calculateCharDiff(previewState.oldText, previewState.newText);
    const profile = getCachedProfile();
    const userColor = profile?.color || '#3498db';

    let overlay = document.getElementById('diff-preview-overlay');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'diff-preview-overlay';
        const editorContainer = document.getElementById('editor');
        if (editorContainer) {
            editorContainer.appendChild(overlay);
        }
    }

    // Build HTML with highlights
    let html = '';

    if (previewState.mode === 'highlight') {
        // Highlight mode: show only additions highlighted
        for (const op of diff) {
            if (op.type === 'add') {
                html += `<span class="diff-addition" style="background-color:${hexToRgba(userColor, 0.3)};">${escapeHtml(op.text)}</span>`;
            } else if (op.type === 'equal') {
                html += escapeHtml(op.text);
            }
            // Skip deletions in highlight mode
        }
    } else {
        // Diff mode: show additions highlighted + deletions with strikethrough
        for (const op of diff) {
            if (op.type === 'add') {
                html += `<span class="diff-addition" style="background-color:${hexToRgba(userColor, 0.3)};">${escapeHtml(op.text)}</span>`;
            } else if (op.type === 'delete') {
                html += `<span class="diff-deletion">${escapeHtml(op.text)}</span>`;
            } else {
                html += escapeHtml(op.text);
            }
        }
    }

    overlay.innerHTML = `<pre class="diff-content">${html}</pre>`;
    overlay.style.display = 'block';
}

/**
 * Clear the preview overlay
 */
function clearPreview() {
    const overlay = document.getElementById('diff-preview-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.innerHTML = '';
    }
}

/**
 * Convert hex color to rgba
 * @param {string} hex - Hex color
 * @param {number} alpha - Alpha value
 * @returns {string} rgba string
 */
function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Escape HTML characters
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Check if preview mode is active
 * @returns {boolean}
 */
export function isPreviewActive() {
    return previewState.active;
}
