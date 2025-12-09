// src/review-mode.js
// Multi-author review mode with inline accept/reject controls

import { invoke } from "@tauri-apps/api/core";
import { getActiveDocumentId } from "./document-manager.js";
import { calculateCharDiff } from "./diff-highlighter.js";
import { getCachedProfile, getCurrentUserInfo } from "./profile-service.js";
import { hexToRgba, escapeHtml } from "./utils.js";

let reviewState = {
    active: false,
    patches: [],           // All patches being reviewed
    authors: [],           // List of unique authors
    currentAuthor: null,   // Currently reviewing this author
    currentAuthorPatches: [], // Patches from current author
    baseContent: '',       // Original document content
    patchReviews: new Map(), // Map of patch UUID to reviews
};

/**
 * Helper function to get patches needing review by current user
 */
async function getPatchesNeedingReview(patches, currentUserId) {
    const docId = getActiveDocumentId();
    if (!docId) return [];
    
    const needsReview = [];
    
    for (const patch of patches) {
        // Skip patches by current user (implicitly accepted)
        if (patch.author === currentUserId) {
            continue;
        }
        
        // Check if current user has already reviewed this patch
        if (patch.uuid) {
            const reviews = await invoke("get_document_patch_reviews", {
                docId,
                patchUuid: patch.uuid
            }).catch(() => []);
            
            const hasReviewed = reviews.some(r => r.reviewer_id === currentUserId);
            if (!hasReviewed) {
                needsReview.push(patch);
            }
        }
    }
    
    return needsReview;
}

/**
 * Enter review mode with imported patches
 * @param {Array} patches - Patches to review
 */
export async function enterReviewMode(patches) {
    if (!patches || patches.length === 0) {
        console.warn("No patches to review");
        return;
    }

    // Get the base content (earliest patch's snapshot or empty)
    const savePatchesOnly = patches.filter(p => p.kind === "Save" && p.data?.snapshot);
    if (savePatchesOnly.length === 0) {
        console.warn("No save patches with snapshots found");
        return;
    }

    // Sort patches chronologically
    savePatchesOnly.sort((a, b) => a.timestamp - b.timestamp);

    // Get current user info
    const { id: currentUserId } = getCurrentUserInfo();

    // Clear and populate the patchReviews map with existing reviews
    const docId = getActiveDocumentId();
    const patchReviews = new Map();

    if (docId) {
        for (const patch of savePatchesOnly) {
            if (patch.uuid) {
                const reviews = await invoke("get_document_patch_reviews", {
                    docId,
                    patchUuid: patch.uuid
                }).catch(() => []);
                patchReviews.set(patch.uuid, reviews);
            }
        }
    }

    // Get patches that need review (author != current user and no review from current user)
    const patchesNeedingReview = savePatchesOnly.filter(patch => {
        // Skip patches by current user (implicitly accepted)
        if (patch.author === currentUserId) return false;

        // Check if current user has already reviewed this patch
        if (patch.uuid) {
            const reviews = patchReviews.get(patch.uuid) || [];
            const hasReviewed = reviews.some(r => r.reviewer_id === currentUserId);
            if (hasReviewed) return false;
        }

        return true;
    });

    // Get unique authors from patches needing review
    const authors = [...new Set(patchesNeedingReview.map(p => p.author))];

    if (authors.length === 0) {
        alert("No patches to review - all patches are from you or you've already reviewed them");
        return;
    }

    reviewState.active = true;
    reviewState.patches = savePatchesOnly;
    reviewState.authors = authors;
    reviewState.baseContent = savePatchesOnly[0].data.snapshot || '';
    reviewState.currentAuthor = null;
    reviewState.patchReviews = patchReviews;

    showAuthorSelectionBanner();
}

/**
 * Exit review mode
 */
export function exitReviewMode() {
    reviewState = {
        active: false,
        patches: [],
        authors: [],
        currentAuthor: null,
        currentAuthorPatches: [],
        baseContent: '',
        patchReviews: new Map(),
    };

    hideReviewBanner();
    clearOverlay();
}

/**
 * Check if review mode is active
 */
