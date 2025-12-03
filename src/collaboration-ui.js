// src/collaboration-ui.js
// UI handling for email-based collaboration

import {
    shareChanges,
    selectPatchBundle,
    importChanges,
    getPendingChangesCount,
    getSyncStatus,
    formatDateRange
} from "./collaboration-service.js";

let currentBundlePath = null;
let currentPreview = null;

/**
 * Initialize collaboration UI
 */
export function initCollaborationUI() {
    // Share button
    const shareBtn = document.getElementById("share-changes-btn");
    const importBtn = document.getElementById("import-changes-btn");
    
    if (shareBtn) {
        shareBtn.addEventListener("click", openShareModal);
    }
    
    if (importBtn) {
        importBtn.addEventListener("click", openImportModal);
    }
    
    // Share modal
    const shareModal = document.getElementById("share-modal");
    const shareModalClose = document.getElementById("share-modal-close");
    const cancelShareBtn = document.getElementById("cancel-share-btn");
    const exportBundleBtn = document.getElementById("export-bundle-btn");
    
    if (shareModalClose) {
        shareModalClose.addEventListener("click", closeShareModal);
    }
    
    if (cancelShareBtn) {
        cancelShareBtn.addEventListener("click", closeShareModal);
    }
    
    if (exportBundleBtn) {
        exportBundleBtn.addEventListener("click", handleExportBundle);
    }
    
    if (shareModal) {
        shareModal.addEventListener("click", (e) => {
            if (e.target === shareModal) closeShareModal();
        });
    }
    
    // Import modal
    const importModal = document.getElementById("import-modal");
    const importModalClose = document.getElementById("import-modal-close");
    const cancelImportBtn = document.getElementById("cancel-import-btn");
    const selectBundleBtn = document.getElementById("select-bundle-btn");
    const confirmImportBtn = document.getElementById("confirm-import-btn");
    
    if (importModalClose) {
        importModalClose.addEventListener("click", closeImportModal);
    }
    
    if (cancelImportBtn) {
        cancelImportBtn.addEventListener("click", closeImportModal);
    }
    
    if (selectBundleBtn) {
        selectBundleBtn.addEventListener("click", handleSelectBundle);
    }
    
    if (confirmImportBtn) {
        confirmImportBtn.addEventListener("click", handleConfirmImport);
    }
    
    if (importModal) {
        importModal.addEventListener("click", (e) => {
            if (e.target === importModal) closeImportModal();
        });
    }
    
    // Start periodic badge update
    updatePendingBadge();
    setInterval(updatePendingBadge, 30000); // Every 30 seconds
}

/**
 * Update the pending changes badge
 */
async function updatePendingBadge() {
    const badge = document.getElementById("pending-changes-badge");
    if (!badge) return;
    
    try {
        const count = await getPendingChangesCount();
        
        if (count > 0) {
            badge.textContent = count > 99 ? "99+" : count.toString();
            badge.classList.remove("hidden");
        } else {
            badge.classList.add("hidden");
        }
    } catch (err) {
        // Silently fail - document might not be open
        badge.classList.add("hidden");
    }
}

/**
 * Open the share changes modal
 */
async function openShareModal() {
    const modal = document.getElementById("share-modal");
    const summary = document.getElementById("share-changes-summary");
    const collaboratorSelect = document.getElementById("collaborator-select");
    const collaboratorsList = document.getElementById("share-collaborators");
    
    if (!modal) return;
    
    // Reset state
    summary.textContent = "Calculating changes...";
    collaboratorSelect.innerHTML = '<option value="">New collaborator...</option>';
    collaboratorsList.innerHTML = "";
    
    modal.style.display = "flex";
    
    try {
        const status = await getSyncStatus();
        const count = status.pendingCount;
        
        if (count === 0) {
            summary.textContent = "No new changes to share";
        } else {
            summary.textContent = `${count} change${count !== 1 ? 's' : ''} ready to share`;
        }
        
        // Populate collaborators
        if (status.syncState && status.syncState.length > 0) {
            status.syncState.forEach(collab => {
                // Add to select
                const option = document.createElement("option");
                option.value = collab.collaborator_id;
                option.textContent = collab.collaborator_name;
                collaboratorSelect.appendChild(option);
                
                // Add to list (using safe DOM manipulation to prevent XSS)
                const item = document.createElement("div");
                item.className = "collaborator-item";
                
                const nameSpan = document.createElement("span");
                nameSpan.className = "name";
                nameSpan.textContent = collab.collaborator_name;
                
                const lastSent = collab.last_sent 
                    ? new Date(collab.last_sent).toLocaleDateString()
                    : "Never";
                
                const syncSpan = document.createElement("span");
                syncSpan.className = "last-sync";
                syncSpan.textContent = `Last shared: ${lastSent}`;
                
                item.appendChild(nameSpan);
                item.appendChild(syncSpan);
                collaboratorsList.appendChild(item);
            });
        }
    } catch (err) {
        summary.textContent = "Error calculating changes";
        console.error("Failed to get sync status:", err);
    }
}

