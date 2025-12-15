// src/diff-preview.js
// Visual diff preview overlay for patches

import { invoke } from '@tauri-apps/api/core';
import { calculateCharDiff } from './diff-highlighter.js';
import { getCachedProfile, getCurrentUserInfo } from './profile-service.js';
import { getActiveDocumentId } from './document-manager.js';
import { mergeText } from './three-way-merge.js';
import { hexToRgba, escapeHtml } from './utils.js';
import { getEditorContent, getMarkdown } from './editor.js';
import { getConflictState } from './timeline.js';
import { getConflictGroup } from './conflict-detection.js';

let previewState = {
    active: false,
    mode: 'diff', // 'diff' or 'highlight'
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
        mode: 'diff',
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
        mode: 'diff',
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
            </div>
            <div class="preview-controls">
                <button class="mode-btn" data-mode="highlight">🎨 Highlight</button>
                <button class="mode-btn active" data-mode="diff">📝 Diff</button>
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
        const { fetchPatch } = await import('./timeline.js');
        const patch = await fetchPatch(currentPatchId);
        if (patch && patch.uuid) {
            const { id: currentUserId, name: currentUserName } = getCurrentUserInfo();

            await invoke("record_document_patch_review", {
                docId,
                patchUuid: patch.uuid,
                reviewerId: currentUserId,
                decision: "accepted",
                reviewerName: currentUserName
            });
        }

        // Perform 3-way merge
        // base: original document (from first patch)
        // local: current editor content
        // canonical: the ORIGINAL patch snapshot (NOT previewState.newText which is already merged)

        const { fetchPatchList } = await import('./timeline.js');
        const allPatches = await fetchPatchList();

        // Find the base snapshot (first patch)
        const savePatchesOnly = allPatches
            .filter(p => p.kind === "Save" && p.data?.snapshot)
            .sort((a, b) => a.timestamp - b.timestamp);

        const baseSnapshot = savePatchesOnly.length > 0
            ? savePatchesOnly[0].data.snapshot
            : '';

        // Get current editor content as markdown (local)
        const currentContent = getMarkdown();

        // Get the ORIGINAL patch snapshot (not the preview merged content)
        const patchContent = patch.data?.snapshot || '';

        // Perform merge
        const mergedContent = mergeText(baseSnapshot, currentContent, patchContent);

        // Apply merged result to editor using markdown-aware function
        const { setMarkdownContent } = await import('./editor.js');
        setMarkdownContent(mergedContent);

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
        const { fetchPatch } = await import('./timeline.js');
        const patch = await fetchPatch(currentPatchId);
        if (patch && patch.uuid) {
            const { id: currentUserId, name: currentUserName } = getCurrentUserInfo();

            await invoke("record_document_patch_review", {
                docId,
                patchUuid: patch.uuid,
                reviewerId: currentUserId,
                decision: "rejected",
                reviewerName: currentUserName
            });
        }

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
    const docId = getActiveDocumentId();
    const { id: currentUserId } = getCurrentUserInfo();

    // Build a map of patch ID to patch for quick lookup
    const patchMap = new Map(allPatches.map(p => [p.id, p]));

    // Filter conflict group to only include pending patches
    const pendingIds = [];

    for (const patchId of previewState.conflictGroup) {
        if (excludePatchId !== null && patchId === excludePatchId) continue;

        const patch = patchMap.get(patchId);
        if (!patch) continue;

        // Patches by current user are implicitly accepted (not pending)
        if (patch.author === currentUserId) continue;

        // Check if current user has already reviewed this patch
        if (patch.uuid && docId) {
            const reviews = await invoke("get_document_patch_reviews", {
                docId,
                patchUuid: patch.uuid
            }).catch(() => []);

            const hasReviewed = reviews.some(r => r.reviewer_id === currentUserId);
            if (hasReviewed) continue;
        }

        pendingIds.push(patchId);
    }

    return pendingIds;
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

    // Add "Resolve Conflict" button if there are multiple conflicting patches
    const resolveBtn = document.createElement('button');
    resolveBtn.className = 'resolve-conflict-btn';
    resolveBtn.innerHTML = '🔀 Resolve Conflict';
    resolveBtn.style.cssText = 'margin-left:12px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-weight:600;font-size:11px;';
    resolveBtn.addEventListener('click', async () => {
        // Exit preview first
        exitPreview();
        // Open merge wizard with these patches
        const { openPatchMergeWizardWithPatches } = await import('./patch-merge-wizard.js');
        openPatchMergeWizardWithPatches(pendingPatchIds);
    });
    tabsContainer.appendChild(resolveBtn);
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

    // Get current editor content as markdown (the "old" state)
    const currentContent = getMarkdown();

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
