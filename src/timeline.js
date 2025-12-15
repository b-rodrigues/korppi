import { invoke } from "@tauri-apps/api/core";
import { forceSave, restoreDocumentState } from "./yjs-setup.js";
import { getActiveDocumentId, onDocumentChange } from "./document-manager.js";
import { enterPreview, exitPreview, isPreviewActive } from "./diff-preview.js";
import { calculateCharDiff } from "./diff-highlighter.js";
import { detectLineRange, formatLineRange } from "./line-range-detector.js";
import { detectPatchConflicts, isInConflict, formatConflictInfo, getConflictGroup } from "./conflict-detection.js";
import { getEditorContent, getMarkdown, setMarkdownContent } from "./editor.js";
import { getCachedProfile } from "./profile-service.js";

// Track the currently selected/restored patch
let restoredPatchId = null;

// Track conflict state
let conflictState = {
    conflictGroups: [],
    patchConflicts: new Map()
};

// Flag to control when conflict alert should be shown
// Only set to true on document open or after reconciliation
let showConflictAlertOnNextRefresh = false;

export async function fetchPatchList() {
    const docId = getActiveDocumentId();
    if (docId) {
        // Use document-specific patches
        return await invoke("list_document_patches", { id: docId }).catch(() => []);
    }
    // Fallback to global patches for legacy single-document mode
    return await invoke("list_patches").catch(() => []);
}

export async function fetchPatch(id) {
    const docId = getActiveDocumentId();
    if (docId) {
        // Use document-specific patches and filter by ID
        const patches = await invoke("list_document_patches", { id: docId }).catch(() => []);
        return patches.find(patch => patch.id === id) || null;
    }
    // Fallback to global patch for legacy single-document mode
    return await invoke("get_patch", { id }).catch(() => null);
}

/**
 * Check if a patch has snapshot content available for restoration
 */
export function hasSnapshotContent(patch) {
    if (!patch || !patch.data) return false;
    const snapshot = patch.data.snapshot;
    return typeof snapshot === 'string' && snapshot.length > 0;
}

/**
 * Restore the document to a specific patch version
 * @param {number} patchId - The ID of the patch to restore to
 */
export async function restoreToPatch(patchId) {
    const patch = await fetchPatch(patchId);
    if (!patch) {
        console.error("Failed to fetch patch for restore:", patchId);
        return false;
    }

    const ts = new Date(patch.timestamp).toLocaleString();
    const confirmMsg = `This will revert to version #${patchId} from ${ts}.\n\nYour current changes will be saved first.\n\nContinue?`;

    if (!confirm(confirmMsg)) {
        return false;
    }

    // Show restoring indicator
    setRestoreInProgress(true);

    try {
        // Save current state first (so users can undo the restore)
        await forceSave();

        // Try local first if patch data has snapshot and it's markdown
        if (patch && hasSnapshotContent(patch)) {
            const success = setMarkdownContent(patch.data.snapshot);
            if (success) {
                restoredPatchId = patchId;
                // Refresh the timeline to show the restored state
                await refreshTimeline();
                return true;
            }
        }

        // Try document-specific restore
        const docId = getActiveDocumentId();
        if (docId) {
            const result = await invoke("restore_document_to_patch", { id: docId, patchId });
            if (result && result.snapshot_content) {
                const success = setMarkdownContent(result.snapshot_content);
                if (success) {
                    restoredPatchId = patchId;
                    await refreshTimeline();
                    return true;
                }
            }
        }

        // Try global restore as fallback
        const result = await invoke("restore_to_patch", { patchId });
        if (result && result.snapshot_content) {
            const success = setMarkdownContent(result.snapshot_content);
            if (success) {
                restoredPatchId = patchId;
                await refreshTimeline();
                return true;
            }
        }

        alert("This version cannot be restored because no snapshot data is available. Try selecting a different version.");
        return false;
    } catch (err) {
        console.error("Failed to restore to patch:", err);
        alert("Failed to restore: " + (err.message || err));
        return false;
    } finally {
        setRestoreInProgress(false);
    }
}

// Debounce for refreshTimeline to prevent double renders
let refreshTimelineTimeout = null;
let refreshTimelinePromise = null;

/**
 * Refresh the timeline list (debounced to prevent duplicates)
 */