export function isReviewModeActive() {
    return reviewState.active;
}

/**
 * Toggle author filter
 */
export function toggleAuthorFilter(authorName) {
    const index = reviewState.authorFilter.indexOf(authorName);
    if (index > -1) {
        reviewState.authorFilter.splice(index, 1);
    } else {
        reviewState.authorFilter.push(authorName);
    }

    renderMultiAuthorOverlay();
}

/**
 * Accept a patch
 */
export async function acceptPatch(patchId) {
    const docId = getActiveDocumentId();
    if (!docId) return;

    const patch = reviewState.patches.find(p => p.id === patchId);
    if (!patch || !patch.uuid) {
        console.error("Patch UUID not found");
        return;
    }

    const { id: currentUserId, name: currentUserName } = getCurrentUserInfo();

    try {
        await invoke("record_document_patch_review", {
            docId,
            patchUuid: patch.uuid,
            reviewerId: currentUserId,
            decision: "accepted",
            reviewerName: currentUserName
        });

        // Update local state
        if (!reviewState.patchReviews.has(patch.uuid)) {
            reviewState.patchReviews.set(patch.uuid, []);
        }
        reviewState.patchReviews.get(patch.uuid).push({
            reviewer_id: currentUserId,
            decision: "accepted",
            reviewer_name: currentUserName,
            reviewed_at: Date.now()
        });

        renderMultiAuthorOverlay();
        updateReviewProgress();
    } catch (err) {
        console.error("Failed to accept patch:", err);
    }
}

/**
 * Reject a patch
 */
export async function rejectPatch(patchId) {
    const docId = getActiveDocumentId();
    if (!docId) return;

    const patch = reviewState.patches.find(p => p.id === patchId);
    if (!patch || !patch.uuid) {
        console.error("Patch UUID not found");
        return;
    }

    const { id: currentUserId, name: currentUserName } = getCurrentUserInfo();

    try {
        await invoke("record_document_patch_review", {
            docId,
            patchUuid: patch.uuid,
            reviewerId: currentUserId,
            decision: "rejected",
            reviewerName: currentUserName
        });

        // Update local state
        if (!reviewState.patchReviews.has(patch.uuid)) {
            reviewState.patchReviews.set(patch.uuid, []);
        }
        reviewState.patchReviews.get(patch.uuid).push({
            reviewer_id: currentUserId,
            decision: "rejected",
            reviewer_name: currentUserName,
            reviewed_at: Date.now()
        });

        renderMultiAuthorOverlay();
        updateReviewProgress();
    } catch (err) {
        console.error("Failed to reject patch:", err);
    }
}

/**
 * Select an author to review
 */
export function selectAuthorToReview(authorName) {
    const authorPatches = reviewState.patches.filter(p => p.author === authorName);

    reviewState.currentAuthor = authorName;
    reviewState.currentAuthorPatches = authorPatches;

    showReviewBanner();
    renderSingleAuthorOverlay();
}

/**
 * Show author selection banner
 */
function showAuthorSelectionBanner() {
    let banner = document.getElementById('review-mode-banner');

    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'review-mode-banner';
        banner.className = 'review-banner';

        const editorContainer = document.getElementById('editor');
        if (editorContainer) {
            editorContainer.parentElement.insertBefore(banner, editorContainer);
        }
    }

    const { id: currentUserId } = getCurrentUserInfo();

    banner.innerHTML = `
        <div class="review-info">
            <span class="review-label">🔍 Review Mode - Select Author</span>
        </div>
        <div class="author-selection-list">
            ${reviewState.authors.map(author => {
        const patches = reviewState.patches.filter(p => p.author === author);
        const patch = patches[0];
        const color = patch?.data?.authorColor || '#3498db';

        // Count patches needing review (those without current user's review)
        const pending = patches.filter(p => {
            if (!p.uuid) return true;
            const reviews = reviewState.patchReviews.get(p.uuid) || [];
            return !reviews.some(r => r.reviewer_id === currentUserId);
        }).length;

        return `
                    <button class="author-select-btn" data-author="${author}" 
                            style="border-left: 4px solid ${color};">
                        <span class="author-name">${author}</span>
                        <span class="author-patches">${pending} pending patches</span>
                    </button>
                `;
    }).join('')}
        </div>
        <div class="review-controls">
            <button id="exit-review-btn" class="review-btn">Exit Review</button>
        </div>
    `;

    // Wire up event listeners
    banner.querySelectorAll('.author-select-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            selectAuthorToReview(btn.dataset.author);
        });
    });

    banner.querySelector('#exit-review-btn')?.addEventListener('click', exitReviewMode);

    banner.style.display = 'flex';
}

