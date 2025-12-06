// src/diff-preview.js
// Visual diff preview overlay for patches

import { invoke } from '@tauri-apps/api/core';
import { calculateCharDiff } from './diff-highlighter.js';
import { getCachedProfile } from './profile-service.js';
import { getActiveDocumentId } from './document-manager.js';
import { mergeText } from './three-way-merge.js';
import { hexToRgba, escapeHtml } from './utils.js';
import { getEditorContent } from './editor.js';

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
                <button class="accept-patch-btn" style="background:#4caf50;color:white;margin-left:20px;">✓ Accept</button>
                <button class="reject-patch-btn" style="background:#f44336;color:white;">✗ Reject</button>
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

        const acceptBtn = banner.querySelector('.accept-patch-btn');
        const rejectBtn = banner.querySelector('.reject-patch-btn');

        console.log("Accept button found:", acceptBtn);
        console.log("Reject button found:", rejectBtn);

        if (acceptBtn) {
            acceptBtn.addEventListener('click', async () => {
                console.log("Accept button clicked!");
                await acceptCurrentPatch();
            });
        }

        if (rejectBtn) {
            rejectBtn.addEventListener('click', async () => {
                console.log("Reject button clicked!");
                await rejectCurrentPatch();
            });
        }
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

// Utility functions hexToRgba and escapeHtml are imported from utils.js

/**
 * Accept the current patch being previewed
 */
async function acceptCurrentPatch() {
    if (!previewState.active || !previewState.patchId) return;

    const docId = getActiveDocumentId();
    if (!docId) return;

    try {
        // Update review status in database
        await invoke("update_patch_review_status", {
            docId,
            patchId: previewState.patchId,
            status: "accepted"
        });

        // Perform 3-way merge
        // base: original document (from first patch)
        // local: current editor content
        // canonical: the patch being accepted

        const { fetchPatchList } = await import('./timeline.js');
        const allPatches = await fetchPatchList();

        // Find the base snapshot (first patch)
        const savePatchesOnly = allPatches
            .filter(p => p.kind === "Save" && p.data?.snapshot)
            .sort((a, b) => a.timestamp - b.timestamp);

        const baseSnapshot = savePatchesOnly.length > 0
            ? savePatchesOnly[0].data.snapshot
            : '';

        // Get current editor content (local)
        const currentContent = getEditorContent();

        // Get the patch content being accepted (canonical)
        const patchContent = previewState.newText;

        console.log("3-way merge:", {
            base: baseSnapshot.substring(0, 50) + "...",
            local: currentContent.substring(0, 50) + "...",
            canonical: patchContent.substring(0, 50) + "..."
        });

        // Perform merge
        const mergedContent = mergeText(baseSnapshot, currentContent, patchContent);

        // Apply merged result to editor
        const { restoreDocumentState } = await import('./yjs-setup.js');
        restoreDocumentState(mergedContent);

        alert("Patch accepted and merged!");
        exitPreview();

        // Refresh timeline
        window.dispatchEvent(new CustomEvent('patch-status-updated'));

    } catch (err) {
        console.error("Failed to accept patch:", err);
        alert(`Error: ${err}`);
    }
}

/**
 * Reject the current patch being previewed
 */
async function rejectCurrentPatch() {
    if (!previewState.active || !previewState.patchId) return;

    const docId = getActiveDocumentId();
    if (!docId) return;

    try {
        // Update review status in database
        await invoke("update_patch_review_status", {
            docId,
            patchId: previewState.patchId,
            status: "rejected"
        });

        alert("Patch rejected!");
        exitPreview();

        // Refresh timeline
        window.dispatchEvent(new CustomEvent('patch-status-updated'));

    } catch (err) {
        console.error("Failed to reject patch:", err);
        alert(`Error: ${err}`);
    }
}

/**
 * Check if preview mode is active
 * @returns {boolean}
 */
export function isPreviewActive() {
    return previewState.active;
}
