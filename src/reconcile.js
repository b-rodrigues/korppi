import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getActiveDocumentId } from "./document-manager.js";
import { getMarkdown } from "./editor.js";
import { showRightSidebar } from "./components/sidebar-controller.js";
import { getCachedProfile } from "./profile-service.js";
import { logEvent, EVENT_TYPES } from "./document-log.js";

// In-memory storage for computed hunks during reconciliation
// Map<documentId, Array<AuthoredHunk>>
const reconciliationHunks = new Map();

/**
 * Get the current reconciliation hunks for the active document
 * @returns {Array} Array of AuthoredHunk objects
 */
export function getReconciliationHunks() {
    const docId = getActiveDocumentId();
    return (docId && reconciliationHunks.get(docId)) || [];
}

/**
 * Clear the reconciliation hunks for the active document
 */
export function clearReconciliationHunks() {
    const docId = getActiveDocumentId();
    if (docId) {
        reconciliationHunks.delete(docId);
    }
}

/**
 * Start reconciliation process
 */
export async function startReconciliation() {
    const docId = getActiveDocumentId();
    if (!docId) {
        alert("No active document. Please create or open a document first.");
        return;
    }

    // Save current state (base content)
    const baseContent = getMarkdown();

    // Save current user metadata for the base snapshot
    const currentUser = getCachedProfile();
    const baseInfo = {
        author: currentUser?.id || 'local',
        authorName: currentUser?.name || 'Original',
        authorColor: currentUser?.color || '#333333',
        timestamp: Date.now()
    };
    localStorage.setItem(`reconciliation-base-info-${docId}`, JSON.stringify(baseInfo));

    // Save the timestamp when reconciliation started (for resetting reviews)
    const reconciliationStartTime = Date.now();
    localStorage.setItem(`reconciliation-start-time-${docId}`, reconciliationStartTime.toString());

    // Let user pick one or more .kmd files
    const selectedPaths = await open({
        title: "Select Korppi Document(s) to Reconcile",
        multiple: true,
        directory: false,
        filters: [{
            name: "Korppi Document",
            extensions: ["kmd"]
        }]
    });

    if (!selectedPaths || selectedPaths.length === 0) {
        return; // User cancelled
    }

    try {
        // Import patches from each selected file
        for (const sourcePath of selectedPaths) {
            await invoke("import_patches_from_document", {
                targetDocId: docId,
                sourcePath: sourcePath
            });
        }

        // Log the import event
        logEvent(EVENT_TYPES.IMPORT, {
            count: selectedPaths.length,
            files: selectedPaths.map(p => p.split('/').pop() || p.split('\\').pop())
        });

        // Reuse the logic for calculating hunks
        await recalculateReconcileState(baseContent, null); // null patchId means no swap, just pure calc

        // Show UI only after first success
        showRightSidebar('timeline');
        window.dispatchEvent(new CustomEvent('reconciliation-imported'));

        // Show guidance toast
        showReconciliationToast();

    } catch (err) {
        console.error("Reconciliation failed:", err);
        alert(`Failed to import patches: ${err}`);
    }
}

/**
 * Re-calculate all hunks based on a new Base Content.
 * optionally swapping the previous base into a synthetic patch.
 * 
 * @param {string} newBaseContent - The full markdown text of the new base.
 * @param {number|null} newBasePatchId - If restoring a patch, this is its ID. We filter it OUT of the patch list.
 */
