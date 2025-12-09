// src/document-manager.js
// Frontend service for managing multiple documents

import { invoke } from "@tauri-apps/api/core";
import { getCachedProfile } from "./profile-service.js";

let activeDocumentId = null;
let openDocuments = new Map();
let documentChangeListeners = [];

/**
 * Create a new empty document
 * @returns {Promise<Object>} The document handle
 */
export async function newDocument() {
    const handle = await invoke("new_document");
    openDocuments.set(handle.id, handle);
    setActiveDocument(handle.id);
    notifyListeners("new", handle);
    return handle;
}

/**
 * Open a document from file path (shows file picker if path is null)
 * @param {string|null} path - Optional file path
 * @returns {Promise<Object>} The document handle
 */
export async function openDocument(path = null) {
    const handle = await invoke("open_document", { path });
    openDocuments.set(handle.id, handle);
    setActiveDocument(handle.id);
    notifyListeners("open", handle);
    return handle;
}

/**
 * Import a document from various formats (markdown, docx, odt)
 * Shows file picker if path is null
 * @param {string|null} path - Optional file path
 * @returns {Promise<Object>} Import result with handle and content
 */
export async function importDocument(path = null) {
    const result = await invoke("import_document", { path });
    openDocuments.set(result.handle.id, result.handle);
    setActiveDocument(result.handle.id);
    notifyListeners("import", result.handle);
    return result;
}

/**
 * Save the active or specified document
 * @param {string|null} id - Document ID (uses active if null)
 * @param {string|null} path - Optional path for Save As
 * @returns {Promise<Object>} The updated document handle
 */
export async function saveDocument(id = null, path = null) {
    const docId = id || activeDocumentId;
    if (!docId) {
        throw new Error("No document to save");
    }

    // Capture editor content before saving
    let editorContent = "";
    try {
        // Get content from editor
        const { getEditorContent } = await import("./editor.js");
        editorContent = getEditorContent();
    } catch (err) {
        console.warn("Could not get editor content:", err);
    }

    // Record a patch with the saved content BEFORE saving the file
    // so the patch is included in the bundled history.sqlite
    if (editorContent) {
        try {
            // Check if content has changed from last save
            const patches = await invoke("list_document_patches", { id: docId }).catch(() => []);
            const lastSavePatch = patches
                .filter(p => p.kind === "Save" && p.data?.snapshot)
                .sort((a, b) => b.timestamp - a.timestamp)[0];

            // Only create a new patch if content has actually changed
            if (!lastSavePatch || lastSavePatch.data.snapshot !== editorContent) {
                const timestamp = Date.now();
                const profile = getCachedProfile();
                const author = profile?.id || "local";
                const authorName = profile?.name || "Local User";
                const authorColor = profile?.color || "#3498db";
                const patch = {
                    timestamp,
                    author,
                    kind: "Save",
                    data: {
                        snapshot: editorContent,
                        authorName,  // Store author name for display
                        authorColor  // Store author color for multi-author highlighting
                    }
                };
                await invoke("record_document_patch", { id: docId, patch });
            }
        } catch (err) {
            console.error("Failed to record save patch:", err);
        }
    }

    // Save the document (bundles the history.sqlite with the patch we just recorded)
    const handle = await invoke("save_document", { id: docId, path });
    openDocuments.set(handle.id, handle);

    notifyListeners("save", handle);
    return handle;
}

/**
 * Close a document
 * @param {string} id - Document ID
 * @param {boolean} force - Force close without save prompt
 * @returns {Promise<boolean>} True if closed, false if cancelled
 */
export async function closeDocument(id, force = false) {
    const result = await invoke("close_document", { id, force });
    if (result) {
        const handle = openDocuments.get(id);
        openDocuments.delete(id);
        notifyListeners("close", handle);

        // Switch to another document if this was active
        if (activeDocumentId === id) {
            const remaining = Array.from(openDocuments.keys());
            if (remaining.length > 0) {
                setActiveDocument(remaining[0]);
            } else {
                activeDocumentId = null;
                notifyListeners("activeChange", null);
            }
        }
    }
    return result;
}

