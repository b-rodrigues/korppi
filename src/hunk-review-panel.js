// src/hunk-review-panel.js
// Track Changes tab in right sidebar - reviews hunks with Word-Level Position Shifting
// Updates character offsets locally and detects overlaps.

import { getReconciliationHunks, clearReconciliationHunks } from './reconcile.js';
import { getMarkdown, setMarkdownContent, highlightEditorRange, clearEditorHighlight, scrollToEditorRange, highlightByText, previewGhostHunk } from './editor.js';
import { showRightSidebar } from './components/sidebar-controller.js';
import { getProfile } from './profile-service.js';

// State for the hunk review
let reviewState = {
    active: false,
    hunks: [],           // All hunks (mutable state for positions: base_start, base_end)
    acceptedHunkIds: new Set(),
    rejectedHunkIds: new Set(),
    conflictHunkIds: new Set(),
};

/**
 * Initialize the hunk review panel
 */
export function initHunkReviewPanel() {
    // Listen for hunks ready event
    window.addEventListener('reconciliation-hunks-ready', (e) => {
        const { hunks } = e.detail;
        if (hunks && hunks.length > 0) {
            startHunkReview(hunks);
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
    // Clone hunks to allow mutation of positions
    reviewState.hunks = hunks.map((h, i) => ({
        ...h,
        // Backend provides base_start, base_end (char offsets)
        // and base_text, modified_text
        internal_id: h.hunk_id || `hunk-${i}-${Date.now()}`,
        status: 'pending' // pending, accepted, rejected, conflict
    }));

    reviewState.acceptedHunkIds = new Set();
    reviewState.rejectedHunkIds = new Set();
    reviewState.conflictHunkIds = new Set();
    reviewState.active = true;

    // Filter self-authored hunks (reversions)
    try {
        const profile = await getProfile();
        const profileName = profile?.name;
        if (profileName) {
            reviewState.hunks.forEach(h => {
                if (h.author_name === profileName) {
                    h.status = 'rejected';
                    reviewState.rejectedHunkIds.add(h.internal_id);
                }
            });
        }
    } catch (e) {
        console.warn("Could not get profile:", e);
    }

    console.log(`Starting hunk review with ${hunks.length} hunks`);

    // Switch to track changes tab and show sidebar
    showRightSidebar('track-changes');

    // Align hunks to current editor content (fix drift from backend vs editor serialization)
    const currentMarkdown = getMarkdown();
    if (currentMarkdown) {
        alignHunksToContent(reviewState.hunks, currentMarkdown);
    }

    // Render the hunks
    renderHunks();
}

/**
 * Align hunks to the actual text content in the editor.
 * Backend offsets might differ slightly from Editor's serialized markdown
 * (e.g. bold markers, whitespace). This snaps them to the real text.
 */
function alignHunksToContent(hunks, content) {
    let offsetAdjustment = 0; // Cumulative drift

    // Sort hunks by start pos to handle sequentially? 
    // Actually backend usually sends sorted.

    // We can't trust the order if we have massive drifts, but let's assume
    // relative order is preserved.

    hunks.forEach((h, i) => {
        // 1. Expected position from backend
        const expectedStart = h.base_start;
        const textAndOffsets = [];

        // We look for the text around the expected position.
        // What text? 
        // If Delete/Mod: 'base_text' should exist.
        // If Add: We don't have base_text to find (it's empty).
        //    For Add, we need CONTEXT. 
        //    We can look for the text *before* the add?
        //    Or we rely on the gap between previous and next hunk?

        // Let's rely on 'base_text' if it exists (Delete/Mod)
        let searchText = h.base_text;

        // If it's an ADD, 'base_text' is empty. We can't search for empty string.
        // We have to rely on the fact that an ADD is usually between two known points.
        // Or we search for the surrounding context.
        // Ideally the backend provided context. It didn't. 

        // Simplification: 
        // If we can't find the text, we might just trust the offset + cumulative adjustment?

        if (h.type !== 'add' && searchText && searchText.length > 0) {
            // Search range: expectedStart +/- tolerance
            const tolerance = 200; // Look around
            const searchZoneStart = Math.max(0, expectedStart - tolerance);

            // We search for the first occurrence of searchText starting from searchZoneStart
            // Ideally closest to expectedStart.
            const idx = content.indexOf(searchText, searchZoneStart);

            if (idx !== -1) {
                // How far off are we?
                const diff = idx - expectedStart;

                // If the diff is huge, maybe we found the wrong instance?
                // Check distance
                if (Math.abs(diff) < tolerance * 2) {
                    // Update the hunk to real positions
                    h.base_start = idx;
                    h.base_end = idx + searchText.length;

                    // console.log(`[Align] Hunk ${i} aligned. Shift: ${diff}`);
                    // offsetAdjustment = diff; // Should we propagate? Maybe not. Local drift.
                }
            }
        } else {
            // For ADDs, we are flying blind without context.
            // Best guess: apply the average drift of nearby hunks?
            // Or just trust the backend offset (which is all we have).
            // If the user hovers, 'previewGhostHunk' uses fuzzy search on *context*.
            // Maybe we should accept that ADDs might be slightly off until we simply implement "Search by Context" completely.
            // But for Accept/Reject, we assume offsets are right.
        }
    });
}

/**
 * Render hunks
 */
function renderHunks() {
    const listEl = document.getElementById('track-changes-list');
    const statsEl = document.getElementById('track-changes-stats');
    const acceptAllBtn = document.getElementById('track-accept-all-btn');
    const rejectAllBtn = document.getElementById('track-reject-all-btn');

    if (!listEl) return;

    // Filter: Show Pending and Conflict. Hide Accepted/Rejected.
    const visibleHunks = reviewState.hunks.filter(h =>
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

    // Empty state
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
        const originalIndex = reviewState.hunks.findIndex(h => h.internal_id === hunk.internal_id);

        const typeLabel = hunk.type === 'add' ? '➕ Add'
            : hunk.type === 'delete' ? '➖ Del'
                : '✏️ Mod';

        // Display "Approx Line X" using display_start_line from backend
        // (Note: this line number is static from the original valid state, 
        // it doesn't update as we shift, but it gives a rough idea)
        // Ideally we would recalculate it, but counting newlines in JS for shifting offsets is expensive.
        const lineInfo = `Line ~${hunk.display_start_line || '?'}`;

        // Build diff display for WORDS
        let diffHtml = '';

        // Use structured parts if available (New logic)
        if (hunk.parts && hunk.parts.length > 0) {
            diffHtml = hunk.parts.map(part => {
                const text = escapeHtml(part.text);
                if (part.part_type === 'delete') {
                    return `<span class="diff-word delete" style="background:#ffcccc; text-decoration:line-through; color:#cc0000;">${text}</span>`;
                } else if (part.part_type === 'add') {
                    return `<span class="diff-word add" style="background:#ccffcc; color:#006600;">${text}</span>`;
                } else {
                    // Equal / Context (Gap)
                    return `<span class="diff-word equal" style="color:#666;">${text}</span>`;
                }
            }).join('');
        } else {
            // Fallback (Old logic)
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
    const hunk = reviewState.hunks[index];
    if (hunk && hunk.status === 'pending') {
        const content = getMarkdown();
        let relativePos = 0.5;
        if (content.length > 0) {
            relativePos = hunk.base_start / content.length;
        }

        console.log(`[PreviewDebug] Hover Hunk #${index}:`, {
            id: hunk.internal_id,
            start: hunk.base_start,
            end: hunk.base_end,
            relativePos: relativePos,
            contentLen: content.length,
            textSnippet: content.substring(hunk.base_start, hunk.base_start + 20) + "..."
        });

        // Logic to determine type and arguments for Ghost Preview
        // Note: 'hunk.type' roughly tells us, but checking text lengths is safer

        if (hunk.type === 'add') {
            // Insert: need modified_text and context (preceding text)
            // Context: grab 20 chars before base_start
            const contextStart = Math.max(0, hunk.base_start - 20);
            const contextText = content.substring(contextStart, hunk.base_start);
            previewGhostHunk(hunk.modified_text, 'insert', relativePos, contextText);

        } else if (hunk.type === 'delete') {
            // Delete: need base_text (the text currently in editor)
            // We can extract it from range to be sure, or use hunk.base_text
            const targetText = content.substring(hunk.base_start, hunk.base_end);
            previewGhostHunk(targetText, 'delete', relativePos);

        } else {
            // Mod/Replace: need modified_text (to insert) and base_text (to delete)
            const deleteText = content.substring(hunk.base_start, hunk.base_end);
            previewGhostHunk(hunk.modified_text, 'replace', relativePos, deleteText);
        }
    }
};

window.hunkReview_leave = () => {
    clearEditorHighlight();
};

/**
 * Accept a hunk
 */
function acceptHunk(index) {
    const hunk = reviewState.hunks[index];
    if (!hunk || hunk.status !== 'pending') return;

    // 1. Apply to editor
    const applied = applyHunkToEditor(hunk);
    if (!applied) {
        console.error("Failed to apply hunk");
        return;
    }

    // 2. Mark as accepted
    hunk.status = 'accepted';
    reviewState.acceptedHunkIds.add(hunk.internal_id);

    // 3. Adjust positions of subsequent hunks
    adjustHunkPositions(hunk);

    // 4. Render
    renderHunks();
}

/**
 * Reject a hunk
 */
function rejectHunk(index) {
    const hunk = reviewState.hunks[index];
    if (!hunk) return;

    hunk.status = 'rejected';
    reviewState.rejectedHunkIds.add(hunk.internal_id);
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
        // Safe clamping if slightly off?
        if (start <= content.length + 5) { // Tolerance of 5 chars
            // Clamp to EOF
            hunk.base_start = content.length;
            if (end > content.length) hunk.base_end = content.length;
        } else {
            console.error(`[Error] Hunk start ${start} > EOF ${content.length}`);
            return false;
        }
    }

    // Construct new content via slicing
    // Before hunk + New Text + After hunk
    const before = content.slice(0, hunk.base_start);
    const after = content.slice(hunk.base_end); // base_end is exclusive index in original

    const newContent = before + hunk.modified_text + after;

    setMarkdownContent(newContent);
    return true;
}

/**
 * Update positions of remaining hunks (Character Offset Version)
 */
function adjustHunkPositions(appliedHunk) {
    // Calculate shift: (length of new text) - (length of old text)
    // base_end is exclusive, so length = base_end - base_start
    const originalLength = appliedHunk.base_end - appliedHunk.base_start;
    const newLength = appliedHunk.modified_text.length;
    const shift = newLength - originalLength;

    const appliedStart = appliedHunk.base_start;
    const appliedEnd = appliedHunk.base_end;

    // Adjust all other hunks
    for (let i = 0; i < reviewState.hunks.length; i++) {
        const h = reviewState.hunks[i];

        if (h.internal_id === appliedHunk.internal_id) continue;
        if (h.status === 'accepted' || h.status === 'rejected') continue;

        const hStart = h.base_start;
        const hEnd = h.base_end;

        // 1. Strictly Before? Safe.
        // If hunk ends before applied start, valid.
        if (hEnd <= appliedStart) {
            continue;
        }

        // 2. Strictly After? Shift.
        // If hunk starts after applied end, valid but shifted.
        if (hStart >= appliedEnd) {
            h.base_start += shift;
            h.base_end += shift;
            continue;
        }

        // 3. Overlap. Conflict.
        // Either hStart < appliedEnd OR hEnd > appliedStart (while not being strictly before/after)
        // Actually, the logic above covers strict before/after.
        // Anything falling through here overlaps.
        console.warn(`[Conflict] Hunk ${h.internal_id} overlaps textually. Marking as conflict.`);
        h.status = 'conflict';
        reviewState.conflictHunkIds.add(h.internal_id);
    }
}

/**
 * Accept All
 */
function acceptAllHunks() {
    // Check pending count
    const pending = reviewState.hunks
        .filter(h => h.status === 'pending')
        .map((h, index) => ({ h, index }))
        .sort((a, b) => a.h.base_start - b.h.base_start); // Sort by char offset

    let acceptedCount = 0;

    for (const item of pending) {
        // Re-check status in live state (conflicts might appear dynamically)
        const liveHunk = reviewState.hunks.find(h => h.internal_id === item.h.internal_id);
        if (liveHunk && liveHunk.status === 'pending') {
            const currentIndex = reviewState.hunks.indexOf(liveHunk);
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
    reviewState.hunks.forEach(h => {
        if (h.status === 'pending') {
            h.status = 'rejected';
            reviewState.rejectedHunkIds.add(h.internal_id);
        }
    });
    renderHunks();
}

// Helpers
function showToast(msg) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:20px;right:20px;background:#333;color:#fff;padding:8px 16px;border-radius:4px;z-index:9999`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

function escapeHtml(text) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function isHunkReviewActive() {
    return reviewState.active;
}

export function clearHunkReview() {
    reviewState.active = false;
    reviewState.hunks = [];
    clearReconciliationHunks();
    renderHunks();
}