export async function refreshTimeline() {
    // If a refresh is already pending, just extend the timeout
    if (refreshTimelineTimeout) {
        clearTimeout(refreshTimelineTimeout);
    }

    // Return existing promise if a refresh is in progress
    if (refreshTimelinePromise) {
        return refreshTimelinePromise;
    }

    // Debounce by 50ms to coalesce rapid calls
    return new Promise((resolve) => {
        refreshTimelineTimeout = setTimeout(async () => {
            refreshTimelineTimeout = null;
            refreshTimelinePromise = (async () => {
                try {
                    const patches = await fetchPatchList();
                    renderPatchList(patches);
                } finally {
                    refreshTimelinePromise = null;
                }
            })();
            await refreshTimelinePromise;
            resolve();
        }, 50);
    });
}

/**
 * Set visual feedback for restore in progress
 */
function setRestoreInProgress(inProgress) {
    const container = document.getElementById("timeline-container");
    if (container) {
        if (inProgress) {
            container.classList.add("restoring");
        } else {
            container.classList.remove("restoring");
        }
    }
}

/**
 * Initialize timeline UI
 */
export function initTimeline() {
    // Timeline is now always visible in the right sidebar
    const sortSelect = document.getElementById("timeline-sort");

    const filterAuthor = document.getElementById("filter-author");
    const resetBtn = document.getElementById("reset-to-original-btn");


    // Wire up sort dropdown
    if (sortSelect) {
        sortSelect.addEventListener("change", () => {
            refreshTimeline();
        });
    }

    // Wire up filter dropdowns
    if (filterAuthor) {
        filterAuthor.addEventListener("change", () => {
            refreshTimeline();
        });
    }



    // Wire up reset button
    if (resetBtn) {
        resetBtn.addEventListener("click", async () => {
            await resetToOriginal();
        });
    }

    // Listen for patch status updates (don't show conflict alert on accept/reject)
    window.addEventListener('patch-status-updated', async () => {
        await refreshTimeline();
    });

    // Listen for reconciliation import event - ONLY show conflict alert during reconciliation
    window.addEventListener('reconciliation-imported', async () => {
        showConflictAlertOnNextRefresh = true;
        await refreshTimeline();
    });

    // Listen for document changes (open, switch, new) - refresh timeline but don't alert
    onDocumentChange(async (event, doc) => {
        if (event === "open" || event === "new" || event === "activeChange") {
            // Don't set showConflictAlertOnNextRefresh - we only alert during reconciliation
            await refreshTimeline();
        }
    });

    // Initial load - no conflict alert
    refreshTimeline();
}

