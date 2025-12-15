// src/track-changes.js
// Inline track changes with ProseMirror decorations
// Shows imported patches as line-level changes with accept/reject buttons

import { invoke } from "@tauri-apps/api/core";
import { getActiveDocumentId } from "./document-manager.js";
import { editor, editorViewCtx, getMarkdown, setMarkdownContent } from "./editor.js";
import { getCachedProfile, getCurrentUserInfo } from "./profile-service.js";
import { hexToRgba } from "./utils.js";
import { mergeText } from "./three-way-merge.js";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import { Plugin, PluginKey } from "@milkdown/prose/state";

// State for track changes mode
let trackChangesState = {
    active: false,
    patches: [],           // Patches for reference only
    baseContent: '',       // Content before reconciliation
    changes: [],           // Computed line-level changes (hunks)
    decorationPlugin: null, // ProseMirror plugin reference
    hunkIdCounter: 0       // Counter for unique hunk IDs
};

// Plugin key for decorations
const trackChangesPluginKey = new PluginKey('trackChanges');

/**
 * Compute line-level diff between two texts
 * @param {string} oldText - Base text
 * @param {string} newText - Changed text
 * @returns {Array} Array of {type: 'add'|'delete'|'equal', lines: string[], startLine: number}
 */
function computeLineDiff(oldText, newText) {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');

    const changes = [];

    // Simple LCS-based line diff
    const m = oldLines.length;
    const n = newLines.length;

    // Build LCS table
    const dp = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            if (oldLines[i - 1] === newLines[j - 1]) {
                dp[i][j] = dp[i - 1][j - 1] + 1;
            } else {
                dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
            }
        }
    }

    // Backtrack to build diff
    let i = m, j = n;
    const rawDiff = [];

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
            rawDiff.push({ type: 'equal', line: oldLines[i - 1], oldIdx: i - 1, newIdx: j - 1 });
            i--; j--;
        } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
            rawDiff.push({ type: 'add', line: newLines[j - 1], newIdx: j - 1 });
            j--;
        } else {
            rawDiff.push({ type: 'delete', line: oldLines[i - 1], oldIdx: i - 1 });
            i--;
        }
    }

    rawDiff.reverse();

    // Group consecutive changes of the same type
    let currentGroup = null;

    for (const item of rawDiff) {
        if (!currentGroup || currentGroup.type !== item.type) {
            if (currentGroup) {
                changes.push(currentGroup);
            }
            currentGroup = {
                type: item.type,
                lines: [item.line],
                startLine: item.newIdx !== undefined ? item.newIdx : item.oldIdx
            };
        } else {
            currentGroup.lines.push(item.line);
        }
    }

    if (currentGroup) {
        changes.push(currentGroup);
    }

    return changes;
}

/**
 * Create ProseMirror decorations for track changes
 * @param {Object} state - ProseMirror editor state
 * @param {Array} changes - Array of computed changes
 * @param {Object} patchInfo - Info about the patch (author, color, id)
 * @returns {DecorationSet}
 */
function createTrackChangesDecorations(state, changes, patchInfo) {
    const decorations = [];
    const doc = state.doc;

    // Map line numbers to document positions
    let pos = 0;
    let lineNum = 0;
    const linePositions = [0]; // Start positions of each line

    doc.descendants((node, nodePos) => {
        if (node.isBlock) {
            linePositions.push(nodePos);
        }
        return true;
    });

    // Create decorations for each change
    for (const change of changes) {
        if (change.type === 'equal') continue;

        const lineStart = change.startLine;
        const lineCount = change.lines.length;

        // Find positions in document
        if (lineStart >= 0 && lineStart < linePositions.length) {
            const from = linePositions[lineStart] || 0;
            const to = linePositions[lineStart + lineCount] || doc.content.size;

            // Line decoration (background color)
            const lineClass = change.type === 'add'
                ? 'track-change-addition'
                : 'track-change-deletion';

            const style = `background-color: ${hexToRgba(patchInfo.color, 0.2)}; position: relative;`;

            decorations.push(
                Decoration.inline(from, to, {
                    class: lineClass,
                    style: style,
                    'data-patch-id': patchInfo.id,
                    'data-author': patchInfo.author,
                    'data-change-type': change.type
                })
            );

            // Widget decoration for accept/reject buttons (at start of change block)
            if (change.type === 'add') {
                const widget = document.createElement('span');
                widget.className = 'track-change-actions';
                widget.innerHTML = `
                    <button class="track-accept-btn" data-patch-id="${patchInfo.id}" title="Accept this change">✓</button>
                    <button class="track-reject-btn" data-patch-id="${patchInfo.id}" title="Reject this change">✗</button>
                `;

                decorations.push(
                    Decoration.widget(from, widget, { side: -1 })
                );
            }
        }
    }

    return DecorationSet.create(doc, decorations);
}