/**
 * Get all open documents
 * @returns {Map} Map of document ID to handle
 */
export function getOpenDocuments() {
    return openDocuments;
}

/**
 * Get the active document ID
 * @returns {string|null} Active document ID
 */
export function getActiveDocumentId() {
    return activeDocumentId;
}

/**
 * Get the active document handle
 * @returns {Object|null} Active document handle
 */
export function getActiveDocument() {
    if (activeDocumentId) {
        return openDocuments.get(activeDocumentId);
    }
    return null;
}

/**
 * Set which document is currently active
 * @param {string} id - Document ID
 */
export function setActiveDocument(id) {
    if (!openDocuments.has(id)) {
        throw new Error(`Document not found: ${id}`);
    }
    activeDocumentId = id;
    invoke("set_active_document", { id }).catch(console.error);
    notifyListeners("activeChange", openDocuments.get(id));
}

/**
 * Check if active document has unsaved changes
 * @returns {boolean} True if document has unsaved changes
 */
export function hasUnsavedChanges() {
    const doc = getActiveDocument();
    return doc?.modified === true;
}

/**
 * Get recent documents list
 * @returns {Promise<Array>} List of recent documents
 */
export async function getRecentDocuments() {
    return await invoke("get_recent_documents");
}

/**
 * Clear recent documents list
 * @returns {Promise<void>}
 */
export async function clearRecentDocuments() {
    await invoke("clear_recent_documents");
}

/**
 * Get document Yjs state
 * @param {string} id - Document ID
 * @returns {Promise<Uint8Array>} Yjs state
 */
export async function getDocumentState(id) {
    const state = await invoke("get_document_state", { id });
    return new Uint8Array(state);
}

/**
 * Update document Yjs state
 * @param {string} id - Document ID
 * @param {Uint8Array} state - Yjs state
 * @returns {Promise<void>}
 */
export async function updateDocumentState(id, state) {
    await invoke("update_document_state", { id, state: Array.from(state) });
}

/**
 * Mark document as modified
 * @param {string} id - Document ID
 * @param {boolean} modified - Whether document is modified
 * @returns {Promise<void>}
 */
export async function markDocumentModified(id, modified = true) {
    await invoke("mark_document_modified", { id, modified });
    const handle = openDocuments.get(id);
    if (handle) {
        handle.is_modified = modified;
        notifyListeners("modify", handle);
    }
}

/**
 * Update document title
 * @param {string} id - Document ID
 * @param {string} title - New title
 * @returns {Promise<void>}
 */
export async function updateDocumentTitle(id, title) {
    await invoke("update_document_title", { id, title });
    const handle = openDocuments.get(id);
    if (handle) {
        handle.title = title;
        notifyListeners("titleChange", handle);
    }
}

/**
 * Check for file opened via command line
 * @returns {Promise<string|null>} File path or null
 */
export async function getInitialFile() {
    return await invoke("get_initial_file");
}

/**
 * Add a listener for document changes
 * @param {Function} listener - Callback function(event, document)
 * @returns {Function} Unsubscribe function
 */
export function onDocumentChange(listener) {
    documentChangeListeners.push(listener);
    return () => {
        const index = documentChangeListeners.indexOf(listener);
        if (index > -1) {
            documentChangeListeners.splice(index, 1);
        }
    };
}

/**
 * Notify all listeners of a document change
 * @param {string} event - Event type
 * @param {Object} document - Document handle
 */
function notifyListeners(event, document) {
    for (const listener of documentChangeListeners) {
        try {
            listener(event, document);
        } catch (e) {
            console.error("Document change listener error:", e);
        }
    }
}

/**
 * Initialize the document manager
 * Opens initial file from command line or creates new document
 * @returns {Promise<Object>} Initial document handle
 */
export async function initDocumentManager() {
    const initialFile = await getInitialFile();
    if (initialFile) {
        return await openDocument(initialFile);
    }
    return await newDocument();
}