export async function renderPatchList(patches) {
    const list = document.getElementById("timeline-list");
    list.innerHTML = "";

    // Detect conflicts in patches
    conflictState = detectPatchConflicts(patches);

    // Reset the flag (we no longer show alerts, conflicts are visible in timeline)

    // Get filter values
    const authorFilter = document.getElementById("filter-author")?.value || "all";
    const sortOrder = document.getElementById("timeline-sort")?.value || "time-desc";


    // Populate author dropdown with unique authors (use ID for value, name for display)
    const filterAuthorSelect = document.getElementById("filter-author");
    if (filterAuthorSelect && patches.length > 0) {
        // Build a map of author ID to display name
        const authorMap = new Map();
        patches.forEach(p => {
            if (!authorMap.has(p.author)) {
                const displayName = p.data?.authorName || p.author;
                authorMap.set(p.author, displayName);
            }
        });

        const currentValue = filterAuthorSelect.value;

        filterAuthorSelect.innerHTML = '<option value="all">All Authors</option>' +
            Array.from(authorMap.entries()).map(([authorId, displayName]) =>
                `<option value="${authorId}" ${currentValue === authorId ? 'selected' : ''}>${displayName}</option>`
            ).join('');
    }

    // Get current user's author ID for filtering
    const currentUserProfile = getCachedProfile();
    const currentUserId = currentUserProfile?.id || 'local';

    // Preload reviews for all patches in parallel
    const docId = getActiveDocumentId();
    const patchReviews = new Map(); // Map of patch UUID to reviews
    if (docId) {
        const patchesWithUuid = patches.filter(p => p.uuid);
        const reviewPromises = patchesWithUuid.map(patch =>
            invoke("get_document_patch_reviews", {
                docId,
                patchUuid: patch.uuid
            }).catch(() => []).then(reviews => ({ uuid: patch.uuid, reviews }))
        );
        const reviewResults = await Promise.all(reviewPromises);
        for (const { uuid, reviews } of reviewResults) {
            patchReviews.set(uuid, reviews);
        }
    }

    // Helper: Get reviews for a patch and determine effective status
    const getEffectiveStatus = (p) => {
        // Patches by current user are implicitly "accepted" (no review needed)
        if (p.author === currentUserId) return "accepted";

        // Check if we have reviews
        if (!p.uuid) return "pending";

        const reviews = patchReviews.get(p.uuid) || [];

        // First check for current user's review
        const myReview = reviews.find(r => r.reviewer_id === currentUserId);
        if (myReview) return myReview.decision;

        // Also check for merge-wizard reviews (conflict resolution)
        const mergeReview = reviews.find(r => r.reviewer_id === "merge-wizard");
        if (mergeReview) return mergeReview.decision;

        return "pending";
    };

    // Filter patches
    let filteredPatches = patches.filter(p => {
        // Only show Save patches (hide semantic_group which is too granular for reconciliation)
        if (p.kind !== "Save") {
            return false;
        }

        // Must have snapshot content
        if (!hasSnapshotContent(p)) {
            return false;
        }

        // Filter by author
        if (authorFilter !== "all" && p.author !== authorFilter) {
            return false;
        }

        return true;
    });

    // Hide patches that match current editor content (no changes to show)
    const currentEditorContent = getEditorContent() || '';
    filteredPatches = filteredPatches.filter(patch => {
        const snapshot = patch.data?.snapshot || '';
        return snapshot !== currentEditorContent;
    });

    // Sort patches BEFORE rendering (determines display order)
    if (sortOrder === "time-asc") {
        filteredPatches.sort((a, b) => a.timestamp - b.timestamp);
    } else if (sortOrder === "time-desc") {
        filteredPatches.sort((a, b) => b.timestamp - a.timestamp);
    } else if (sortOrder === "author") {
        filteredPatches.sort((a, b) => {
            const authorCompare = a.author.localeCompare(b.author);
            if (authorCompare !== 0) return authorCompare;
            return b.timestamp - a.timestamp; // Secondary sort by time
        });
    } else if (sortOrder === "line-order") {
        filteredPatches.sort((a, b) => {
            // Patches with line range data come first
            const aHasRange = a._lineRange !== undefined;
            const bHasRange = b._lineRange !== undefined;

            if (!aHasRange && !bHasRange) return a.timestamp - b.timestamp;
            if (!aHasRange) return 1; // a comes after
            if (!bHasRange) return -1; // b comes after

            // Both have ranges, sort by start line
            if (a._lineRange.startLine !== b._lineRange.startLine) {
                return a._lineRange.startLine - b._lineRange.startLine;
            }

            // Same start line, sort by end line
            return a._lineRange.endLine - b._lineRange.endLine;
        });
    }

    // Store filtered patches for later use
    const patchesBeforeLineFilter = [...filteredPatches];

    // Render each patch and calculate line ranges
    filteredPatches.forEach((patch) => {
        const div = document.createElement("div");
        div.className = "timeline-item";
        if (patch.id === restoredPatchId) {
            div.classList.add("restored");
        }
        div.dataset.id = patch.id;

        const ts = new Date(patch.timestamp).toLocaleString();
        const authorColor = patch.data?.authorColor || "#808080";
        // Use authorName from data if available, fallback to author ID for backward compatibility
        const authorDisplayName = patch.data?.authorName || patch.author;

        // Calculate line range if this patch has snapshot data
        let lineRangeInfo = '';
        if (hasSnapshotContent(patch)) {
            // Get previous patch for comparison
            const currentIndex = filteredPatches.indexOf(patch);
            let previousSnapshot = '';

            if (currentIndex > 0) {
                // Find previous patch with snapshot
                for (let i = currentIndex - 1; i >= 0; i--) {
                    if (hasSnapshotContent(filteredPatches[i])) {
                        previousSnapshot = filteredPatches[i].data.snapshot;
                        break;
                    }
                }
            }

            const lineRange = detectLineRange(previousSnapshot, patch.data.snapshot);
            if (lineRange) {
                const changeIcon = lineRange.type === 'added' ? '➕' :
                    lineRange.type === 'deleted' ? '➖' : '✏️';
                lineRangeInfo = `<div class="line-range-info" style="font-size:0.75rem;color:#666;margin-top:2px;">${changeIcon} ${formatLineRange(lineRange)} (${lineRange.affectedLines} ${lineRange.affectedLines === 1 ? 'line' : 'lines'})</div>`;

                // Store line range data on the patch for sorting
                patch._lineRange = lineRange;
            }
        }

        // Check if this patch is in conflict
        const hasConflict = isInConflict(patch.id, conflictState.patchConflicts);
        if (hasConflict) {
            div.classList.add("has-conflict");
        }

        // Get conflict info
        let conflictInfo = '';
        if (hasConflict) {
            const conflictingIds = conflictState.patchConflicts.get(patch.id) || [];
            conflictInfo = formatConflictInfo(patch.id, conflictingIds);
        }



        // Get review badges for this patch (excluding current user's self-review)
        let reviewBadges = '';
        if (patch.uuid && patch.author !== currentUserId) {
            const reviews = patchReviews.get(patch.uuid) || [];
            // Show latest review per reviewer (excluding current user)
            const reviewerMap = new Map();
            for (const review of reviews) {
                if (review.reviewer_id !== currentUserId) {
                    const existing = reviewerMap.get(review.reviewer_id);
                    if (!existing || review.reviewed_at > existing.reviewed_at) {
                        reviewerMap.set(review.reviewer_id, review);
                    }
                }
            }

            if (reviewerMap.size > 0) {
                reviewBadges = '<div style="margin-top:4px;">';
                for (const review of reviewerMap.values()) {
                    const icon = review.decision === 'accepted' ? '✓' : '✗';
                    const name = review.reviewer_name || review.reviewer_id;
                    reviewBadges += `<span class="review-badge ${review.decision}" title="${name} ${review.decision}">${icon} ${name}</span>`;
                }
                reviewBadges += '</div>';
            }
        }

        div.innerHTML = `
            <div class="timeline-item-header">
                <div class="timeline-item-info">
                    <strong>#${patch.id}</strong> - ${patch.kind}
                    <span class="author-badge" style="background-color:${authorColor};color:white;padding:2px 6px;border-radius:3px;font-size:0.75rem;margin-left:6px;">${authorDisplayName}</span>
                    ${conflictInfo ? `<div class="conflict-warning" style="color:#f44336;font-size:0.75rem;margin-top:2px;">${conflictInfo}</div>` : ''}
                    ${reviewBadges}
                </div>
                <div class="timeline-item-actions">
                    <button class="preview-btn" data-patch-id="${patch.id}" title="Preview diff">🔍 Preview</button>
                    <button class="restore-btn" data-patch-id="${patch.id}" title="Restore to this version">↩</button>
                </div>
            </div>
            <div class="timeline-timestamp">${ts}</div>
            ${lineRangeInfo}
        `;

        list.appendChild(div);

        // Add click listener to auto-preview when already in preview mode
        div.addEventListener('click', async (e) => {
            // Don't interfere with button clicks
            if (e.target.closest('button')) return;

            // If in preview mode, automatically preview this patch
            if (isPreviewActive()) {
                const patchId = parseInt(div.dataset.id);
                await previewPatch(patchId);
            }
        });
    });

    // Add click handlers for preview buttons
    list.querySelectorAll('.preview-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const patchId = parseInt(btn.dataset.patchId);
            await previewPatch(patchId);
        });
    });

    // Add click handlers for restore buttons
    list.querySelectorAll('.restore-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const patchId = parseInt(btn.dataset.patchId);
            await restoreToPatch(patchId);
        });
    });
}