/**
 * Enter track changes mode
 * @param {Array} patches - Patches to display as track changes
 */
export async function enterTrackChangesMode(patches) {
    if (!patches || patches.length === 0) {
        console.warn("No patches for track changes");
        return;
    }

    // Get current user info
    const { id: currentUserId } = getCurrentUserInfo();

    // Filter to only pending patches from other authors
    const savePatchesOnly = patches.filter(p =>
        p.kind === "Save" &&
        p.data?.snapshot &&
        p.author !== currentUserId
    );

    if (savePatchesOnly.length === 0) {
        console.log("No patches to review");
        return;
    }

    // Sort by timestamp
    savePatchesOnly.sort((a, b) => a.timestamp - b.timestamp);

    // Get base content (current editor)
    const baseContent = getMarkdown();

    // Compute changes for each patch
    const allChanges = [];

    let hunkIdCounter = 0;

    for (const patch of savePatchesOnly) {
        const patchContent = patch.data.snapshot;
        const changes = computeLineDiff(baseContent, patchContent);

        // Tag each change (hunk) with a unique ID and patch info
        for (const change of changes) {
            if (change.type !== 'equal') {
                allChanges.push({
                    ...change,
                    hunkId: hunkIdCounter++, // Unique hunk ID
                    patchId: patch.id,
                    patchUuid: patch.uuid,
                    author: patch.author,
                    authorName: patch.data?.authorName || patch.author,
                    authorColor: patch.data?.authorColor || '#3498db',
                    timestamp: patch.timestamp,
                    // Store the actual lines for this hunk
                    hunkLines: [...change.lines]
                });
            }
        }
    }

    trackChangesState = {
        active: true,
        patches: savePatchesOnly,
        baseContent,
        changes: allChanges,
        decorationPlugin: null
    };

    // Install decoration plugin in editor
    installTrackChangesPlugin();

    // Show banner
    showTrackChangesBanner();
}

/**
 * Exit track changes mode
 */
export function exitTrackChangesMode() {
    trackChangesState = {
        active: false,
        patches: [],
        baseContent: '',
        changes: [],
        decorationPlugin: null
    };

    // Remove decoration plugin
    removeTrackChangesPlugin();

    // Hide banner
    hideTrackChangesBanner();
}

/**
 * Install the track changes decoration plugin
 */
function installTrackChangesPlugin() {
    if (!editor) return;

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const state = view.state;

        // Create the decoration plugin
        const trackChangesPlugin = new Plugin({
            key: trackChangesPluginKey,
            state: {
                init: (_, editorState) => {
                    return buildDecorations(editorState);
                },
                apply: (tr, decorationSet, oldState, newState) => {
                    // Rebuild decorations if document changed
                    if (tr.docChanged) {
                        return buildDecorations(newState);
                    }
                    return decorationSet.map(tr.mapping, tr.doc);
                }
            },
            props: {
                decorations: (state) => {
                    return trackChangesPluginKey.getState(state);
                }
            }
        });

        // Add plugin to editor
        const newState = state.reconfigure({
            plugins: [...state.plugins, trackChangesPlugin]
        });

        view.updateState(newState);

        // Store reference
        trackChangesState.decorationPlugin = trackChangesPlugin;
    });

    // Add click handlers for accept/reject buttons
    setupButtonHandlers();
}

/**
 * Build decorations from current track changes state
 */
