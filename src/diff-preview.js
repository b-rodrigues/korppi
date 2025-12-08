// src/diff-preview.js
// Visual diff preview overlay for patches

import { invoke } from '@tauri-apps/api/core';
import { calculateCharDiff } from './diff-highlighter.js';
import { getCachedProfile } from './profile-service.js';
import { getActiveDocumentId } from './document-manager.js';
import { mergeText } from './three-way-merge.js';
import { hexToRgba, escapeHtml } from './utils.js';
import { getEditorContent } from './editor.js';
import { getConflictState } from './timeline.js';
import { getConflictGroup } from './conflict-detection.js';

let previewState = {
    active: false,
    mode: 'highlight', // 'highlight' or 'diff'
    patchId: null,
    oldText: '',
    newText: '',
    conflictGroup: null // Array of patch IDs in the same conflict group
};

/**
 * Enter preview mode for a patch
 * @param {number} patchId - Patch ID
 * @param {string} oldText - Previous version text
 * @param {string} newText - Current version text
 */
export function enterPreview(patchId, oldText, newText) {
    // Get conflict group if this patch is in conflict
    const conflictState = getConflictState();
    const conflictGroup = getConflictGroup(patchId, conflictState.conflictGroups);

    previewState = {
        active: true,
        mode: 'highlight',
        patchId,
        oldText,
        newText,
        conflictGroup
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
        newText: '',
        conflictGroup: null
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
                <div id="conflict-tabs" class="conflict-tabs"></div>
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

        if (acceptBtn) {
            acceptBtn.addEventListener('click', async () => {
                await acceptCurrentPatch();
            });
        }

        if (rejectBtn) {
            rejectBtn.addEventListener('click', async () => {
                await rejectCurrentPatch();
            });
        }
    }

    // Update patch ID
    const patchIdEl = banner.querySelector('#preview-patch-id');
    if (patchIdEl) {
        patchIdEl.textContent = previewState.patchId;
    }

    // Update conflict tabs if this patch is in a conflict group
    updateConflictTabs();

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
        overlay.className = 'diff-preview-overlay';
        const editorContainer = document.getElementById('editor');
        if (editorContainer && editorContainer.parentElement) {
            // Insert before the editor so it appears at the top, below the banner
            editorContainer.parentElement.insertBefore(overlay, editorContainer);
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

    const currentPatchId = previewState.patchId;

    try {
        // Update review status in database
        await invoke("update_patch_review_status", {
            docId,
            patchId: currentPatchId,
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

        // Perform merge
        const mergedContent = mergeText(baseSnapshot, currentContent, patchContent);

        // Apply merged result to editor
        const { restoreDocumentState } = await import('./yjs-setup.js');
        restoreDocumentState(mergedContent);

        // Refresh timeline first
        window.dispatchEvent(new CustomEvent('patch-status-updated'));

        // Try to advance to the next pending patch in the conflict group
        await advanceToNextPendingPatch(currentPatchId);

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

    const currentPatchId = previewState.patchId;

    try {
        // Update review status in database
        await invoke("update_patch_review_status", {
            docId,
            patchId: currentPatchId,
            status: "rejected"
        });

        // Refresh timeline first
        window.dispatchEvent(new CustomEvent('patch-status-updated'));

        // Try to advance to the next pending patch in the conflict group
        await advanceToNextPendingPatch(currentPatchId);

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

/**
 * Get pending patch IDs in the current conflict group
 * @param {number|null} excludePatchId - Optional patch ID to exclude from results
 * @returns {Promise<Array<number>>} - Array of pending patch IDs
 */
async function getPendingConflictPatchIds(excludePatchId = null) {
    if (!previewState.conflictGroup || previewState.conflictGroup.length <= 1) {
        return [];
    }

    const { fetchPatchList } = await import('./timeline.js');
    const allPatches = await fetchPatchList();

    return previewState.conflictGroup.filter(patchId => {
        if (excludePatchId !== null && patchId === excludePatchId) return false;
        const patch = allPatches.find(p => p.id === patchId);
        return patch && patch.review_status === 'pending';
    });
}

/**
 * Advance to the next pending patch in the conflict group
 * If no more pending patches, exit preview
 * @param {number} justProcessedPatchId - The patch that was just accepted/rejected
 */
async function advanceToNextPendingPatch(justProcessedPatchId) {
    // If no conflict group, just exit
    if (!previewState.conflictGroup || previewState.conflictGroup.length <= 1) {
        exitPreview();
        return;
    }

    // Find remaining pending patches (excluding the just-processed one)
    const remainingPending = await getPendingConflictPatchIds(justProcessedPatchId);

    // If no more pending patches, exit preview
    if (remainingPending.length === 0) {
        exitPreview();
        return;
    }

    // Switch to the first remaining pending patch
    const nextPatchId = remainingPending[0];
    await switchToConflictPatch(nextPatchId);

    // Update the conflict tabs to reflect the new state
    await updateConflictTabs();
}

/**
 * Update the conflict tabs in the preview banner
 */
async function updateConflictTabs() {
    const tabsContainer = document.getElementById('conflict-tabs');
    if (!tabsContainer) return;

    // Clear existing tabs
    tabsContainer.innerHTML = '';

    // Get pending patches in the conflict group
    const pendingPatchIds = await getPendingConflictPatchIds();

    // Only show tabs if there are multiple pending patches in conflict
    if (pendingPatchIds.length <= 1) {
        return;
    }

    // Show warning indicator
    const warningDiv = document.createElement('div');
    warningDiv.className = 'conflict-warning-header';
    warningDiv.innerHTML = '⚠️ Conflicting patches:';
    warningDiv.style.cssText = 'color:#f44336;font-weight:bold;font-size:0.9rem;margin-right:8px;';
    tabsContainer.appendChild(warningDiv);

    // Create tabs for each pending patch in the conflict group
    for (const patchId of pendingPatchIds) {
        const tab = document.createElement('button');
        tab.className = 'conflict-tab';
        tab.dataset.patchId = patchId;
        tab.textContent = `Patch #${patchId}`;

        if (patchId === previewState.patchId) {
            tab.classList.add('active');
        }

        tab.addEventListener('click', async () => {
            await switchToConflictPatch(patchId);
        });

        tabsContainer.appendChild(tab);
    }
}

/**
 * Switch preview to a different patch in the conflict group
 * @param {number} patchId - The patch ID to switch to
 */
async function switchToConflictPatch(patchId) {
    if (patchId === previewState.patchId) return;

    // Import fetchPatch from timeline
    const { fetchPatch, fetchPatchList } = await import('./timeline.js');

    const patch = await fetchPatch(patchId);
    if (!patch) {
        alert("Failed to load patch");
        return;
    }

    // Get current editor content as the "old" state
    const currentContent = getEditorContent();

    // Calculate what the merged result would be (3-way merge simulation)
    const allPatches = await fetchPatchList();
    const savePatchesOnly = allPatches
        .filter(p => p.kind === "Save" && p.data?.snapshot)
        .sort((a, b) => a.timestamp - b.timestamp);

    const baseSnapshot = savePatchesOnly.length > 0
        ? savePatchesOnly[0].data.snapshot
        : '';

    const patchContent = patch.data?.snapshot || '';

    // Simulate what the merge would produce
    const mergedResult = mergeText(baseSnapshot, currentContent, patchContent);

    // Update preview state
    previewState.patchId = patchId;
    previewState.oldText = currentContent;
    previewState.newText = mergedResult;

    // Update UI
    const patchIdEl = document.querySelector('#preview-patch-id');
    if (patchIdEl) {
        patchIdEl.textContent = patchId;
    }

    // Update tab states
    document.querySelectorAll('.conflict-tab').forEach(tab => {
        tab.classList.toggle('active', parseInt(tab.dataset.patchId) === patchId);
    });

    // Re-render preview
    renderPreview();
}
