import { invoke } from "@tauri-apps/api/core";
import { forceSave, restoreDocumentState } from "./yjs-setup.js";
import { getActiveDocumentId } from "./document-manager.js";

// Track the currently selected/restored patch
let restoredPatchId = null;

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
function hasSnapshotContent(patch) {
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
async function refreshTimeline() {
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

export function renderPatchList(patches) {
    const list = document.getElementById("timeline-list");
    list.innerHTML = "";

    patches.forEach((patch) => {
        const div = document.createElement("div");
        div.className = "timeline-item";
        if (patch.id === restoredPatchId) {
            div.classList.add("restored");
        }
        div.dataset.id = patch.id;

        const ts = new Date(patch.timestamp).toLocaleString();
        const canRestore = hasSnapshotContent(patch);

        div.innerHTML = `
            <div class="timeline-item-header">
                <div class="timeline-item-info">
                    <strong>#${patch.id}</strong> - ${patch.kind}
                </div>
                <div class="timeline-item-actions">
                    <button class="view-btn" data-patch-id="${patch.id}" title="View content">👁️</button>
                    ${canRestore ? `<button class="restore-btn" data-patch-id="${patch.id}" title="Restore to this version">↩</button>` : ''}
                </div>
            </div>
            <div class="timeline-timestamp">${ts}</div>
        `;

        list.appendChild(div);
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

    // Get previous patch for diff
    const patches = await fetchPatchList();
    const currentIndex = patches.findIndex(p => p.id === patchId);
    let diff = null;

    if (currentIndex > 0) {
        const previousPatch = patches[currentIndex - 1];
        const previousContent = previousPatch.data?.snapshot || "";
        diff = calculateDiff(previousContent, content);
    } else {
        diff = "No previous version to compare with";
    }

    showContentModal(patchId, content, diff);
}

/**
 * Calculate a simple diff between two text strings
 * @param {string} oldText - Previous text
 * @param {string} newText - Current text
 * @returns {string} Diff output
 */
function calculateDiff(oldText, newText) {
    const oldLines = oldText.split('\n');
    const newLines = newText.split('\n');
    const diff = [];

    const maxLength = Math.max(oldLines.length, newLines.length);

    for (let i = 0; i < maxLength; i++) {
        const oldLine = oldLines[i];
        const newLine = newLines[i];

        if (oldLine === undefined) {
            diff.push(`+ ${newLine}`);
        } else if (newLine === undefined) {
            diff.push(`- ${oldLine}`);
        } else if (oldLine !== newLine) {
            diff.push(`- ${oldLine}`);
            diff.push(`+ ${newLine}`);
        } else {
            diff.push(`  ${oldLine}`);
        }
    }

    return diff.join('\n');
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
        modal.style.cssText = "display:none;position:fixed;z-index:1000;left:0;top:0;width:100%;height:100%;overflow:auto;background-color:rgba(0,0,0,0.4);";

        modal.innerHTML = `
            <div class="modal-content" style="background-color:#fefefe;margin:5% auto;padding:0;border:1px solid #888;width:80%;max-width:800px;box-shadow:0 4px 8px rgba(0,0,0,0.2);">
                <div class="modal-header" style="padding:15px;background-color:#f1f1f1;border-bottom:1px solid #ddd;">
                    <span class="modal-close" style="color:#aaa;float:right;font-size:28px;font-weight:bold;cursor:pointer;">&times;</span>
                    <h2 style="margin:0;">Patch Content</h2>
                </div>
                <div class="modal-tabs" style="display:flex;background:#e1e1e1;border-bottom:1px solid #ccc;">
                    <button class="tab-btn active" data-tab="content" style="flex:1;padding:10px;border:none;background:transparent;cursor:pointer;font-weight:bold;">Content</button>
                    <button class="tab-btn" data-tab="diff" style="flex:1;padding:10px;border:none;background:transparent;cursor:pointer;font-weight:bold;">Diff</button>
                </div>
                <div class="modal-body" style="padding:20px;max-height:60vh;overflow-y:auto;">
                    <pre id="patch-content" class="tab-content" style="display:block;background:#f5f5f5;padding:15px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;word-wrap:break-word;"></pre>
                    <pre id="patch-diff" class="tab-content" style="display:none;background:#f5f5f5;padding:15px;border-radius:4px;overflow-x:auto;white-space:pre-wrap;word-wrap:break-word;font-family:monospace;"></pre>
                </div>
                <div class="modal-footer" style="padding:15px;background-color:#f1f1f1;border-top:1px solid #ddd;text-align:right;">
                    <button class="modal-close-btn" style="padding:8px 16px;background-color:#4CAF50;color:white;border:none;border-radius:4px;cursor:pointer;">Close</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Close handlers
        const closeModal = () => { modal.style.display = "none"; };
        modal.querySelector(".modal-close").onclick = closeModal;
        modal.querySelector(".modal-close-btn").onclick = closeModal;

        // Click outside to close
        window.onclick = (event) => {
            if (event.target === modal) {
                closeModal();
            }
        };

        // Tab switching
        modal.querySelectorAll(".tab-btn").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const tab = e.target.dataset.tab;

                // Update button states
                modal.querySelectorAll(".tab-btn").forEach(b => {
                    b.classList.remove("active");
                    b.style.backgroundColor = "transparent";
                });
                e.target.classList.add("active");
                e.target.style.backgroundColor = "#f1f1f1";

                // Show/hide content
                modal.querySelectorAll(".tab-content").forEach(content => {
                    content.style.display = "none";
                });

                if (tab === "content") {
                    modal.querySelector("#patch-content").style.display = "block";
                } else if (tab === "diff") {
                    modal.querySelector("#patch-diff").style.display = "block";
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
        b.style.backgroundColor = "transparent";
    });
    const contentBtn = modal.querySelector('[data-tab="content"]');
    if (contentBtn) {
        contentBtn.classList.add("active");
        contentBtn.style.backgroundColor = "#f1f1f1";
    }

    modal.querySelectorAll(".tab-content").forEach(content => {
        content.style.display = "none";
    });
    modal.querySelector("#patch-content").style.display = "block";

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