function buildDecorations(editorState) {
    if (!trackChangesState.active || trackChangesState.changes.length === 0) {
        return DecorationSet.empty;
    }

    const decorations = [];
    const doc = editorState.doc;

    // Map line numbers to positions
    const linePositions = [];
    let lineNum = 0;

    doc.descendants((node, pos) => {
        if (node.isTextblock) {
            linePositions.push({ pos, size: node.nodeSize });
        }
        return true;
    });

    // Group changes by starting line for overlapping detection
    const changesByLine = new Map();

    for (const change of trackChangesState.changes) {
        const key = change.startLine;
        if (!changesByLine.has(key)) {
            changesByLine.set(key, []);
        }
        changesByLine.get(key).push(change);
    }

    // Create decorations
    for (const [lineIdx, changes] of changesByLine.entries()) {
        if (lineIdx < 0 || lineIdx >= linePositions.length) continue;

        const lineInfo = linePositions[lineIdx];
        if (!lineInfo) continue;

        const from = lineInfo.pos + 1; // Skip into the paragraph
        const to = lineInfo.pos + lineInfo.size - 1;

        // Check for conflicts (multiple changes from different authors at same line)
        const hasConflict = changes.length > 1;
        const uniqueAuthors = new Set(changes.map(c => c.author));
        const isMultiAuthorConflict = uniqueAuthors.size > 1;

        // For each change at this line, create decorations
        for (let i = 0; i < changes.length; i++) {
            const change = changes[i];

            // Background decoration with author color
            const bgStyle = change.type === 'add'
                ? `background-color: ${hexToRgba(change.authorColor, 0.25)};`
                : `background-color: ${hexToRgba(change.authorColor, 0.15)}; text-decoration: line-through;`;

            decorations.push(
                Decoration.inline(from, Math.min(to, doc.content.size), {
                    class: `track-change-line track-change-${change.type}`,
                    style: bgStyle,
                    'data-patch-id': change.patchId,
                    'data-author': change.author
                })
            );
        }

        // Widget for ALL changes at this line (not just additions)
        // Show first change's info, but indicate if there are conflicts
        const firstChange = changes[0];
        const widget = createChangeWidget(firstChange, isMultiAuthorConflict, changes);
        decorations.push(
            Decoration.widget(from, widget, {
                side: -1,
                key: `widget-${lineIdx}-${firstChange.patchId}`
            })
        );
    }

    return DecorationSet.create(doc, decorations);
}

/**
 * Create accept/reject widget for a change
 */
function createChangeWidget(change, hasConflict, allChangesAtLine) {
    const widget = document.createElement('span');
    widget.className = 'track-change-widget';
    widget.contentEditable = 'false';

    // Build authors list for conflicts
    let authorsHtml = '';
    if (hasConflict && allChangesAtLine.length > 1) {
        const uniqueAuthors = [...new Set(allChangesAtLine.map(c => c.authorName))];
        authorsHtml = uniqueAuthors.map(name => {
            const authorChange = allChangesAtLine.find(c => c.authorName === name);
            return `<span class="track-author-badge" style="background-color:${authorChange?.authorColor || '#3498db'};color:white;">${name}</span>`;
        }).join(' ');
    } else {
        authorsHtml = `<span class="track-author-badge" style="background-color:${change.authorColor};color:white;">${change.authorName}</span>`;
    }

    // Create the widget content
    widget.innerHTML = authorsHtml;

    // Add conflict badge and merge button if needed
    if (hasConflict) {
        const conflictBadge = document.createElement('span');
        conflictBadge.className = 'track-conflict-badge';
        conflictBadge.title = 'Conflicting changes from multiple authors';
        conflictBadge.textContent = '⚠️';
        widget.appendChild(conflictBadge);

        const mergeBtn = document.createElement('button');
        mergeBtn.className = 'track-merge-btn';
        mergeBtn.title = 'Merge conflicting versions';
        mergeBtn.textContent = '🪄';
        mergeBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            await openConflictMergeModal(allChangesAtLine);
        });
        widget.appendChild(mergeBtn);
    }

    // Accept button - attach handler directly (hunk-based)
    const acceptBtn = document.createElement('button');
    acceptBtn.className = 'track-accept-btn';
    acceptBtn.title = 'Accept this change';
    acceptBtn.textContent = '✓';
    acceptBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Accept hunk:', change.hunkId, 'lines:', change.hunkLines);
        await acceptHunk(change);
    });
    widget.appendChild(acceptBtn);

    // Reject button - attach handler directly (hunk-based)
    const rejectBtn = document.createElement('button');
    rejectBtn.className = 'track-reject-btn';
    rejectBtn.title = 'Reject this change';
    rejectBtn.textContent = '✗';
    rejectBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Reject hunk:', change.hunkId);
        await rejectHunk(change);
    });
    widget.appendChild(rejectBtn);

    return widget;
}

