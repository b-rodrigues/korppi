// src/hunk-review-panel.js
// Track Changes tab in right sidebar - reviews hunks with Word-Level Position Shifting
// Updates character offsets locally and detects overlaps.

import { getReconciliationHunks, clearReconciliationHunks } from './reconcile.js';
import { getMarkdown, setMarkdownContent, highlightEditorRange, clearEditorHighlight, scrollToEditorRange, highlightByText, previewHunkWithDiff } from './editor.js';
import { showRightSidebar } from './components/sidebar-controller.js';
import { getProfile } from './profile-service.js';
import { escapeHtml } from './utils.js';
import { getActiveDocumentId, onDocumentChange } from './document-manager.js';

// Per-document state storage
// Map<docId, reviewState>
const documentReviewStates = new Map();

// Helper to get or create state for current document
function getCurrentState() {
    const docId = getActiveDocumentId();
    if (!docId) return null;

    if (!documentReviewStates.has(docId)) {
        documentReviewStates.set(docId, {
            active: false,
            hunks: [],
            acceptedHunkIds: new Set(),
            rejectedHunkIds: new Set(),
            conflictHunkIds: new Set(),
        });
    }
    return documentReviewStates.get(docId);
}

/**
 * Initialize the hunk review panel
 */
export function initHunkReviewPanel() {
    // Listen for hunks ready event (from reconcile.js)
    window.addEventListener('reconciliation-hunks-ready', (e) => {
        const { hunks } = e.detail;
        if (hunks && hunks.length > 0) {
            startHunkReview(hunks);
        }
    });

    // Handle document changes to restore UI state
    onDocumentChange((event, doc) => {
        if (event === "activeChange" && doc) {
            // Restore UI for the new document
            renderHunks();
        } else if (event === "close" && doc) {
            // Clean up
            documentReviewStates.delete(doc.id);
        }
    });

    // Wire up accept/reject all buttons
    const acceptAllBtn = document.getElementById('track-accept-all-btn');
    const rejectAllBtn = document.getElementById('track-reject-all-btn');

    if (acceptAllBtn) {
        acceptAllBtn.addEventListener('click', acceptAllHunks);
    }
    if (rejectAllBtn) {
        rejectAllBtn.addEventListener('click', rejectAllHunks);
    }
}

/**
 * Start the hunk review process
 */
async function startHunkReview(hunks) {
    const state = getCurrentState();
    if (!state) return;

    // Clone hunks to allow mutation of positions
    state.hunks = hunks.map((h, i) => ({
        ...h,
        internal_id: h.hunk_id || `hunk-${i}-${Date.now()}`,
        status: 'pending' // pending, accepted, rejected, conflict
    }));

    state.acceptedHunkIds = new Set();
    state.rejectedHunkIds = new Set();
    state.conflictHunkIds = new Set();
    state.active = true;

    // Filter self-authored hunks (reversions)
    try {
        const profile = await getProfile();
        const profileName = profile?.name;
        if (profileName) {
            state.hunks.forEach(h => {
                if (h.author_name === profileName) {
                    h.status = 'rejected';
                    state.rejectedHunkIds.add(h.internal_id);
                }
            });
        }
    } catch (e) {
        console.warn("Could not get profile:", e);
    }

    console.log(`Starting hunk review with ${hunks.length} hunks`);

    // Switch to track changes tab and show sidebar
    showRightSidebar('track-changes');

    // Align hunks to current editor content
    const currentMarkdown = getMarkdown();
    if (currentMarkdown) {
        alignHunksToContent(state.hunks, currentMarkdown);
    }

    // Render the hunks
    renderHunks();
}

/**
 * Align hunks to the actual text content in the editor.
 */
function alignHunksToContent(hunks, content) {
    // ... (Alignment logic remains same, operating on passed hunks array) ...
    hunks.forEach((h, i) => {
        const expectedStart = h.base_start;
        let searchText = h.base_text;

        if (h.type !== 'add' && searchText && searchText.length > 0) {
            const tolerance = 200;
            const searchZoneStart = Math.max(0, expectedStart - tolerance);
            const idx = content.indexOf(searchText, searchZoneStart);

            if (idx !== -1) {
                const diff = idx - expectedStart;
                if (Math.abs(diff) < tolerance * 2) {
                    h.base_start = idx;
                    h.base_end = idx + searchText.length;
                }
            }
        }
    });
}

/**
 * Render hunks
 */