export async function recalculateReconcileState(newBaseContent, newBasePatchId = null) {
    const docId = getActiveDocumentId();
    if (!docId) return;

    console.log(`Re-calculating reconciliation state. New Base Length: ${newBaseContent.length}, Swapped Patch ID: ${newBasePatchId}`);

    // 1. Get previous base info (if we are swapping)
    let previousBaseContent = localStorage.getItem(`reconciliation-snapshot-${docId}`);
    let previousBaseInfo = null;
    try {
        previousBaseInfo = JSON.parse(localStorage.getItem(`reconciliation-base-info-${docId}`));
    } catch (e) { /* ignore */ }

    // 2. Fetch all patches
    const patches = await invoke("list_document_patches", { id: docId }).catch(() => []);

    // 3. Filter Patch List
    // - Keep 'Save' patches with snapshots
    // - EXCLUDE the patch that is becoming the new base (if any)
    let validPatches = patches.filter(p => p.kind === "Save" && p.data?.snapshot);

    if (newBasePatchId !== null) {
        validPatches = validPatches.filter(p => p.id !== newBasePatchId);
    }

    // 4. Construct Synthetic Patch from Old Base (if swapping)
    // Only do this if we are swapping (newBasePatchId is NOT null) AND we have previous base data
    if (newBasePatchId !== null && previousBaseContent && previousBaseContent !== newBaseContent) {
        // Check if this Previous Base already exists as a real patch in our valid list
        // (e.g., if we are swapping AWAY from "Alice's Patch", Alice's patch is now back in validPatches)
        const existingPatch = validPatches.find(p => p.data?.snapshot === previousBaseContent);

        if (!existingPatch) {
            // It's a truly strict "Original" (or manual edit) that isn't in DB. Create Synthetic Patch.
            // We use a fake negative ID to avoid collision.
            const syntheticPatch = {
                id: -999, // Magic ID for "Previous Original"
                uuid: "synthetic-original-base",
                author: previousBaseInfo?.author || "original-base",
                data: {
                    authorName: previousBaseInfo?.authorName || "Original Base",
                    authorColor: previousBaseInfo?.authorColor || "#7f8c8d",
                    snapshot: previousBaseContent
                },
                timestamp: previousBaseInfo?.timestamp || Date.now()
            };

            // Add to list
            validPatches.push(syntheticPatch);
            console.log("Injected Synthetic Patch for Old Base");
        } else {
            console.log("Previous Base matches existing patch. Skipping synthetic creation to avoid duplication.");
        }
    }

    // 5. Prepare inputs for Rust
    const patchInputs = validPatches.map(p => ({
        id: p.id,
        uuid: p.uuid || null,
        author: p.author,
        author_name: p.data?.authorName || p.author,
        author_color: p.data?.authorColor || '#3498db',
        timestamp: p.timestamp,
        snapshot: p.data.snapshot
    }));

    // 6. Calculate Hunks
    const hunks = await invoke("calculate_hunks_for_patches", {
        baseContent: newBaseContent,
        patches: patchInputs
    });

    // Store in per-document map
    reconciliationHunks.set(docId, hunks);

    console.log(`Computed ${hunks.length} hunks against New Base`);

    // 7. Update LocalStorage with NEW Base Info
    localStorage.setItem(`reconciliation-snapshot-${docId}`, newBaseContent);

    // If we swapped, we need to update the base info to match the New Patch's author info
    if (newBasePatchId !== null) {
        // Find the original patch object to get metadata
        const originalPatch = patches.find(p => p.id === newBasePatchId);
        if (originalPatch) {
            const newBaseInfo = {
                author: originalPatch.author,
                authorName: originalPatch.data?.authorName || originalPatch.author,
                authorColor: originalPatch.data?.authorColor || '#3498db',
                timestamp: originalPatch.timestamp
            };
            localStorage.setItem(`reconciliation-base-info-${docId}`, JSON.stringify(newBaseInfo));
        }
    }

    // 8. Dispatch Events
    window.dispatchEvent(new CustomEvent('reconciliation-hunks-ready', {
        detail: {
            hunks: hunks,
            patches: patchInputs
        }
    }));
}

/**
 * Show a toast notification with guidance
 */
function showReconciliationToast() {
    const toast = document.createElement("div");
    toast.className = "reconciliation-toast"; // Use minimal class for potential css targeting
    toast.innerHTML = `
        <div style="font-weight: bold; margin-bottom: 4px; font-size: 1rem; display: flex; justify-content: space-between; align-items: center;">
            <span>Reconciliation Started</span>
            <span id="toast-countdown" style="font-size: 0.8em; opacity: 0.8; background: rgba(255,255,255,0.1); padding: 2px 6px; border-radius: 4px;">5s</span>
        </div>
        <div style="line-height: 1.4;">
            Review individual changes in <span style="font-weight:bold; color: var(--primary, #4fc3f7);">Track Changes</span> tab<br>
            or completely restore versions in <span style="font-weight:bold; color: var(--primary, #4fc3f7);">Timeline</span> tab.
        </div>
    `;
    toast.style.cssText = `
        position: fixed;
        top: 24px;
        right: 24px;
        background: var(--bg-elevated, #333);
        color: var(--text-primary, #fff);
        padding: 16px 24px;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
        border: 1px solid var(--border-color, #444);
        z-index: 10000;
        font-size: 0.95rem;
        text-align: left;
        opacity: 0;
        transition: opacity 0.3s ease, transform 0.3s ease;
        pointer-events: none; 
    `;

    document.body.appendChild(toast);

    // Fade in
    requestAnimationFrame(() => {
        toast.style.opacity = "1";
        toast.style.transform = "translateY(0)"; // subtle pop
    });

    // Countdown logic
    let timeLeft = 5;
    const countdownEl = toast.querySelector("#toast-countdown");

    const intervalId = setInterval(() => {
        timeLeft--;
        if (timeLeft > 0) {
            if (countdownEl) countdownEl.textContent = `${timeLeft}s`;
        } else {
            clearInterval(intervalId);
            // Fade out and remove
            toast.style.opacity = "0";
            setTimeout(() => toast.remove(), 300);
        }
    }, 1000);
}
