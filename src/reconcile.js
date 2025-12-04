// src/reconcile.js
// Document reconciliation for async collaboration

import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getActiveDocumentId } from "./document-manager.js";

/**
 * State for reconciliation process
 */
let reconcileState = {
    active: false,
    importedPatches: [],
    reviewedChanges: new Map(), // change_id -> 'accepted' | 'rejected' | 'pending'
    currentChangeIndex: 0
};

/**
 * Start reconciliation process - select external documents
 */
export async function startReconciliation() {
    const docId = getActiveDocumentId();
    if (!docId) {
        alert("Please open a document first");
        return false;
    }

    // Let user select one or more KMD files
    const selected = await open({
        filters: [{ name: 'Korppi Document', extensions: ['kmd'] }],
        multiple: true
    });

    if (!selected || (Array.isArray(selected) && selected.length === 0)) {
        return false; // User cancelled
    }

    const files = Array.isArray(selected) ? selected : [selected];

    try {
        // Import patches from each selected file
        const allImportedPatches = [];

        for (const filePath of files) {
            const patches = await invoke("import_patches_from_document", {
                sourcePath: filePath,
                targetDocId: docId
            });

            allImportedPatches.push(...patches);
        }

        if (allImportedPatches.length === 0) {
            alert("No changes found in selected documents");
            return false;
        }

        // Store imported patches for review mode
        reconcileState = {
            active: false, // Not in review mode yet
            importedPatches: allImportedPatches,
            reviewMode: false
        };

        // Refresh timeline to show all patches (including imported ones)
        window.dispatchEvent(new CustomEvent('reconciliation-imported'));

        alert(`Successfully imported ${allImportedPatches.length} changes from ${files.length} document(s).\n\nClick "Review Changes" in the timeline to review them.`);
        return true;

    } catch (err) {
        console.error("Failed to import patches:", err);
        alert(`Failed to reconcile documents: ${err}`);
        return false;
    }
}

/**
 * Enter review mode - show all changes with inline highlights
 */
export function enterReviewMode() {
    if (!reconcileState.importedPatches || reconcileState.importedPatches.length === 0) {
        alert("No imported changes to review");
        return;
    }

    reconcileState.reviewMode = true;
    reconcileState.active = true;

    showReviewControls();
    renderInlineHighlights();
}

/**
 * Exit review mode
 */
export function exitReviewMode(apply = false) {
    if (!reconcileState.active) return;

    if (apply) {
        applyAcceptedChanges();
    }

    // Clean up UI
    hideReviewBanner();
    hideReviewSidebar();
    clearChangeOverlays();

    // Reset state
    reconcileState = {
        active: false,
        importedPatches: [],
        reviewedChanges: new Map(),
        currentChangeIndex: 0
    };
}

/**
 * Show review mode banner
 */
function showReviewBanner() {
    let banner = document.getElementById('reconcile-banner');

    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'reconcile-banner';
        banner.innerHTML = `
            <div class="reconcile-info">
                <span class="reconcile-label">📋 Reconcile Mode: <span id="reconcile-progress"></span></span>
            </div>
            <div class="reconcile-controls">
                <button class="nav-btn" id="prev-change-btn" title="Previous change (←)">← Prev</button>
                <button class="nav-btn" id="next-change-btn" title="Next change (→)">Next →</button>
                <button class="bulk-btn" id="accept-all-btn">✓ Accept All</button>
                <button class="bulk-btn" id="reject-all-btn">✗ Reject All</button>
                <button class="apply-btn" id="apply-changes-btn">Apply Changes</button>
                <button class="cancel-btn" id="cancel-reconcile-btn">✕ Cancel</button>
            </div>
        `;

        const editorContainer = document.getElementById('editor');
        if (editorContainer) {
            editorContainer.parentElement.insertBefore(banner, editorContainer);
        }

        // Wire up controls
        banner.querySelector('#prev-change-btn').addEventListener('click', () => navigateChange(-1));
        banner.querySelector('#next-change-btn').addEventListener('click', () => navigateChange(1));
        banner.querySelector('#accept-all-btn').addEventListener('click', () => acceptAll());
        banner.querySelector('#reject-all-btn').addEventListener('click', () => rejectAll());
        banner.querySelector('#apply-changes-btn').addEventListener('click', () => exitReviewMode(true));
        banner.querySelector('#cancel-reconcile-btn').addEventListener('click', () => exitReviewMode(false));
    }

    updateProgressDisplay();
    banner.style.display = 'flex';
}

/**
 * Hide review banner
 */
function hideReviewBanner() {
    const banner = document.getElementById('reconcile-banner');
    if (banner) {
        banner.style.display = 'none';
    }
}

/**
 * Show review sidebar with author list
 */
function showReviewSidebar() {
    let sidebar = document.getElementById('reconcile-sidebar');

    if (!sidebar) {
        sidebar = document.createElement('div');
        sidebar.id = 'reconcile-sidebar';

        const editorContainer = document.getElementById('editor');
        if (editorContainer) {
            editorContainer.parentElement.appendChild(sidebar);
        }
    }

    // Get unique authors
    const authors = [...new Set(reconcileState.importedPatches.map(p => p.author))];

    let html = '<h3>Authors</h3><div class="author-list">';
    authors.forEach(author => {
        const count = reconcileState.importedPatches.filter(p => p.author === author).length;
        html += `
            <div class="author-item">
                <span class="author-name">${author}</span>
                <span class="author-count">${count} changes</span>
            </div>
        `;
    });
    html += '</div>';

    sidebar.innerHTML = html;
    sidebar.style.display = 'block';
}