function renderHunks() {
    const state = getCurrentState();
    const listEl = document.getElementById('track-changes-list');
    const statsEl = document.getElementById('track-changes-stats');
    const acceptAllBtn = document.getElementById('track-accept-all-btn');
    const rejectAllBtn = document.getElementById('track-reject-all-btn');

    if (!listEl) return;

    // If no state or not active (e.g. fresh document), show empty state or hide
    if (!state || !state.active) {
        listEl.innerHTML = '';
        if (statsEl) statsEl.textContent = 'No active review';
        if (acceptAllBtn) acceptAllBtn.disabled = true;
        if (rejectAllBtn) rejectAllBtn.disabled = true;
        return;
    }

    // Filter: Show Pending and Conflict. Hide Accepted/Rejected.
    const visibleHunks = state.hunks.filter(h =>
        h.status === 'pending' || h.status === 'conflict'
    );

    const count = visibleHunks.filter(h => h.status === 'pending').length;

    // Update stats
    if (statsEl) {
        statsEl.textContent = count === 0 ? 'No changes to review' : `${count} changes pending`;
    }

    // Enable buttons if there are actionable items
    if (acceptAllBtn) acceptAllBtn.disabled = count === 0;
    if (rejectAllBtn) rejectAllBtn.disabled = count === 0;

    // Empty state (done)
    if (visibleHunks.length === 0) {
        listEl.innerHTML = `
            <div class="track-changes-complete">
                <span class="check-icon">✅</span>
                <p>All changes handled!</p>
            </div>
        `;
        return;
    }

    // Render hunks
    listEl.innerHTML = visibleHunks.map((hunk, displayIndex) => {
        // Find actual index in state for handlers
        const originalIndex = state.hunks.findIndex(h => h.internal_id === hunk.internal_id);

        const typeLabel = hunk.type === 'add' ? '➕ Add'
            : hunk.type === 'delete' ? '➖ Del'
                : '✏️ Mod';

        const lineInfo = `Line ~${hunk.display_start_line || '?'}`;

        // Build diff display for WORDS
        let diffHtml = '';
        if (hunk.parts && hunk.parts.length > 0) {
            diffHtml = hunk.parts.map(part => {
                const text = escapeHtml(part.text);
                if (part.part_type === 'delete') {
                    return `<span class="diff-word delete" style="background:#ffcccc; text-decoration:line-through; color:#cc0000;">${text}</span>`;
                } else if (part.part_type === 'add') {
                    return `<span class="diff-word add" style="background:#ccffcc; color:#006600;">${text}</span>`;
                } else {
                    return `<span class="diff-word equal" style="color:#666;">${text}</span>`;
                }
            }).join('');
        } else {
            if (hunk.base_text && hunk.base_text.length > 0) {
                diffHtml += `<span class="diff-word delete" style="background:#ffcccc; text-decoration:line-through; color:#cc0000; margin-right:4px;">${escapeHtml(hunk.base_text)}</span>`;
            }
            if (hunk.modified_text && hunk.modified_text.length > 0) {
                diffHtml += `<span class="diff-word add" style="background:#ccffcc; color:#006600;">${escapeHtml(hunk.modified_text)}</span>`;
            }
        }

        const isConflict = hunk.status === 'conflict';
        const cardClass = isConflict ? 'track-change-card conflict' : 'track-change-card';
        const conflictMsg = isConflict ? '<div class="conflict-banner">⚠️ Overlap with accepted change</div>' : '';

        return `
            <div class="${cardClass}" style="${isConflict ? 'opacity: 0.6; pointer-events:none;' : ''}" onmouseenter="window.hunkReview_enter(${originalIndex})" onmouseleave="window.hunkReview_leave()">
                ${conflictMsg}
                <div class="track-change-header" style="border-left: 3px solid ${hunk.author_color}">
                    <span class="track-change-author" style="background-color: ${hunk.author_color}">${hunk.author_name}</span>
                    <span class="track-change-type">${typeLabel}</span>
                    <span class="track-change-lines">${lineInfo}</span>
                </div>
                <div class="track-change-diff" style="white-space: pre-wrap; font-family: monospace;">
                    ${diffHtml}
                </div>
                <div class="track-change-actions">
                    <button class="track-change-btn accept" onclick="window.hunkReview_accept(${originalIndex})" ${isConflict ? 'disabled' : ''}>✓ Accept</button>
                    <button class="track-change-btn reject" onclick="window.hunkReview_reject(${originalIndex})" ${isConflict ? 'disabled' : ''}>✗ Reject</button>
                </div>
            </div>
        `;
    }).join('');
}

// Global handlers
window.hunkReview_accept = acceptHunk;
window.hunkReview_reject = rejectHunk;

// Hover handlers
window.hunkReview_enter = (index) => {
    const state = getCurrentState();
    if (!state) return;

    const hunk = state.hunks[index];
    if (hunk && hunk.status === 'pending') {
        const content = getMarkdown();
        previewHunkWithDiff(
            hunk.type,
            hunk.base_start,
            hunk.base_end,
            hunk.modified_text || '',
            content,
            hunk.base_text || ''
        );
    }
};