/**
 * Remove the track changes plugin from editor
 */
function removeTrackChangesPlugin() {
    if (!editor) return;

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const state = view.state;

        // Filter out the track changes plugin
        const newPlugins = state.plugins.filter(p =>
            p.key !== trackChangesPluginKey.key &&
            !p.key.startsWith('trackChanges')
        );

        const newState = state.reconfigure({
            plugins: newPlugins
        });

        view.updateState(newState);
    });
}

/**
 * Setup click handlers for accept/reject buttons
 */
function setupButtonHandlers() {
    // Use event delegation on the editor container
    const editorEl = document.getElementById('editor');
    if (!editorEl) return;

    // Remove existing handler if any
    editorEl.removeEventListener('click', handleWidgetClick);

    // Add new handler
    editorEl.addEventListener('click', handleWidgetClick);
}

/**
 * Handle clicks on accept/reject buttons
 */
async function handleWidgetClick(e) {
    const target = e.target;

    if (target.classList.contains('track-accept-btn')) {
        e.preventDefault();
        e.stopPropagation();
        const patchId = parseInt(target.dataset.patchId);
        const patchUuid = target.dataset.patchUuid;
        await acceptChange(patchId, patchUuid);
    } else if (target.classList.contains('track-reject-btn')) {
        e.preventDefault();
        e.stopPropagation();
        const patchId = parseInt(target.dataset.patchId);
        const patchUuid = target.dataset.patchUuid;
        await rejectChange(patchId, patchUuid);
    } else if (target.classList.contains('track-merge-btn')) {
        e.preventDefault();
        e.stopPropagation();
        const lineChanges = JSON.parse(target.dataset.lineChanges || '[]');
        await openConflictMergeModal(lineChanges);
    }
}

/**
 * Accept a hunk (apply specific line changes to current content)
 * @param {Object} hunk - The hunk object containing lines to apply
 */
async function acceptHunk(hunk) {
    try {
        // Get current content
        const currentContent = getMarkdown();
        const lines = currentContent.split('\n');

        if (hunk.type === 'add') {
            // Insert the hunk's lines at the specified position
            const insertAt = Math.min(hunk.startLine, lines.length);
            lines.splice(insertAt, 0, ...hunk.hunkLines);
        } else if (hunk.type === 'delete') {
            // For deletions, we don't need to do anything special here
            // The deletion has already happened in the patch - accepting means we confirm it
            // The base content already doesn't have these lines
            // So accepting a deletion is a no-op on the content
        }

        // Apply the modified content
        const newContent = lines.join('\n');
        setMarkdownContent(newContent);

        // Remove this hunk from state
        trackChangesState.changes = trackChangesState.changes.filter(c => c.hunkId !== hunk.hunkId);

        // Update base content for subsequent calculations
        trackChangesState.baseContent = newContent;

        // Recalculate all remaining changes based on new content
        recalculateChanges();

        // Refresh decorations
        refreshDecorations();

        // If no more changes, exit track changes mode
        if (trackChangesState.changes.length === 0) {
            exitTrackChangesMode();
        }

        console.log('Hunk accepted, remaining changes:', trackChangesState.changes.length);
    } catch (err) {
        console.error("Failed to accept hunk:", err);
    }
}

/**
 * Reject a hunk (just remove it from view, don't apply)
 * @param {Object} hunk - The hunk object to reject
 */
async function rejectHunk(hunk) {
    try {
        // Simply remove this hunk from state (don't apply changes)
        trackChangesState.changes = trackChangesState.changes.filter(c => c.hunkId !== hunk.hunkId);

        // Refresh decorations
        refreshDecorations();

        // If no more changes, exit track changes mode
        if (trackChangesState.changes.length === 0) {
            exitTrackChangesMode();
        }

        console.log('Hunk rejected, remaining changes:', trackChangesState.changes.length);
    } catch (err) {
        console.error("Failed to reject hunk:", err);
    }
}