/**
 * Show the review banner for current author
 */
function showReviewBanner() {
    if (!reviewState.currentAuthor) {
        showAuthorSelectionBanner();
        return;
    }

    let banner = document.getElementById('review-mode-banner');

    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'review-mode-banner';
        banner.className = 'review-banner';

        const editorContainer = document.getElementById('editor');
        if (editorContainer) {
            editorContainer.parentElement.insertBefore(banner, editorContainer);
        }
    }

    const authorPatch = reviewState.currentAuthorPatches[0];
    const authorColor = authorPatch?.data?.authorColor || '#3498db';

    banner.innerHTML = `
        <div class="review-info">
            <span class="review-label">🔍 Reviewing:</span>
            <span class="author-badge" style="background-color:${authorColor};">${reviewState.currentAuthor}</span>
            <span id="review-progress"></span>
        </div>
        <div class="review-controls">
            <button id="accept-all-author-btn" class="review-btn accept-btn">✓ Accept All from ${reviewState.currentAuthor}</button>
            <button id="reject-all-author-btn" class="review-btn reject-btn">✗ Reject All from ${reviewState.currentAuthor}</button>
            <button id="back-to-authors-btn" class="review-btn">← Back to Authors</button>
            <button id="exit-review-btn" class="review-btn">Exit Review</button>
        </div>
    `;

    // Wire up event listeners
    banner.querySelector('#accept-all-author-btn')?.addEventListener('click', () => acceptAllFromAuthor());
    banner.querySelector('#reject-all-author-btn')?.addEventListener('click', () => rejectAllFromAuthor());
    banner.querySelector('#back-to-authors-btn')?.addEventListener('click', () => {
        reviewState.currentAuthor = null;
        reviewState.currentAuthorPatches = [];
        clearOverlay();
        showAuthorSelectionBanner();
    });
    banner.querySelector('#exit-review-btn')?.addEventListener('click', exitReviewMode);

    updateReviewProgress();
    banner.style.display = 'flex';
}

/**
 * Update review progress display
 */
async function updateReviewProgress() {
    const progressEl = document.getElementById('review-progress');
    if (!progressEl) return;

    const { id: currentUserId } = getCurrentUserInfo();

    let pending = 0;
    let accepted = 0;
    let rejected = 0;

    for (const patch of reviewState.patches) {
        // Skip patches by current user
        if (patch.author === currentUserId) {
            continue;
        }

        if (!patch.uuid) {
            pending++;
            continue;
        }

        // Check if reviewed
        const reviews = reviewState.patchReviews.get(patch.uuid) || [];
        const myReview = reviews.find(r => r.reviewer_id === currentUserId);
        
        if (!myReview) {
            pending++;
        } else if (myReview.decision === 'accepted') {
            accepted++;
        } else if (myReview.decision === 'rejected') {
            rejected++;
        }
    }

    progressEl.textContent = `${pending} pending, ${accepted} accepted, ${rejected} rejected`;
}

/**
 * Hide review banner
 */
function hideReviewBanner() {
    const banner = document.getElementById('review-mode-banner');
    if (banner) {
        banner.style.display = 'none';
    }
}

/**
 * Render single author overlay showing their changes
 */