window.hunkReview_leave = () => {
    clearEditorHighlight();
};

/**
 * Accept a hunk
 */
function acceptHunk(index) {
    const state = getCurrentState();
    if (!state) return;

    const hunk = state.hunks[index];
    if (!hunk || hunk.status !== 'pending') return;

    // Apply to editor
    const applied = applyHunkToEditor(hunk); // Note: applyHunkToEditor uses getMarkdown() so operates on active doc
    if (!applied) return;

    hunk.status = 'accepted';
    state.acceptedHunkIds.add(hunk.internal_id);

    adjustHunkPositions(hunk, state);
    renderHunks();
}

/**
 * Reject a hunk
 */
function rejectHunk(index) {
    const state = getCurrentState();
    if (!state) return;

    const hunk = state.hunks[index];
    if (!hunk) return;

    hunk.status = 'rejected';
    state.rejectedHunkIds.add(hunk.internal_id);
    renderHunks();
}

/**
 * Apply hunk to editor (Character Offset Version)
 */
function applyHunkToEditor(hunk) {
    const content = getMarkdown();

    const start = hunk.base_start;
    const end = hunk.base_end;

    if (start > content.length) {
        if (start <= content.length + 5) { // Tolerance
            hunk.base_start = content.length;
            if (end > content.length) hunk.base_end = content.length;
        } else {
            console.error(`[Error] Hunk start ${start} > EOF ${content.length}`);
            return false;
        }
    }

    const before = content.slice(0, hunk.base_start);
    const after = content.slice(hunk.base_end);
    const newContent = before + hunk.modified_text + after;

    setMarkdownContent(newContent);
    return true;
}

/**
 * Update positions of remaining hunks
 */
function adjustHunkPositions(appliedHunk, state) {
    const originalLength = appliedHunk.base_end - appliedHunk.base_start;
    const newLength = appliedHunk.modified_text.length;
    const shift = newLength - originalLength;

    const appliedStart = appliedHunk.base_start;
    const appliedEnd = appliedHunk.base_end;

    for (let i = 0; i < state.hunks.length; i++) {
        const h = state.hunks[i];

        if (h.internal_id === appliedHunk.internal_id) continue;
        if (h.status === 'accepted' || h.status === 'rejected') continue;

        const hStart = h.base_start;
        const hEnd = h.base_end;

        if (hEnd <= appliedStart) continue;

        if (hStart >= appliedEnd) {
            h.base_start += shift;
            h.base_end += shift;
            continue;
        }

        console.warn(`[Conflict] Hunk ${h.internal_id} overlaps textually. Marking as conflict.`);
        h.status = 'conflict';
        state.conflictHunkIds.add(h.internal_id);
    }
}

/**
 * Accept All
 */
function acceptAllHunks() {
    const state = getCurrentState();
    if (!state) return;

    const pending = state.hunks
        .filter(h => h.status === 'pending')
        .map((h, index) => ({ h, index }))
        .sort((a, b) => a.h.base_start - b.h.base_start);

    let acceptedCount = 0;

    for (const item of pending) {
        const liveHunk = state.hunks.find(h => h.internal_id === item.h.internal_id);
        if (liveHunk && liveHunk.status === 'pending') {
            const currentIndex = state.hunks.indexOf(liveHunk);
            acceptHunk(currentIndex);
            acceptedCount++;
        }
    }

    if (acceptedCount > 0) {
        showToast(`Accepted ${acceptedCount} changes`);
    } else {
        showToast("No valid changes to accept");
    }
}

/**
 * Reject All
 */
function rejectAllHunks() {
    const state = getCurrentState();
    if (!state) return;

    state.hunks.forEach(h => {
        if (h.status === 'pending') {
            h.status = 'rejected';
            state.rejectedHunkIds.add(h.internal_id);
        }
    });
    renderHunks();
}

function showToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:20px;right:20px;background:#333;color:#fff;padding:8px 16px;border-radius:4px;z-index:9999`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

export function isHunkReviewActive() {
    const state = getCurrentState();
    return state ? state.active : false;
}

/**
 * Reset the hunk review state (e.g. when resetting to original)
 */
export function resetHunkReview() {
    const state = getCurrentState();
    if (!state) return;

    state.hunks = [];
    state.acceptedHunkIds.clear();
    state.rejectedHunkIds.clear();
    state.conflictHunkIds.clear();
    state.active = false;

    clearReconciliationHunks();
    renderHunks();

    console.log("Hunk review state reset");
}