/**
 * Preview a patch with diff highlighting
 * @param {number} patchId - The ID of the patch to preview
 */
async function previewPatch(patchId) {
    // Exit preview if already active
    if (isPreviewActive()) {
        exitPreview();
    }

    const patch = await fetchPatch(patchId);
    if (!patch) {
        alert("Failed to load patch");
        return;
    }

    // Import dependencies
    const { mergeText } = await import('./three-way-merge.js');

    // Get current editor content as markdown (the "old" state)
    const currentContent = getMarkdown();

    // Calculate what the merged result would be (3-way merge simulation)
    // base: first patch snapshot
    // local: current editor content
    // canonical: patch being previewed

    const allPatches = await fetchPatchList();
    const savePatchesOnly = allPatches
        .filter(p => p.kind === "Save" && hasSnapshotContent(p))
        .sort((a, b) => a.timestamp - b.timestamp);

    const baseSnapshot = savePatchesOnly.length > 0
        ? savePatchesOnly[0].data.snapshot
        : '';

    const patchContent = patch.data?.snapshot || '';

    // Simulate what the merge would produce
    const mergedResult = mergeText(baseSnapshot, currentContent, patchContent);

    // Show diff from current content to merged result
    // This shows "what will change if you accept this patch"
    enterPreview(patchId, currentContent, mergedResult);
}