function renderSingleAuthorOverlay() {
    if (!reviewState.currentAuthor) return;

    let overlay = document.getElementById('review-overlay');

    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'review-overlay';
        overlay.className = 'review-overlay';

        const editorContainer = document.getElementById('editor');
        if (editorContainer) {
            editorContainer.style.position = 'relative'; // Ensure editor is positioned
            editorContainer.appendChild(overlay);
        }
    }

    // Get current user info once
    const { id: currentUserId } = getCurrentUserInfo();

    // Get all accepted patches chronologically as base
    const acceptedPatches = reviewState.patches
        .filter(p => {
             // Implicitly accepted if authored by current user
             if (p.author === currentUserId) return true;

             if (!p.uuid) return false;

             const reviews = reviewState.patchReviews.get(p.uuid) || [];
             const myReview = reviews.find(r => r.reviewer_id === currentUserId);
             return myReview && myReview.decision === 'accepted';
        })
        .sort((a, b) => a.timestamp - b.timestamp);

    const baseContent = acceptedPatches.length > 0
        ? acceptedPatches[acceptedPatches.length - 1].data?.snapshot || ''
        : reviewState.baseContent;

    // Get the current author's latest snapshot
    const currentAuthorLatest = [...reviewState.currentAuthorPatches]
        .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (!currentAuthorLatest) {
        overlay.innerHTML = '<p style="padding:20px;">No patches found for this author</p>';
        overlay.style.display = 'block';
        return;
    }

    const newContent = currentAuthorLatest.data?.snapshot || '';
    const authorColor = currentAuthorLatest.data?.authorColor || '#3498db';

    // Determine status from review map
    let reviewStatus = 'pending';
    if (currentAuthorLatest.uuid) {
        const reviews = reviewState.patchReviews.get(currentAuthorLatest.uuid) || [];
        const myReview = reviews.find(r => r.reviewer_id === currentUserId);
        if (myReview) {
            reviewStatus = myReview.decision;
        }
    }

    // Calculate diff
    const diffOps = calculateCharDiff(baseContent, newContent);

    let html = '';
    for (const op of diffOps) {
        if (op.type === 'add') {
            const opacity = reviewStatus === 'accepted' ? '0.2' : '0.4';
            html += `<span class="review-addition" 
                style="background-color:${hexToRgba(authorColor, opacity)};" 
                data-patch-id="${currentAuthorLatest.id}"
                data-author="${reviewState.currentAuthor}"
                data-status="${reviewStatus}"
                >${escapeHtml(op.text)}</span>`;
        } else if (op.type === 'delete') {
            html += `<span class="review-deletion">${escapeHtml(op.text)}</span>`;
        } else {
            html += escapeHtml(op.text);
        }
    }

    overlay.innerHTML = `<pre class="review-content">${html}</pre>`;
    overlay.style.display = 'block';

    // Add hover listeners
    setupHoverPopups(overlay);
}

/**
 * Accept all patches from current author
 */
async function acceptAllFromAuthor() {
    if (!reviewState.currentAuthor) return;

    const docId = getActiveDocumentId();
    if (!docId) return;

    const { id: currentUserId, name: currentUserName } = getCurrentUserInfo();

    try {
        for (const patch of reviewState.currentAuthorPatches) {
            if (!patch.uuid) continue;

            await invoke("record_document_patch_review", {
                docId,
                patchUuid: patch.uuid,
                reviewerId: currentUserId,
                decision: "accepted",
                reviewerName: currentUserName
            });

            // Update local state
            if (!reviewState.patchReviews.has(patch.uuid)) {
                reviewState.patchReviews.set(patch.uuid, []);
            }
            reviewState.patchReviews.get(patch.uuid).push({
                reviewer_id: currentUserId,
                decision: "accepted",
                reviewer_name: currentUserName,
                reviewed_at: Date.now()
            });
        }

        alert(`All patches from ${reviewState.currentAuthor} have been accepted`);

        // Go back to author selection
        reviewState.currentAuthor = null;
        reviewState.currentAuthorPatches = [];
        clearOverlay();
        showAuthorSelectionBanner();

    } catch (err) {
        console.error("Failed to accept all:", err);
        alert(`Error: ${err}`);
    }
}

/**
 * Reject all patches from current author
 */
