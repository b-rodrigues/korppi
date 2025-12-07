import { invoke } from "@tauri-apps/api/core";
import { forceSave, restoreDocumentState } from "./yjs-setup.js";
import { getActiveDocumentId, onDocumentChange } from "./document-manager.js";
import { enterPreview, exitPreview, isPreviewActive } from "./diff-preview.js";
import { calculateCharDiff } from "./diff-highlighter.js";
import { detectLineRange, formatLineRange } from "./line-range-detector.js";
import { detectPatchConflicts, isInConflict, formatConflictInfo, getConflictGroup } from "./conflict-detection.js";

// Track the currently selected/restored patch
let restoredPatchId = null;

// Track conflict state
let conflictState = {
    conflictGroups: [],
    patchConflicts: new Map()
};

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
    // The snapshot field contains the text content - use optional chaining for safety
    const snapshot = patch.data?.snapshot;
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

        // Try to restore using the snapshot content from the patch
        if (hasSnapshotContent(patch)) {
            const success = restoreDocumentState(patch.data.snapshot);
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
                const success = restoreDocumentState(result.snapshot_content);
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
            const success = restoreDocumentState(result.snapshot_content);
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

/**
 * Refresh the timeline list
 */
export async function refreshTimeline() {
    const patches = await fetchPatchList();
    renderPatchList(patches);
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
    const filterStatus = document.getElementById("filter-status");
    const resetBtn = document.getElementById("reset-to-original-btn");
    const lineStart = document.getElementById("filter-line-start");
    const lineRange = document.getElementById("filter-line-range");
    const clearLineFilter = document.getElementById("clear-line-filter");

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

    if (filterStatus) {
        filterStatus.addEventListener("change", () => {
            refreshTimeline();
        });
    }

    // Wire up line range filter inputs
    if (lineStart) {
        lineStart.addEventListener("change", () => {
            refreshTimeline();
        });
    }

    if (lineRange) {
        lineRange.addEventListener("change", () => {
            refreshTimeline();
        });
    }

    // Wire up clear line filter button
    if (clearLineFilter) {
        clearLineFilter.addEventListener("click", () => {
            if (lineStart) lineStart.value = "";
            if (lineRange) lineRange.value = "";
            refreshTimeline();
        });
    }

    // Wire up reset button
    if (resetBtn) {
        resetBtn.addEventListener("click", async () => {
            await resetToOriginal();
        });
    }

    // Listen for patch status updates
    window.addEventListener('patch-status-updated', async () => {
        await refreshTimeline();
    });

    // Listen for reconciliation import event
    window.addEventListener('reconciliation-imported', async () => {
        await refreshTimeline();
    });

    // Listen for document changes (open, switch, new)
    onDocumentChange(async (event, doc) => {
        if (event === "open" || event === "new" || event === "activeChange") {
            await refreshTimeline();
        }
    });

    // Initial load
    refreshTimeline();
}

export function renderPatchList(patches) {
    const list = document.getElementById("timeline-list");
    list.innerHTML = "";

    // Detect conflicts in patches
    conflictState = detectPatchConflicts(patches);
    
    // Show alert if conflicts detected
    if (conflictState.conflictGroups.length > 0) {
        showConflictAlert(conflictState.conflictGroups, patches);
    }

    // Get filter values
    const authorFilter = document.getElementById("filter-author")?.value || "all";
    const statusFilter = document.getElementById("filter-status")?.value || "all";
    const sortOrder = document.getElementById("timeline-sort")?.value || "time-desc";
    const lineStart = parseInt(document.getElementById("filter-line-start")?.value) || null;
    const lineRange = parseInt(document.getElementById("filter-line-range")?.value) || null;

    // Calculate line end from start + range
    const lineEnd = (lineStart !== null && lineRange !== null) ? lineStart + lineRange : null;

    // Populate author dropdown with unique authors
    const filterAuthorSelect = document.getElementById("filter-author");
    if (filterAuthorSelect && patches.length > 0) {
        const uniqueAuthors = [...new Set(patches.map(p => p.author))];
        const currentValue = filterAuthorSelect.value;

        filterAuthorSelect.innerHTML = '<option value="all">All Authors</option>' +
            uniqueAuthors.map(author =>
                `<option value="${author}" ${currentValue === author ? 'selected' : ''}>${author}</option>`
            ).join('');
    }

    // Filter patches
    let filteredPatches = patches.filter(p => {
        // Filter by author
        if (authorFilter !== "all" && p.author !== authorFilter) {
            return false;
        }

        // Filter by status
        if (statusFilter !== "all" && p.review_status !== statusFilter) {
            return false;
        }

        return true;
    });

    // Sort patches
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

    // Filter to only show patches with snapshots  
    filteredPatches = filteredPatches.filter(patch => hasSnapshotContent(patch));

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

        // Calculate line range if this patch has snapshot data
        let lineRangeInfo = '';
        if (patch.data?.snapshot) {
            // Get previous patch for comparison
            const currentIndex = filteredPatches.indexOf(patch);
            let previousSnapshot = '';

            if (currentIndex > 0) {
                // Find previous patch with snapshot
                for (let i = currentIndex - 1; i >= 0; i--) {
                    if (filteredPatches[i].data?.snapshot) {
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

        // Apply line range filter if set
        if (lineStart !== null || lineEnd !== null) {
            if (!patch._lineRange) {
                return; // Skip patches without line range data when filtering
            }

            const patchStart = patch._lineRange.startLine;
            const patchEnd = patch._lineRange.endLine;

            // Check if patch overlaps with the requested range
            if (lineStart !== null && patchEnd < lineStart) {
                return; // Patch is entirely before the requested range
            }
            if (lineEnd !== null && patchStart > lineEnd) {
                return; // Patch is entirely after the requested range
            }
        }

        div.innerHTML = `
            <div class="timeline-item-header">
                <div class="timeline-item-info">
                    <strong>#${patch.id}</strong> - ${patch.kind}
                    <span class="author-badge" style="background-color:${authorColor};color:white;padding:2px 6px;border-radius:3px;font-size:0.75rem;margin-left:6px;">${patch.author}</span>
                    ${conflictInfo ? `<div class="conflict-warning" style="color:#f44336;font-size:0.75rem;margin-top:2px;">${conflictInfo}</div>` : ''}
                </div>
                <div class="timeline-item-actions">
                    <button class="preview-btn" data-patch-id="${patch.id}" title="Preview diff">🔍 Preview</button>
                    <button class="view-btn" data-patch-id="${patch.id}" title="View content">👁️</button>
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

    // Add click handlers for view buttons
    list.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const patchId = parseInt(btn.dataset.patchId);
            await viewPatchContent(patchId);
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
    const { getEditorContent } = await import('./editor.js');
    const { mergeText } = await import('./three-way-merge.js');

    // Get current editor content as the "old" state
    const currentContent = getEditorContent();

    // Calculate what the merged result would be (3-way merge simulation)
    // base: first patch snapshot
    // local: current editor content
    // canonical: patch being previewed

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

    // Show diff from current content to merged result
    // This shows "what will change if you accept this patch"
    enterPreview(patchId, currentContent, mergedResult);
}

/**
 * View the content of a patch in a modal
 * @param {number} patchId - The ID of the patch to view
 */
async function viewPatchContent(patchId) {
    const patch = await fetchPatch(patchId);
    if (!patch) {
        alert("Failed to load patch");
        return;
    }

    const content = patch.data?.snapshot || "No content available";

    // Get previous SAVE patch for diff (not edit patches)
    const allPatches = await fetchPatchList();
    const savePatchesOnly = allPatches.filter(p => hasSnapshotContent(p));
    const currentIndex = savePatchesOnly.findIndex(p => p.id === patchId);
    let diff = null;

    if (currentIndex > 0) {
        const previousPatch = savePatchesOnly[currentIndex - 1];
        const previousContent = previousPatch.data?.snapshot || "";
        diff = calculateDiff(previousContent, content);
    } else {
        diff = "No previous version to compare with";
    }

    showContentModal(patchId, content, diff);
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

/**
 * Show a modal with patch content
 * @param {number} patchId - Patch ID
 * @param {string} content - Content to display
 * @param {string} diff - Diff to display
 */
function showContentModal(patchId, content, diff) {
    let modal = document.getElementById("patch-content-modal");

    if (!modal) {
        // Create modal on first use
        modal = document.createElement("div");
        modal.id = "patch-content-modal";
        modal.className = "modal";

        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Patch Content</h2>
                    <span class="modal-close">&times;</span>
                </div>
                <div class="modal-tabs">
                    <button class="tab-btn active" data-tab="content">Content</button>
                    <button class="tab-btn" data-tab="diff">Diff</button>
                </div>
                <div class="modal-body">
                    <pre id="patch-content" class="tab-content visible"></pre>
                    <pre id="patch-diff" class="tab-content"></pre>
                </div>
                <div class="modal-footer">
                    <button class="modal-close-btn">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Close handlers
        const closeModal = () => { modal.style.display = "none"; };
        modal.querySelector(".modal-close").onclick = closeModal;
        modal.querySelector(".modal-close-btn").onclick = closeModal;

        // Click outside to close
        modal.addEventListener("click", (event) => {
            if (event.target === modal) {
                closeModal();
            }
        });

        // Tab switching
        modal.querySelectorAll(".tab-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const tab = e.target.dataset.tab;

                // Update button states
                modal.querySelectorAll(".tab-btn").forEach(b => {
                    b.classList.remove("active");
                });
                e.target.classList.add("active");

                // Show/hide content
                modal.querySelectorAll(".tab-content").forEach(c => {
                    c.classList.remove("visible");
                });

                if (tab === "content") {
                    modal.querySelector("#patch-content").classList.add("visible");
                } else if (tab === "diff") {
                    modal.querySelector("#patch-diff").classList.add("visible");
                }
            });
        });
    }

    // Update content
    const contentEl = modal.querySelector("#patch-content");
    const diffEl = modal.querySelector("#patch-diff");
    const headerEl = modal.querySelector(".modal-header h2");

    if (contentEl) contentEl.textContent = content;
    if (diffEl) diffEl.textContent = diff || "No diff available";
    if (headerEl) headerEl.textContent = `Patch #${patchId}`;

    // Reset to content tab
    modal.querySelectorAll(".tab-btn").forEach(b => {
        b.classList.remove("active");
    });
    const contentBtn = modal.querySelector('[data-tab="content"]');
    if (contentBtn) {
        contentBtn.classList.add("active");
    }

    modal.querySelectorAll(".tab-content").forEach(c => {
        c.classList.remove("visible");
    });
    modal.querySelector("#patch-content").classList.add("visible");

    // Show modal
    modal.style.display = "block";
}

export function renderPatchDetails(patch) {
    const details = document.getElementById("timeline-details");
    const canRestore = hasSnapshotContent(patch);

    details.innerHTML = `
        <h3>Patch #${patch.id}</h3>
        <p><strong>Author:</strong> ${patch.author}</p>
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

    if (!snapshot) {
        alert("No reconciliation snapshot found. This only works after importing patches.");
        return;
    }

    let userConfirmed = window.confirm("Reset to state before reconciliation? This will undo all accepted imported patches.");

    // Tauri's confirm returns a Promise, handle both cases
    if (userConfirmed instanceof Promise) {
        userConfirmed = await userConfirmed;
    }

    if (!userConfirmed) {
        return;
    }

    try {
        const docId = getActiveDocumentId();

        // Reset document content
        const success = restoreDocumentState(snapshot);
        if (!success) {
            alert("Failed to restore document");
            return;
        }

        // Reset all patch statuses back to pending
        await invoke("reset_imported_patches_status", { docId });

        // DON'T clear the snapshot - keep it for future resets
        // localStorage.removeItem('reconciliation-snapshot');

        alert("Document restored to state before reconciliation. All patches reset to pending.");
        await refreshTimeline();

    } catch (err) {
        console.error("Reset failed:", err);
        alert(`Failed to reset: ${err}`);
    }
}

// Track last alert time to prevent spam
let lastConflictAlertTime = 0;

/**
 * Show alert when conflicts are detected
 * @param {Array<Array<number>>} conflictGroups - Groups of conflicting patch IDs
 * @param {Array} patches - All patches
 */
function showConflictAlert(conflictGroups, patches) {
    // Only show alert once per timeline load (avoid spam on filters)
    const timeSinceLastAlert = Date.now() - lastConflictAlertTime;
    if (timeSinceLastAlert < 5000) {
        return; // Don't spam alerts
    }
    lastConflictAlertTime = Date.now();

    const groupCount = conflictGroups.length;
    let message = `⚠️ ${groupCount} conflict group${groupCount > 1 ? 's' : ''} detected.\n\n`;
    
    // Add details about each group
    conflictGroups.forEach((group, index) => {
        const patchIds = group.map(id => `#${id}`).join(', ');
        message += `Group ${index + 1}: Patches ${patchIds} modify the same text.\n`;
    });
    
    alert(message);
}

/**
 * Get the current conflict state (for use by other modules)
 * @returns {Object} - { conflictGroups, patchConflicts }
 */
export function getConflictState() {
    return conflictState;
}