/**
 * Close the share changes modal
 */
function closeShareModal() {
    const modal = document.getElementById("share-modal");
    if (modal) modal.style.display = "none";
}

/**
 * Handle export bundle button click
 */
async function handleExportBundle() {
    const collaboratorSelect = document.getElementById("collaborator-select");
    const collaboratorId = collaboratorSelect?.value || null;
    
    try {
        const result = await shareChanges(collaboratorId);
        
        if (result === null) {
            // User cancelled
            return;
        }
        
        if (!result.success) {
            alert(result.message);
            return;
        }
        
        closeShareModal();
        alert(`✅ ${result.message}\n\nSaved to: ${result.path}`);
        updatePendingBadge();
    } catch (err) {
        console.error("Failed to export patch bundle:", err);
        alert("Failed to export patch bundle: " + err);
    }
}

/**
 * Open the import changes modal
 */
function openImportModal() {
    const modal = document.getElementById("import-modal");
    if (!modal) return;
    
    // Reset state
    currentBundlePath = null;
    currentPreview = null;
    
    document.getElementById("import-instructions").style.display = "block";
    document.getElementById("import-preview").style.display = "none";
    document.getElementById("import-conflicts").style.display = "none";
    document.getElementById("import-doc-mismatch").style.display = "none";
    document.getElementById("confirm-import-btn").style.display = "none";
    
    modal.style.display = "flex";
}

/**
 * Close the import changes modal
 */
function closeImportModal() {
    const modal = document.getElementById("import-modal");
    if (modal) modal.style.display = "none";
    
    currentBundlePath = null;
    currentPreview = null;
}

/**
 * Handle select bundle button click
 */
async function handleSelectBundle() {
    try {
        const result = await selectPatchBundle();
        
        if (!result) {
            // User cancelled
            return;
        }
        
        currentBundlePath = result.path;
        currentPreview = result.preview;
        
        // Show preview
        document.getElementById("import-instructions").style.display = "none";
        document.getElementById("import-preview").style.display = "block";
        document.getElementById("confirm-import-btn").style.display = "inline-block";
        
        // Populate preview fields
        const authorName = currentPreview.author?.name || "Unknown";
        const authorEmail = currentPreview.author?.email;
        const authorDisplay = authorEmail 
            ? `${authorName} (${authorEmail})`
            : authorName;
        
        document.getElementById("import-author").textContent = authorDisplay;
        document.getElementById("import-doc-title").textContent = currentPreview.document_title || "Untitled";
        document.getElementById("import-count").textContent = `${currentPreview.patch_count} change${currentPreview.patch_count !== 1 ? 's' : ''}`;
        document.getElementById("import-dates").textContent = formatDateRange(currentPreview.date_range);
        
        // Show conflict warning if applicable
        if (currentPreview.potential_conflicts > 0) {
            document.getElementById("import-conflicts").style.display = "block";
            document.getElementById("conflict-count").textContent = currentPreview.potential_conflicts;
        } else {
            document.getElementById("import-conflicts").style.display = "none";
        }
        
        // Show document mismatch warning if applicable
        if (!currentPreview.is_same_document) {
            document.getElementById("import-doc-mismatch").style.display = "block";
        } else {
            document.getElementById("import-doc-mismatch").style.display = "none";
        }
    } catch (err) {
        console.error("Failed to preview patch bundle:", err);
        alert("Failed to open patch bundle: " + err);
    }
}

/**
 * Handle confirm import button click
 */
async function handleConfirmImport() {
    if (!currentBundlePath) {
        alert("No patch bundle selected");
        return;
    }
    
    try {
        const result = await importChanges(currentBundlePath);
        
        closeImportModal();
        
        if (result.conflicts_detected > 0) {
            alert(`✅ ${result.message}\n\n⚠️ ${result.conflicts_detected} potential conflicts detected. Please review your document.`);
        } else {
            alert(`✅ ${result.message}`);
        }
        
        updatePendingBadge();
        
        // Dispatch event to notify document manager to reload
        window.dispatchEvent(new CustomEvent("collaboration-import", { 
            detail: { result }
        }));
    } catch (err) {
        console.error("Failed to import patch bundle:", err);
        alert("Failed to import patch bundle: " + err);
    }
}

/**
 * Manually trigger badge update (call after document changes)
 */
export function refreshPendingBadge() {
    updatePendingBadge();
}
