// src/diff-preview.js
// Visual diff preview using inline ghost decorations (track-changes style)

import { invoke } from '@tauri-apps/api/core';
import { calculateCharDiff } from './diff-highlighter.js';
import { getCachedProfile, getCurrentUserInfo } from './profile-service.js';
import { getActiveDocumentId } from './document-manager.js';
import { mergeText } from './three-way-merge.js';
import { getMarkdown, showDiffPreview, clearEditorHighlight, getCharToPmMapping } from './editor.js';
import { getConflictState, restoreToPatch } from './timeline.js';
import { getConflictGroup } from './conflict-detection.js';

let previewState = {
    active: false,
    patchId: null,
    oldText: '',
    newText: '',
    conflictGroup: null // Array of patch IDs in the same conflict group
};

/**
 * Enter preview mode for a patch
 * @param {number} patchId - Patch ID
 * @param {string} oldText - Previous version text (current editor content)
 * @param {string} newText - New version text (merged result)
 */
export function enterPreview(patchId, oldText, newText) {
    // Get conflict group if this patch is in conflict
    const conflictState = getConflictState();
    const conflictGroup = getConflictGroup(patchId, conflictState.conflictGroups);

    previewState = {
        active: true,
        patchId,
        oldText,
        newText,
        conflictGroup
    };

    showPreviewBanner();
    renderGhostPreview();
}

/**
 * Exit preview mode
 */
export function exitPreview() {
    previewState = {
        active: false,
        patchId: null,
        oldText: '',
        newText: '',
        conflictGroup: null
    };

    hidePreviewBanner();
    clearEditorHighlight();
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
                <span class="preview-label">👁 Previewing Patch #<span id="preview-patch-id"></span></span>
                <span class="preview-hint">(changes shown inline)</span>
            </div>
            <div id="conflict-tabs"></div>
            <div class="preview-controls">
                <button class="restore-btn" title="Restore document to this patch version">↺ Restore</button>
                <button class="exit-btn">✕ Exit Preview</button>
            </div>
        `;

        const editorContainer = document.getElementById('editor');
        if (editorContainer) {
            editorContainer.parentElement.insertBefore(banner, editorContainer);
        }

        // Wire up Exit Preview button
        banner.querySelector('.exit-btn').addEventListener('click', () => {
            exitPreview();
        });

        // Wire up Restore button
        banner.querySelector('.restore-btn').addEventListener('click', async () => {
            if (previewState.patchId) {
                const success = await restoreToPatch(previewState.patchId);
                if (success) {
                    exitPreview();
                }
            }
        });
    }

    // Update patch ID
    const patchIdEl = banner.querySelector('#preview-patch-id');
    if (patchIdEl) {
        patchIdEl.textContent = previewState.patchId;
    }

    // Update conflict tabs if in a conflict group
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
 * Render the ghost preview using inline decorations
 */
function renderGhostPreview() {
    if (!previewState.active) return;

    // Calculate character-level diff between old (current) and new (merged) text
    const diff = calculateCharDiff(previewState.oldText, previewState.newText);

    // Get character-to-PM-position mapping
    const { charToPm, pmText, docSize } = getCharToPmMapping();

    // Convert diff operations to PM-position-based operations
    const operations = [];
    let oldOffset = 0; // Track position in oldText

    for (const op of diff) {
        if (op.type === 'equal') {
            // Advance position in old text
            oldOffset += op.text.length;
        } else if (op.type === 'delete') {
            // Text being removed - highlight in editor
            const fromChar = oldOffset;
            const toChar = oldOffset + op.text.length;

            // Map character offsets to PM positions
            const fromPm = charToPm(fromChar);
            const toPm = charToPm(toChar);

            if (fromPm < toPm) {
                operations.push({
                    type: 'delete',
                    from: fromPm,
                    to: toPm
                });
            }

            oldOffset += op.text.length;
        } else if (op.type === 'add') {
            // Text being added - show as ghost insert widget
            const posPm = charToPm(oldOffset);

            operations.push({
                type: 'add',
                text: op.text,
                pos: posPm
            });
            // Don't advance oldOffset for additions
        }
    }

    // Apply the decorations to the editor
    showDiffPreview(operations);
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
 * Update the conflict tabs in the preview banner
 */
async function updateConflictTabs() {
    const tabsContainer = document.getElementById('conflict-tabs');
    if (!tabsContainer) return;

    // Clear existing tabs
    tabsContainer.innerHTML = '';

    // Only show tabs if in a conflict group with multiple patches
    if (!previewState.conflictGroup || previewState.conflictGroup.length <= 1) {
        return;
    }

    // Get pending patches in the conflict group
    const pendingPatchIds = await getPendingConflictPatchIds();

    // Only show tabs if there are multiple pending patches
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
        tab.textContent = `#${patchId}`;

        if (patchId === previewState.patchId) {
            tab.classList.add('active');
        }

        tab.addEventListener('click', async () => {
            await switchToConflictPatch(patchId);
        });

        tabsContainer.appendChild(tab);
    }

    // Add "Resolve Conflict" button
    const resolveBtn = document.createElement('button');
    resolveBtn.className = 'resolve-conflict-btn';
    resolveBtn.innerHTML = '🔀 Merge';
    resolveBtn.style.cssText = 'margin-left:12px;background:linear-gradient(135deg,#667eea 0%,#764ba2 100%);color:white;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;font-weight:600;font-size:11px;';
    resolveBtn.addEventListener('click', async () => {
        exitPreview();
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

    // Re-render ghost preview
    renderGhostPreview();
}
