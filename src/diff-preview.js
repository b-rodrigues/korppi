// src/diff-preview.js
// Visual diff preview using inline ghost decorations (track-changes style)

import { calculateCharDiff } from './diff-highlighter.js';
import { showDiffPreview, clearEditorHighlight, getMarkdownToPmMapping } from './editor.js';
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

    // Get character-to-PM-position mapping
    const { charToPm } = getMarkdownToPmMapping();

    // For coordinate mapping, we don't need 'pmText' stripping.
    // The diff is calculated against the original Markdown text (which we don't have here easily?)
    // Wait, renderGhostPreview relies on `calculateCharDiff` between `oldText` and `newText`.
    // oldText was `pmText`?
    // In strict mode, previewState.oldText SHOULD be the Markdown Content?

    // If we use getMarkdownToPmMapping, we assume `previewState.oldText` is the FULL MARKDOWN.
    // And `previewState.newText` is the NEW FULL MARKDOWN.
    // So `diff` is computed on Markdown chars.
    // And `charToPm` maps Markdown chars to PM.
    // This is correct.

    const diff = calculateCharDiff(previewState.oldText, previewState.newText);

    // Convert diff operations to PM-position-based operations
    const operations = [];
    let oldOffset = 0; // Track position in oldPlainText (which matches pmText)

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
            let toPm = charToPm(toChar);

            // Debug
            // Ensure minimum range of 1 for non-empty deletes
            if (op.text.length > 0 && toPm <= fromPm) {
                toPm = fromPm + 1;
            }

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

            // Debug


            operations.push({
                type: 'add',
                text: op.text,
                pos: posPm
            });
            // Don't advance oldOffset for additions
        }
    }

    // Debug final operations


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