async function rejectAllFromAuthor() {
    if (!reviewState.currentAuthor) return;

    const docId = getActiveDocumentId();
    if (!docId) return;

    if (!confirm(`Are you sure you want to reject all ${reviewState.currentAuthorPatches.length} patches from ${reviewState.currentAuthor}?`)) {
        return;
    }

    const { id: currentUserId, name: currentUserName } = getCurrentUserInfo();

    try {
        for (const patch of reviewState.currentAuthorPatches) {
            if (!patch.uuid) continue;

            await invoke("record_document_patch_review", {
                docId,
                patchUuid: patch.uuid,
                reviewerId: currentUserId,
                decision: "rejected",
                reviewerName: currentUserName
            });

            // Update local state
            if (!reviewState.patchReviews.has(patch.uuid)) {
                reviewState.patchReviews.set(patch.uuid, []);
            }
            reviewState.patchReviews.get(patch.uuid).push({
                reviewer_id: currentUserId,
                decision: "rejected",
                reviewer_name: currentUserName,
                reviewed_at: Date.now()
            });
        }

        alert(`All patches from ${reviewState.currentAuthor} have been rejected`);

        // Go back to author selection
        reviewState.currentAuthor = null;
        reviewState.currentAuthorPatches = [];
        clearOverlay();
        showAuthorSelectionBanner();

    } catch (err) {
        console.error("Failed to reject all:", err);
        alert(`Error: ${err}`);
    }
}

/**
 * Setup hover popups for accept/reject
 */
function setupHoverPopups(overlay) {
    const additions = overlay.querySelectorAll('.review-addition');

    additions.forEach(span => {
        span.addEventListener('mouseenter', (e) => {
            const patchId = parseInt(span.dataset.patchId);
            const author = span.dataset.author;
            const status = span.dataset.status;

            // Don't show popup for already accepted patches
            if (status === 'accepted') return;

            showAcceptRejectPopup(patchId, author, e.target);
        });
    });
}

/**
 * Show accept/reject popup
 */
function showAcceptRejectPopup(patchId, author, targetElement) {
    // Remove existing popup
    const existingPopup = document.getElementById('review-popup');
    if (existingPopup) {
        existingPopup.remove();
    }

    const popup = document.createElement('div');
    popup.id = 'review-popup';
    popup.className = 'review-popup';

    const patch = reviewState.patches.find(p => p.id === patchId);
    const authorColor = patch?.data?.authorColor || '#3498db';
    const timestamp = patch ? new Date(patch.timestamp).toLocaleString() : '';

    popup.innerHTML = `
        <div class="popup-author">
            <span class="author-badge" style="background-color:${authorColor};">${author}</span>
            <span class="popup-timestamp">${timestamp}</span>
        </div>
        <div class="popup-actions">
            <button class="popup-accept-btn" data-patch-id="${patchId}">✓ Accept</button>
            <button class="popup-reject-btn" data-patch-id="${patchId}">✗ Reject</button>
        </div>
    `;

    // Position popup near target
    document.body.appendChild(popup);
    const rect = targetElement.getBoundingClientRect();
    popup.style.top = `${rect.bottom + 5}px`;
    popup.style.left = `${rect.left}px`;

    // Event listeners
    popup.querySelector('.popup-accept-btn').addEventListener('click', async () => {
        await acceptPatch(patchId);
        popup.remove();
        // Refresh the current view
        renderSingleAuthorOverlay();
    });

    popup.querySelector('.popup-reject-btn').addEventListener('click', async () => {
        await rejectPatch(patchId);
        popup.remove();
        // Refresh the current view
        renderSingleAuthorOverlay();
    });

    // Remove popup when clicking elsewhere
    const removePopup = (e) => {
        if (!popup.contains(e.target) && e.target !== targetElement) {
            popup.remove();
            document.removeEventListener('click', removePopup);
        }
    };

    setTimeout(() => {
        document.addEventListener('click', removePopup);
    }, 100);
}

/**
 * Clear overlay
 */
function clearOverlay() {
    const overlay = document.getElementById('review-overlay');
    if (overlay) {
        overlay.style.display = 'none';
        overlay.innerHTML = '';
    }
}

// Utility functions hexToRgba and escapeHtml are imported from utils.js
