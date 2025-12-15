// src/hunk-review-panel.js
// Track Changes tab in right sidebar - reviews hunks with Position Shifting
// Updates line numbers locally and detects overlaps.

import { getReconciliationHunks, clearReconciliationHunks } from './reconcile.js';
import { getMarkdown, setMarkdownContent } from './editor.js';
import { showRightSidebar } from './components/sidebar-controller.js';
import { getProfile } from './profile-service.js';

// State for the hunk review
let reviewState = {
    active: false,
    hunks: [],           // All hurks (mutable state for positions)
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
    // Clone hunks to allow mutation of line numbers
    // Ensure each hunk has a unique ID if not present
    // FIX: Rust/Backend seems to return base_end_line=0 for 'add' hunks.
    // This breaks overlap/shift logic checking hEnd <= appliedStart.
    // We normalize 'add' hunks to have end_line = start_line.
    reviewState.hunks = hunks.map((h, i) => ({
        ...h,
        base_end_line: (h.type === 'add' && h.base_end_line === 0) ? h.base_start_line : h.base_end_line,
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
            // Mark self-authored hunks as rejected (hidden) by default?
            // Or just exclude them from the list?
            // In the "Static" model, we can just mark them as 'rejected' initially so they don't show up.
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

    // Render the hunks
    renderHunks();
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

        // Display updated line numbers
        const lineInfo = hunk.type === 'add'
            ? `Line ${hunk.base_start_line + 1}`
            : `L${hunk.base_start_line + 1}-${hunk.base_end_line}`;

        // Build diff display
        let diffHtml = '';
        if (hunk.base_lines && hunk.base_lines.length > 0) {
            diffHtml += hunk.base_lines.map(line =>
                `<div class="track-change-line delete">- ${escapeHtml(line)}</div>`
            ).join('');
        }
        if (hunk.modified_lines && hunk.modified_lines.length > 0) {
            diffHtml += hunk.modified_lines.map(line =>
                `<div class="track-change-line add">+ ${escapeHtml(line)}</div>`
            ).join('');
        }

        const isConflict = hunk.status === 'conflict';
        const cardClass = isConflict ? 'track-change-card conflict' : 'track-change-card';
        const conflictMsg = isConflict ? '<div class="conflict-banner">⚠️ Overlap with accepted change</div>' : '';

        return `
            <div class="${cardClass}" style="${isConflict ? 'opacity: 0.6; pointer-events:none;' : ''}">
                ${conflictMsg}
                <div class="track-change-header" style="border-left: 3px solid ${hunk.author_color}">
                    <span class="track-change-author" style="background-color: ${hunk.author_color}">${hunk.author_name}</span>
                    <span class="track-change-type">${typeLabel}</span>
                    <span class="track-change-lines">${lineInfo}</span>
                </div>
                <div class="track-change-diff">
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

/**
 * Accept a hunk
 */
function acceptHunk(index) {
    const hunk = reviewState.hunks[index];
    if (!hunk || hunk.status !== 'pending') return;

    console.log(`Accepting hunk: ${hunk.type} at ${hunk.base_start_line}`);

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
 * Apply hunk to editor
 */
function applyHunkToEditor(hunk) {
    const content = getMarkdown();
    // Use split logic consistent with how we count lines
    const lines = content.split('\n');

    // console.log(`[Apply] Attempting to apply hunk ID ${hunk.internal_id}`);
    // console.log(`[Apply] Type: ${hunk.type}, Start: ${hunk.base_start_line}, Length: ${hunk.base_lines?.length}, ModLength: ${hunk.modified_lines?.length}`);
    // console.log(`[Apply] Document lines: ${lines.length}`);

    if (hunk.base_start_line > lines.length) {
        // Safe clamping for "Add" at EOF (handling trailing newline discrepancies)
        if (hunk.type === 'add' && hunk.base_start_line <= lines.length + 2) {
            console.warn(`[Apply] Hunk start ${hunk.base_start_line} slightly past EOF ${lines.length}. Clamping to EOF.`);
            hunk.base_start_line = lines.length;
        } else {
            console.error(`[Error] Hunk out of bounds: L${hunk.base_start_line} > ${lines.length}`);
            return false;
        }
    }

    // Note: hunk.base_start_line is 0-indexed
    if (hunk.type === 'add') {
        lines.splice(hunk.base_start_line, 0, ...hunk.modified_lines);
    } else if (hunk.type === 'delete') {
        const delCount = hunk.base_lines.length;
        // Verify we aren't deleting past end
        if (hunk.base_start_line + delCount > lines.length) {
            console.warn(`[Apply] Deletion extends past EOF. Clamping.`);
        }
        lines.splice(hunk.base_start_line, delCount);
    } else if (hunk.type === 'modify') {
        const modCount = hunk.base_lines.length;
        lines.splice(hunk.base_start_line, modCount, ...hunk.modified_lines);
    }

    const newContent = lines.join('\n');
    setMarkdownContent(newContent);

    // console.log(`[Apply] Success. New line count: ${newContent.split('\n').length}`);
    return true;
}

/**
 * Update positions of remaining hunks
 */
function adjustHunkPositions(appliedHunk) {
    // Calculate shift
    let shift = 0;
    if (appliedHunk.type === 'add') {
        shift = appliedHunk.modified_lines.length;
    } else if (appliedHunk.type === 'delete') {
        shift = -appliedHunk.base_lines.length;
    } else if (appliedHunk.type === 'modify') {
        shift = appliedHunk.modified_lines.length - appliedHunk.base_lines.length;
    }

    // console.log(`[Shift] Applied hunk caused shift: ${shift}`);

    const appliedStart = appliedHunk.base_start_line;
    // appliedEnd is exclusive for the *original* range
    const appliedEnd = appliedHunk.base_end_line;

    // Adjust all other hunks
    // console.log(`[Shift] Iterating ${reviewState.hunks.length} hunks to adjust positions...`);
    for (let i = 0; i < reviewState.hunks.length; i++) {
        const h = reviewState.hunks[i];

        // Debug status
        // console.log(`[Shift] Checking Hunk ${h.internal_id} (Status: ${h.status}, Start: ${h.base_start_line})`);

        if (h.internal_id === appliedHunk.internal_id) continue;
        if (h.status === 'accepted' || h.status === 'rejected') {
            // console.log(`[Shift] Skipping ${h.internal_id}: status ${h.status}`);
            continue;
        }

        // Check for overlap
        // Two ranges [A,B) and [C,D) overlap if A < D and C < B
        // Here, hunk ranges are [start, end) where end is exclusive (usually start+length)
        // Let's verify end logic.
        // Rust calculator: base_end_line is start + len. So it IS exclusive.

        // Strict overlap check on the ORIGINAL base coordinates?
        // NO! We need to check against the APPLIED hunk's range.
        // But wait. `appliedStart` and `appliedEnd` are based on the state *before* this applies?
        // Yes, `appliedHunk.base_start_line` is the line in the document *before* the splice.
        // And `h.base_start_line` is also currently referring to the document *before* the splice (for downstream hunks).
        // So comparing them directly works.

        const hStart = h.base_start_line;
        const hEnd = h.base_end_line;

        // If a hunk ends before the applied hunk starts, it's safe (and needs no shift).
        if (hEnd <= appliedStart) {
            // Hunk is strictly before. No shift needed.
            // console.log(`[Shift] ${h.internal_id} is before. No change.`);
            continue;
        }

        // If a hunk starts after the applied hunk ends, it needs shifting.
        // NOTE: We only shift hunks that are stricly AFTER.
        if (hStart >= appliedEnd) {
            const oldStart = h.base_start_line;
            h.base_start_line += shift;
            h.base_end_line += shift;
            // console.log(`[Shift] Hunk ${h.internal_id} shifted: ${oldStart} -> ${h.base_start_line}`);
            continue;
        }

        // Otherwise (hEnd > appliedStart AND hStart < appliedEnd), they overlap.
        // This hunk is now invalid because the context it relied on has changed.
        console.warn(`[Conflict] Hunk ${h.internal_id} overlaps with applied hunk. Marking as conflict.`);
        h.status = 'conflict';
        reviewState.conflictHunkIds.add(h.internal_id);
    }
}

/**
 * Accept All
 */
function acceptAllHunks() {
    // Sort pending hunks by position (descending) so we can apply bottom-up without shifting?
    // NO! The shift accumulation is tricky if there are overlaps.
    // Safer: Sort by position (Ascending), and iteratively call acceptHunk.
    // Since acceptHunk handles shifting and conflict detection, this is robust.

    // Get currently pending
    const pending = reviewState.hunks
        .filter(h => h.status === 'pending')
        .map((h, index) => ({ h, index })) // keep ref to original array index
        .sort((a, b) => a.h.base_start_line - b.h.base_start_line);

    let acceptedCount = 0;

    // We must look up the FRESH index each time because 'pending' list above is static snapshots
    // but the 'status' might change to 'conflict' during the loop if we accept the first one.

    for (const item of pending) {
        // Re-check status in live state
        const liveHunk = reviewState.hunks.find(h => h.internal_id === item.h.internal_id);
        if (liveHunk && liveHunk.status === 'pending') {
            // Find its current index in the main array
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