/**
 * Format character-level diff with better line grouping
 * @param {string} oldText - Previous text
 * @param {string} newText - Current text
 * @returns {string} Diff output with character-level granularity
 */
function calculateDiff(oldText, newText) {
    const diffOps = calculateCharDiff(oldText, newText);

    // Group operations by line for better readability
    const lines = [];
    let currentLine = { add: '', delete: '', equal: '' };

    const flushLine = () => {
        if (currentLine.delete || currentLine.add || currentLine.equal) {
            // Output deletions first, then additions, then unchanged
            if (currentLine.delete) {
                lines.push(`- ${currentLine.delete}`);
            }
            if (currentLine.add) {
                lines.push(`+ ${currentLine.add}`);
            }
            if (currentLine.equal && !currentLine.delete && !currentLine.add) {
                lines.push(`  ${currentLine.equal}`);
            }
            currentLine = { add: '', delete: '', equal: '' };
        }
    };

    for (const op of diffOps) {
        const text = op.text;

        if (text.includes('\n')) {
            // Split on newlines
            const parts = text.split('\n');
            for (let i = 0; i < parts.length; i++) {
                if (i > 0) {
                    // Flush current line before newline
                    flushLine();
                }

                if (parts[i]) {
                    currentLine[op.type] += parts[i];
                }
            }
        } else {
            currentLine[op.type] += text;
        }
    }

    // Flush any remaining content
    flushLine();

    return lines.join('\n');
}


export function renderPatchDetails(patch) {
    const details = document.getElementById("timeline-details");
    const canRestore = hasSnapshotContent(patch);
    const authorDisplayName = patch.data?.authorName || patch.author;

    details.innerHTML = `
        <h3>Patch #${patch.id}</h3>
        <p><strong>Author:</strong> ${authorDisplayName}</p>
        <p><strong>Kind:</strong> ${patch.kind}</p>
        ${canRestore ? `<button class="restore-btn-detail" data-patch-id="${patch.id}">↩ Restore to this version</button>` : '<p class="no-restore-hint">No snapshot available for restoration</p>'}
        <pre>${JSON.stringify(patch.data, null, 2)}</pre>
    `;

    // Add click handler for restore button in details
    const restoreBtn = details.querySelector('.restore-btn-detail');
    if (restoreBtn) {
        restoreBtn.addEventListener('click', async () => {
            const patchId = parseInt(restoreBtn.dataset.patchId);
            await restoreToPatch(patchId);
        });
    }
}

/**
 * Reset document to state before reconciliation
 */
async function resetToOriginal() {
    const snapshot = localStorage.getItem('reconciliation-snapshot');
    const reconciliationStartTime = localStorage.getItem('reconciliation-start-time');

    if (!snapshot) {
        alert("No reconciliation snapshot found. This only works after importing patches.");
        return;
    }

    let userConfirmed = window.confirm("Reset to state before reconciliation? This will undo all accepted/rejected imported patches and reset their review status.");

    // Tauri's confirm returns a Promise, handle both cases
    if (userConfirmed instanceof Promise) {
        userConfirmed = await userConfirmed;
    }

    if (!userConfirmed) {
        return;
    }

    try {
        const docId = getActiveDocumentId();

        // Reset document content using markdown-aware function
        const success = setMarkdownContent(snapshot);
        if (!success) {
            alert("Failed to restore document");
            return;
        }

        // Delete reviews made after reconciliation started
        if (docId && reconciliationStartTime) {
            const currentUser = getCachedProfile();
            const reviewerId = currentUser?.id || 'local';

            try {
                const deleted = await invoke("delete_document_reviews_after", {
                    docId,
                    afterTimestamp: parseInt(reconciliationStartTime),
                    reviewerId
                });

                if (deleted > 0) {
                    console.log(`Reset ${deleted} patch review(s) made during reconciliation`);
                }
            } catch (err) {
                console.warn("Failed to reset reviews:", err);
                // Continue even if review reset fails - document is already restored
            }
        }

        alert("Document restored to state before reconciliation. Patch reviews have been reset.");
        await refreshTimeline();

    } catch (err) {
        console.error("Reset failed:", err);
        alert(`Failed to reset: ${err}`);
    }
}

// Track last alert time to prevent spam
let lastConflictAlertTime = 0;


/**
 * Get the current conflict state (for use by other modules)
 * @returns {Object} - { conflictGroups, patchConflicts }
 */
export function getConflictState() {
    return conflictState;
}
