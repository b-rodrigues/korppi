// src/yjs-setup.js
import * as Y from "yjs";
import { invoke } from "@tauri-apps/api/core";
import { 
    getActiveDocumentId,
    updateDocumentState,
    getDocumentState,
    markDocumentModified,
    onDocumentChange
} from "./document-manager.js";

export const ydoc = new Y.Doc();
export const yXmlFragment = ydoc.getXmlFragment("prosemirror");

let isApplyingFromDisk = false;
let saveTimeout = null;
let currentDocId = null;

/**
 * Load the Yjs document state for a specific document
 * @param {string} docId - Document ID (optional, uses active if not provided)
 */
export async function loadDocumentState(docId = null) {
    const id = docId || getActiveDocumentId();
    if (!id) {
        // Fall back to legacy single-document mode
        return loadInitialDoc();
    }
    
    currentDocId = id;
    isApplyingFromDisk = true;
    
    try {
        const state = await getDocumentState(id);
        if (state && state.length > 0) {
            Y.applyUpdate(ydoc, state);
        }
    } catch (err) {
        console.warn("Failed to load document state, starting fresh:", err);
    } finally {
        isApplyingFromDisk = false;
    }
}

/**
 * Legacy: Load initial document from the old single-document store
 */
export async function loadInitialDoc() {
    const update = await invoke("load_doc").catch(() => []);
    if (update && update.length > 0) {
        Y.applyUpdate(ydoc, new Uint8Array(update));
    }
}

/**
 * Save the current Yjs state
 */
async function saveCurrentState() {
    if (isApplyingFromDisk) return;
    
    const fullState = Y.encodeStateAsUpdate(ydoc);
    
    // If we have an active document in the manager, save to it
    const docId = currentDocId || getActiveDocumentId();
    if (docId) {
        try {
            await updateDocumentState(docId, fullState);
        } catch (err) {
            console.error("Failed to save document state:", err);
        }
    } else {
        // Fall back to legacy single-document store
        try {
            await invoke("store_update", { fullState: Array.from(fullState) });
        } catch (err) {
            console.error("Failed to store update:", err);
        }
    }
}

// Debounced save to avoid hammering the filesystem
function debouncedSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    
    saveTimeout = setTimeout(async () => {
        await saveCurrentState();
    }, 300); // 300ms debounce
}

export function enablePersistence() {
    ydoc.on("update", () => {
        if (isApplyingFromDisk) return;
        debouncedSave();
        
        // Mark the current document as modified
        const docId = currentDocId || getActiveDocumentId();
        if (docId) {
            markDocumentModified(docId, true).catch(() => {});
        }
    });
}

export function beginApplyingDiskUpdates() {
    isApplyingFromDisk = true;
}

export function endApplyingDiskUpdates() {
    isApplyingFromDisk = false;
}

// Force immediate save (for beforeunload, etc.)
export async function forceSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    await saveCurrentState();
}

/**
 * Reset the Yjs document for a new/different document
 */
export function resetDocument() {
    isApplyingFromDisk = true;
    // Clear the existing content
    const fragment = ydoc.getXmlFragment("prosemirror");
    if (fragment.length > 0) {
        fragment.delete(0, fragment.length);
    }
    isApplyingFromDisk = false;
}

/**
 * Switch to a different document
 * @param {string} docId - Document ID to switch to
 */
export async function switchDocument(docId) {
    // Save current state first
    await forceSave();
    
    // Reset and load new document
    resetDocument();
    await loadDocumentState(docId);
}