/**
 * Hide review sidebar
 */
function hideReviewSidebar() {
    const sidebar = document.getElementById('reconcile-sidebar');
    if (sidebar) {
        sidebar.style.display = 'none';
    }
}

/**
 * Render all changes in the editor as overlays
 */
function renderAllChanges() {
    // This will be implemented to show visual markers for each change
    // For now, just update the progress
    updateProgressDisplay();
}

/**
 * Clear change overlays
 */
function clearChangeOverlays() {
    const overlay = document.getElementById('reconcile-changes-overlay');
    if (overlay) {
        overlay.remove();
    }
}

/**
 * Navigate to next/previous change
 * @param {number} direction - 1 for next, -1 for previous
 */
function navigateChange(direction) {
    const newIndex = reconcileState.currentChangeIndex + direction;
    if (newIndex >= 0 && newIndex < reconcileState.importedPatches.length) {
        reconcileState.currentChangeIndex = newIndex;
        showChangePopup(newIndex);
    }
}

/**
 * Show popup for reviewing a specific change
 * @param {number} index - Change index
 */
function showChangePopup(index) {
    const patch = reconcileState.importedPatches[index];
    const status = reconcileState.reviewedChanges.get(index);

    let modal = document.getElementById('change-review-modal');

    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'change-review-modal';
        modal.className = 'modal';
        modal.style.display = 'none';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Review Change</h2>
                    <button class="modal-close">&times;</button>
                </div>
                <div class="modal-body">
                    <div id="change-details"></div>
                </div>
                <div class="modal-footer">
                    <button class="reject-change-btn">✗ Reject</button>
                    <button class="skip-change-btn">Skip</button>
                    <button class="accept-change-btn">✓ Accept</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        modal.querySelector('.modal-close').addEventListener('click', () => closeChangePopup());
        modal.querySelector('.accept-change-btn').addEventListener('click', () => acceptChange(index));
        modal.querySelector('.reject-change-btn').addEventListener('click', () => rejectChange(index));
        modal.querySelector('.skip-change-btn').addEventListener('click', () => closeChangePopup());
    }

    // Update content
    const detailsEl = modal.querySelector('#change-details');
    const timestamp = new Date(patch.timestamp).toLocaleString();
    detailsEl.innerHTML = `
        <p><strong>Author:</strong> ${patch.author}</p>
        <p><strong>Time:</strong> ${timestamp}</p>
        <p><strong>Type:</strong> ${patch.kind}</p>
        <p><strong>Status:</strong> <span class="status-${status}">${status}</span></p>
        <div class="change-content">
            <pre>${JSON.stringify(patch.data, null, 2)}</pre>
        </div>
    `;

    modal.style.display = 'block';
}

/**
 * Close change popup
 */
function closeChangePopup() {
    const modal = document.getElementById('change-review-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

/**
 * Accept a specific change
 * @param {number} index - Change index
 */
function acceptChange(index) {
    reconcileState.reviewedChanges.set(index, 'accepted');
    closeChangePopup();
    navigateChange(1); // Move to next
    updateProgressDisplay();
}

/**
 * Reject a specific change
 * @param {number} index - Change index  
 */
function rejectChange(index) {
    reconcileState.reviewedChanges.set(index, 'rejected');
    closeChangePopup();
    navigateChange(1); // Move to next
    updateProgressDisplay();
}

/**
 * Accept all changes
 */
function acceptAll() {
    reconcileState.reviewedChanges.forEach((_, index) => {
        reconcileState.reviewedChanges.set(index, 'accepted');
    });
    updateProgressDisplay();
}

/**
 * Reject all changes
 */
function rejectAll() {
    reconcileState.reviewedChanges.forEach((_, index) => {
        reconcileState.reviewedChanges.set(index, 'rejected');
    });
    updateProgressDisplay();
}

/**
 * Update progress display
 */
function updateProgressDisplay() {
    const progressEl = document.getElementById('reconcile-progress');
    if (progressEl) {
        const total = reconcileState.importedPatches.length;
        const accepted = [...reconcileState.reviewedChanges.values()].filter(s => s === 'accepted').length;
        const rejected = [...reconcileState.reviewedChanges.values()].filter(s => s === 'rejected').length;
        const reviewed = accepted + rejected;

        progressEl.textContent = `${reviewed}/${total} reviewed (${accepted} accepted, ${rejected} rejected)`;
    }
}

/**
 * Apply accepted changes to the document
 */
async function applyAcceptedChanges() {
    // Accepted changes are already in the history database
    // We just need to reload the timeline to show them
    alert("Changes have been reconciled! Refresh the timeline to see all changes.");

    // Trigger timeline refresh
    window.dispatchEvent(new CustomEvent('reconciliation-complete'));
}

/**
 * Check if reconciliation is active
 * @returns {boolean}
 */
export function isReconcileActive() {
    return reconcileState.active;
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (!reconcileState.active) return;

    if (e.key === 'ArrowLeft') {
        navigateChange(-1);
    } else if (e.key === 'ArrowRight') {
        navigateChange(1);
    }
});
