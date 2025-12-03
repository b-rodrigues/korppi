import { invoke } from "@tauri-apps/api/core";
import { forceSave, restoreDocumentState } from "./yjs-setup.js";
import { getActiveDocumentId } from "./document-manager.js";

// Track the currently selected/restored patch
let restoredPatchId = null;

export async function fetchPatchList() {
    return await invoke("list_patches").catch(() => []);
}

export async function fetchPatch(id) {
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
                ${canRestore ? `<button class="restore-btn" data-patch-id="${patch.id}" title="Restore to this version">↩ Restore</button>` : ''}
            </div>
            <div class="timeline-timestamp">${ts}</div>
        `;

        list.appendChild(div);
    });

    // Add click handlers for restore buttons
    list.querySelectorAll('.restore-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation(); // Prevent triggering the timeline item click
            const patchId = parseInt(btn.dataset.patchId);
            await restoreToPatch(patchId);
        });
    });
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
