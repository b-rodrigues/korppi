// src/collaboration-service.js
// Service for email-based collaboration via patch bundles

import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";

/**
 * Export changes as a patch bundle for sharing via email
 * @param {string|null} collaboratorId - Optional ID of the collaborator to share with
 * @returns {Promise<{path: string, patchCount: number, bundleId: string, message: string}|null>}
 */
export async function shareChanges(collaboratorId = null) {
    // Get pending changes count first
    const pendingCount = await getPendingChangesCount(null, collaboratorId);
    
    if (pendingCount === 0) {
        return { success: false, message: "No new changes to share" };
    }
    
    // Show save dialog
    const path = await save({
        filters: [{ name: 'Korppi Patch Bundle', extensions: ['kmd-patch'] }],
        defaultPath: `changes-${new Date().toISOString().slice(0,10)}.kmd-patch`
    });
    
    if (!path) return null;
    
    const result = await invoke("export_patch_bundle", { 
        path,
        sincePatchId: null,  // Will use last_sent from sync state
        collaboratorId
    });
    
    return result;
}

/**
 * Open file dialog to select a patch bundle for import
 * @returns {Promise<{path: string, preview: BundlePreview}|null>}
 */
export async function selectPatchBundle() {
    const path = await open({
        filters: [{ name: 'Korppi Patch Bundle', extensions: ['kmd-patch'] }],
        multiple: false
    });
    
    if (!path) return null;
    
    // Preview the bundle first
    const preview = await invoke("preview_patch_bundle", { path });
    
    return { path, preview };
}

/**
 * Preview a patch bundle without importing
 * @param {string} path - Path to the patch bundle file
 * @returns {Promise<BundlePreview>}
 */
export async function previewPatchBundle(path) {
    return await invoke("preview_patch_bundle", { path });
}

/**
 * Import a patch bundle from a collaborator
 * @param {string} path - Path to the patch bundle file
 * @returns {Promise<ImportResult>}
 */
export async function importChanges(path) {
    const result = await invoke("import_patch_bundle", { path });
    return result;
}

/**
 * Get sync status for current document
 * @param {string|null} documentId - Optional document ID
 * @returns {Promise<{syncState: SyncState[], pendingCount: number}>}
 */
export async function getSyncStatus(documentId = null) {
    const syncState = await invoke("get_sync_state", { documentId });
    const pendingCount = await invoke("get_pending_changes_count", { 
        documentId,
        collaboratorId: null 
    });
    
    return { syncState, pendingCount };
}

/**
 * Get count of pending changes since last sync
 * @param {string|null} documentId - Optional document ID
 * @param {string|null} collaboratorId - Optional collaborator ID
 * @returns {Promise<number>}
 */
export async function getPendingChangesCount(documentId = null, collaboratorId = null) {
    return await invoke("get_pending_changes_count", { 
        documentId,
        collaboratorId 
    });
}

/**
 * Get sync state for a document
 * @param {string|null} documentId - Optional document ID
 * @returns {Promise<SyncState[]>}
 */
export async function getSyncState(documentId = null) {
    return await invoke("get_sync_state", { documentId });
}

/**
 * Format a timestamp for display
 * @param {number} timestamp - Unix timestamp in milliseconds
 * @returns {string}
 */
export function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString();
}

/**
 * Format a date range for display
 * @param {[number, number]} range - Start and end timestamps
 * @returns {string}
 */
export function formatDateRange(range) {
    if (!range) return "No dates";
    const [start, end] = range;
    const startDate = new Date(start);
    const endDate = new Date(end);
    
    if (startDate.toDateString() === endDate.toDateString()) {
        return startDate.toLocaleDateString();
    }
    
    return `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`;
}

/**
 * @typedef {Object} AuthorInfo
 * @property {string} id
 * @property {string} name
 * @property {string|null} email
 */

/**
 * @typedef {Object} BundlePreview
 * @property {AuthorInfo} author
 * @property {string} documentId
 * @property {string} documentTitle
 * @property {number} patchCount
 * @property {[number, number]|null} dateRange
 * @property {number} potentialConflicts
 * @property {boolean} isSameDocument
 */

/**
 * @typedef {Object} ImportResult
 * @property {boolean} success
 * @property {number} patchesImported
 * @property {number} conflictsDetected
 * @property {AuthorInfo} author
 * @property {string} documentTitle
 * @property {string} message
 */

/**
 * @typedef {Object} SyncState
 * @property {string} collaboratorId
 * @property {string} collaboratorName
 * @property {string|null} lastSent
 * @property {string|null} lastReceived
 * @property {number|null} lastSentPatchId
 * @property {number|null} lastReceivedPatchId
 */