/**
 * Recalculate remaining changes based on new base content
 * This updates startLine positions after content has been modified
 */
function recalculateChanges() {
    // For now, we just adjust line positions
    // A more sophisticated approach would recompute diffs
    // But for simple cases, we can just shift line numbers

    // Get the new content and sort remaining changes
    const newContent = getMarkdown();
    const newLines = newContent.split('\n');

    // Re-sort changes by startLine
    trackChangesState.changes.sort((a, b) => a.startLine - b.startLine);

    // Note: This is a simplified approach. After inserting lines,
    // subsequent line numbers may shift. For a more robust solution,
    // we would recompute the diffs entirely.
}

/**
 * Refresh decorations after state change
 */
function refreshDecorations() {
    if (!editor) return;

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        // Force a transaction to trigger decoration rebuild
        const tr = view.state.tr.setMeta(trackChangesPluginKey, { refresh: true });
        view.dispatch(tr);
    });
}

/**
 * Show the track changes banner
 */
function showTrackChangesBanner() {
    let banner = document.getElementById('track-changes-banner');

    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'track-changes-banner';
        banner.className = 'track-changes-banner';

        const editorContainer = document.getElementById('editor');
        if (editorContainer && editorContainer.parentElement) {
            editorContainer.parentElement.insertBefore(banner, editorContainer);
        }
    }

    const hunkCount = trackChangesState.changes.length;
    const authors = [...new Set(trackChangesState.changes.map(c => c.authorName))];

    banner.innerHTML = `
        <div class="track-changes-info">
            <span class="track-changes-label">📋 Track Changes</span>
            <span class="track-changes-count">${hunkCount} hunk${hunkCount !== 1 ? 's' : ''} from ${authors.join(', ')}</span>
        </div>
        <div class="track-changes-controls">
            <button id="track-accept-all-btn" class="track-btn accept">✓ Accept All</button>
            <button id="track-reject-all-btn" class="track-btn reject">✗ Reject All</button>
            <button id="track-exit-btn" class="track-btn">Exit Track Changes</button>
        </div>
    `;

    // Wire up buttons
    banner.querySelector('#track-accept-all-btn')?.addEventListener('click', acceptAllChanges);
    banner.querySelector('#track-reject-all-btn')?.addEventListener('click', rejectAllChanges);
    banner.querySelector('#track-exit-btn')?.addEventListener('click', exitTrackChangesMode);

    banner.style.display = 'flex';
}

/**
 * Hide the track changes banner
 */
function hideTrackChangesBanner() {
    const banner = document.getElementById('track-changes-banner');
    if (banner) {
        banner.style.display = 'none';
    }
}

/**
 * Accept all pending hunks
 */
async function acceptAllChanges() {
    // Accept hunks one by one (copy array since it will be modified)
    for (const hunk of [...trackChangesState.changes]) {
        await acceptHunk(hunk);
    }
}

/**
 * Reject all pending hunks
 */
async function rejectAllChanges() {
    // Reject hunks one by one (copy array since it will be modified)
    for (const hunk of [...trackChangesState.changes]) {
        await rejectHunk(hunk);
    }
}

/**
 * Check if track changes mode is active
 */
export function isTrackChangesActive() {
    return trackChangesState.active;
}

/**
 * Open conflict merge modal with editable textarea
 * @param {Array} lineChanges - Array of {patchId, patchUuid, author} for conflicting changes
 */
