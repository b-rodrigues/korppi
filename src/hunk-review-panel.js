// src/hunk-review-panel.js
// Track Changes tab in right sidebar - reviews hunks with Accept/Reject buttons

import { getReconciliationHunks, clearReconciliationHunks } from './reconcile.js';
import { getMarkdown, setMarkdownContent } from './editor.js';
import { showRightSidebar } from './components/sidebar-controller.js';

// State for the hunk review
let reviewState = {
    active: false,
    hunks: [],           // Copy of hunks with pending status
    baseContent: '',     // Original content before any changes
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
function startHunkReview(hunks) {
    // Save base content
    reviewState.baseContent = getMarkdown();

    // Copy hunks with pending status
    reviewState.hunks = hunks.map(h => ({
        ...h,
        status: 'pending' // pending | accepted | rejected
    }));
    reviewState.active = true;

    console.log(`Starting hunk review with ${hunks.length} hunks`);

    // Switch to track changes tab and show sidebar
    showRightSidebar('track-changes');

    // Render the hunks
    renderHunks();
}

/**
 * Render all hunks in the panel
 */
function renderHunks() {
    const listEl = document.getElementById('track-changes-list');
    const statsEl = document.getElementById('track-changes-stats');
    const acceptAllBtn = document.getElementById('track-accept-all-btn');
    const rejectAllBtn = document.getElementById('track-reject-all-btn');

    if (!listEl) return;

    const pendingCount = reviewState.hunks.filter(h => h.status === 'pending').length;
    const totalCount = reviewState.hunks.length;

    // Update stats
    if (statsEl) {
        if (totalCount === 0) {
            statsEl.textContent = 'No changes to review';
        } else {
            statsEl.textContent = `${pendingCount} of ${totalCount} changes pending`;
        }
    }

    // Enable/disable buttons
    if (acceptAllBtn) acceptAllBtn.disabled = pendingCount === 0;
    if (rejectAllBtn) rejectAllBtn.disabled = pendingCount === 0;

    // If no pending, show completion message
    if (pendingCount === 0 && totalCount > 0) {
        listEl.innerHTML = `
            <div class="track-changes-complete">
                <span class="check-icon">✅</span>
                <p>All changes reviewed!</p>
            </div>
        `;
        return;
    }

    // If no hunks at all, show empty state
    if (totalCount === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <p>Import document versions to review changes</p>
            </div>
        `;
        return;
    }

    // Render each pending hunk
    listEl.innerHTML = reviewState.hunks.map((hunk, index) => {
        if (hunk.status !== 'pending') {
            return ''; // Don't show non-pending hunks
        }

        const typeLabel = hunk.type === 'add' ? '➕ Add'
            : hunk.type === 'delete' ? '➖ Del'
                : '✏️ Mod';

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

        return `
            <div class="track-change-card" data-hunk-index="${index}">
                <div class="track-change-header" style="border-left: 3px solid ${hunk.author_color}">
                    <span class="track-change-author" style="background-color: ${hunk.author_color}">${hunk.author_name}</span>
                    <span class="track-change-type">${typeLabel}</span>
                    <span class="track-change-lines">${lineInfo}</span>
                </div>
                <div class="track-change-diff">
                    ${diffHtml}
                </div>
                <div class="track-change-actions">
                    <button class="track-change-btn accept" data-action="accept" data-index="${index}">✓ Accept</button>
                    <button class="track-change-btn reject" data-action="reject" data-index="${index}">✗ Reject</button>
                </div>
            </div>
        `;
    }).join('');

    // Wire up individual buttons
    listEl.querySelectorAll('.track-change-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const action = e.target.dataset.action;
            const index = parseInt(e.target.dataset.index);
            if (action === 'accept') {
                acceptHunk(index);
            } else {
                rejectHunk(index);
            }
        });
    });
}

/**
 * Accept a single hunk
 */
function acceptHunk(index) {
    const hunk = reviewState.hunks[index];
    if (!hunk || hunk.status !== 'pending') return;

    console.log(`Accepting hunk ${index}: ${hunk.type} by ${hunk.author_name}`);

    // Apply the change to the document
    applyHunk(hunk);

    hunk.status = 'accepted';
    renderHunks();
}

/**
 * Reject a single hunk
 */
function rejectHunk(index) {
    const hunk = reviewState.hunks[index];
    if (!hunk || hunk.status !== 'pending') return;

    console.log(`Rejecting hunk ${index}: ${hunk.type} by ${hunk.author_name}`);

    // Just mark as rejected, don't apply
    hunk.status = 'rejected';
    renderHunks();
}

/**
 * Apply a hunk's changes to the document
 */
function applyHunk(hunk) {
    const content = getMarkdown();
    const lines = content.split('\n');

    if (hunk.type === 'add') {
        // Insert the new lines at the position
        const insertAt = Math.min(hunk.base_start_line, lines.length);
        lines.splice(insertAt, 0, ...hunk.modified_lines);

    } else if (hunk.type === 'delete') {
        // Remove the lines
        const deleteStart = Math.min(hunk.base_start_line, lines.length);
        const deleteCount = hunk.base_lines.length;
        lines.splice(deleteStart, deleteCount);

    } else if (hunk.type === 'modify') {
        // Replace the lines
        const replaceStart = Math.min(hunk.base_start_line, lines.length);
        const replaceCount = hunk.base_lines.length;
        lines.splice(replaceStart, replaceCount, ...hunk.modified_lines);
    }

    const newContent = lines.join('\n');
    setMarkdownContent(newContent);

    // Update line positions for remaining hunks
    adjustHunkPositions(hunk);
}

/**
 * Adjust line positions for hunks after applying a change
 */
function adjustHunkPositions(appliedHunk) {
    // Calculate the shift in line numbers
    let shift = 0;

    if (appliedHunk.type === 'add') {
        shift = appliedHunk.modified_lines.length;
    } else if (appliedHunk.type === 'delete') {
        shift = -appliedHunk.base_lines.length;
    } else if (appliedHunk.type === 'modify') {
        shift = appliedHunk.modified_lines.length - appliedHunk.base_lines.length;
    }

    if (shift === 0) return;

    // Adjust all pending hunks that come after this one
    for (const hunk of reviewState.hunks) {
        if (hunk.status !== 'pending') continue;
        if (hunk.base_start_line > appliedHunk.base_start_line) {
            hunk.base_start_line += shift;
            hunk.base_end_line += shift;
        }
    }
}

/**
 * Accept all pending hunks
 */
function acceptAllHunks() {
    // Process from bottom to top to avoid position issues
    const pending = reviewState.hunks
        .map((h, i) => ({ hunk: h, index: i }))
        .filter(x => x.hunk.status === 'pending')
        .sort((a, b) => b.hunk.base_start_line - a.hunk.base_start_line);

    for (const { hunk } of pending) {
        applyHunk(hunk);
        hunk.status = 'accepted';
    }

    renderHunks();
}

/**
 * Reject all pending hunks
 */
function rejectAllHunks() {
    for (const hunk of reviewState.hunks) {
        if (hunk.status === 'pending') {
            hunk.status = 'rejected';
        }
    }
    renderHunks();
}

/**
 * Check if review is active
 */
export function isHunkReviewActive() {
    return reviewState.active;
}

/**
 * Clear the review state
 */
export function clearHunkReview() {
    reviewState.active = false;
    reviewState.hunks = [];
    reviewState.baseContent = '';
    clearReconciliationHunks();
    renderHunks();
}

/**
 * Escape HTML
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