async function openConflictMergeModal(lineChanges) {
    // Get all patches involved in this conflict
    const patchIds = lineChanges.map(c => c.patchId);
    const conflictingPatches = trackChangesState.patches.filter(p => patchIds.includes(p.id));

    if (conflictingPatches.length < 2) {
        console.warn("Not enough patches for merge");
        return;
    }

    // Get base content (current editor) and all patch contents
    const baseContent = trackChangesState.baseContent;
    const patchContents = conflictingPatches.map(p => ({
        author: p.data?.authorName || p.author,
        content: p.data?.snapshot || '',
        patchId: p.id,
        patchUuid: p.uuid
    }));

    // Perform initial merge with conflict markers
    let mergedContent = baseContent;
    for (const patch of patchContents) {
        mergedContent = mergeTextWithMarkers(baseContent, mergedContent, patch.content, patch.author);
    }

    // Create modal
    let modal = document.getElementById('conflict-merge-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'conflict-merge-modal';
        modal.className = 'modal';
        document.body.appendChild(modal);
    }

    modal.innerHTML = `
        <div class="modal-content conflict-merge-modal-content">
            <div class="modal-header">
                <h2>🪄 Resolve Conflict</h2>
                <button class="modal-close">&times;</button>
            </div>
            <div class="modal-body">
                <p class="conflict-merge-hint">
                    Edit the text below to resolve conflicts. 
                    Look for <code>&lt;&lt;&lt;&lt;&lt;&lt;&lt;</code> and <code>&gt;&gt;&gt;&gt;&gt;&gt;&gt;</code> markers.
                </p>
                <div class="conflict-authors">
                    ${patchContents.map(p =>
        `<span class="track-author-badge" style="background-color:#3498db;color:white;">${p.author}</span>`
    ).join(' ')}
                </div>
                <textarea id="conflict-merge-textarea" class="conflict-merge-textarea">${escapeHtml(mergedContent)}</textarea>
            </div>
            <div class="modal-footer">
                <button id="conflict-cancel-btn" class="action-btn">Cancel</button>
                <button id="conflict-apply-btn" class="btn-primary">Apply Merged Content</button>
            </div>
        </div>
    `;

    modal.style.display = 'flex';

    // Focus textarea
    const textarea = modal.querySelector('#conflict-merge-textarea');
    textarea?.focus();

    // Close button
    modal.querySelector('.modal-close')?.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    // Cancel button
    modal.querySelector('#conflict-cancel-btn')?.addEventListener('click', () => {
        modal.style.display = 'none';
    });

    // Apply button
    modal.querySelector('#conflict-apply-btn')?.addEventListener('click', async () => {
        const resolvedContent = textarea?.value || '';

        // Apply the resolved content
        setMarkdownContent(resolvedContent);

        // Mark all conflicting patches as resolved (accepted)
        const docId = getActiveDocumentId();
        const { id: currentUserId, name: currentUserName } = getCurrentUserInfo();

        for (const patch of patchContents) {
            if (patch.patchUuid) {
                await invoke("record_document_patch_review", {
                    docId,
                    patchUuid: patch.patchUuid,
                    reviewerId: currentUserId,
                    decision: "accepted",
                    reviewerName: currentUserName
                }).catch(err => console.error("Failed to record review:", err));
            }

            // Remove from state
            trackChangesState.patches = trackChangesState.patches.filter(p => p.id !== patch.patchId);
            trackChangesState.changes = trackChangesState.changes.filter(c => c.patchId !== patch.patchId);
        }

        // Close modal
        modal.style.display = 'none';

        // Refresh decorations
        refreshDecorations();

        // Notify timeline
        window.dispatchEvent(new CustomEvent('patch-status-updated'));

        // If no more changes, exit track changes mode
        if (trackChangesState.changes.length === 0) {
            exitTrackChangesMode();
        }
    });

    // Click outside to close
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });
}

/**
 * Merge text with conflict markers (similar to git merge conflicts)
 */
function mergeTextWithMarkers(base, current, incoming, incomingAuthor) {
    const baseLines = base.split('\n');
    const currentLines = current.split('\n');
    const incomingLines = incoming.split('\n');

    const result = [];
    const maxLen = Math.max(baseLines.length, currentLines.length, incomingLines.length);

    let i = 0;
    while (i < maxLen) {
        const baseLine = baseLines[i] || '';
        const currLine = currentLines[i] || '';
        const incomLine = incomingLines[i] || '';

        if (currLine === incomLine) {
            // No conflict
            result.push(currLine);
        } else if (baseLine === currLine && baseLine !== incomLine) {
            // Incoming change only
            result.push(incomLine);
        } else if (baseLine === incomLine && baseLine !== currLine) {
            // Current change only
            result.push(currLine);
        } else {
            // Real conflict - add markers
            result.push(`<<<<<<< Current`);
            result.push(currLine);
            result.push(`=======`);
            result.push(incomLine);
            result.push(`>>>>>>> ${incomingAuthor}`);
        }
        i++;
    }

    return result.join('\n');
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
