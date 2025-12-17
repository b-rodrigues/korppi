// src/document-manager.js
// Frontend service for managing multiple documents

import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { getCachedProfile } from "./profile-service.js";

let activeDocumentId = null;
let openDocuments = new Map();
let documentChangeListeners = [];

/**
 * Create a Save patch if content has changed from last save
 * @param {string} docId - Document ID
 * @param {string} content - Current editor content
 * @returns {Promise<boolean>} True if patch was created
 */
async function createSavePatchIfChanged(docId, content) {
    if (!content) return false;

    try {
        const patches = await invoke("list_document_patches", { id: docId }).catch(() => []);
        const lastSavePatch = patches
            .filter(p => p.kind === "Save" && p.data?.snapshot)
            .sort((a, b) => b.timestamp - a.timestamp)[0];

        if (!lastSavePatch || lastSavePatch.data.snapshot !== content) {
            const profile = getCachedProfile();
            const patch = {
                timestamp: Date.now(),
                author: profile?.id || "local",
                kind: "Save",
                data: {
                    snapshot: content,
                    authorName: profile?.name || "Local User",
                    authorColor: profile?.color || "#3498db"
                }
            };
            await invoke("record_document_patch", { id: docId, patch });
            return true;
        }
    } catch (err) {
        console.error("Failed to create save patch:", err);
    }
    return false;
}

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
 * For DOCX/ODT, checks if pandoc is available and prompts if not
 * @param {string|null} path - Optional file path
 * @returns {Promise<Object>} Import result with handle and content
 */
export async function importDocument(path = null) {
    const result = await invoke("import_document", { path });

    // Check if this was a DOCX or ODT file and if pandoc was used
    const format = result.source_format?.toLowerCase() || "";
    const needsPandoc = format === "docx" || format === "odt";

    if (needsPandoc) {
        // Check if pandoc is available
        const hasPandoc = await invoke("check_pandoc_available");

        if (!hasPandoc) {
            // Show a warning that pandoc isn't installed
            const message = `⚠️ Pandoc not found\n\n` +
                `For better formatting (bold, italic, headings, lists, tables), install Pandoc.\n\n` +
                `The document was imported with basic text extraction only.\n` +
                `Restart the app after installing Pandoc for full formatting support.\n\n` +
                `Click OK to open the Pandoc installation page.`;

            if (confirm(message)) {
                // Open the pandoc installation page in the default browser
                await invoke("open_url", { url: "https://pandoc.org/installing.html" });
            }
        }
    }

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

    // Capture editor content as markdown before saving (preserves formatting)
    let editorContent = "";
    try {
        // Get content from editor as markdown to preserve formatting
        const { getMarkdown } = await import("./editor.js");
        editorContent = getMarkdown();
    } catch (err) {
        console.warn("Could not get editor content:", err);
    }

    // Record a patch with the saved content BEFORE saving the file
    // so the patch is included in the bundled history.sqlite
    await createSavePatchIfChanged(docId, editorContent);

    // Save the document (bundles the history.sqlite with the patch we just recorded)
    const handle = await invoke("save_document", { id: docId, path });
    openDocuments.set(handle.id, handle);

    notifyListeners("save", handle);
    return handle;
}

/**
 * Save As - prompts for a new file location and saves a copy
 * @param {string|null} id - Document ID (uses active if null)
 * @returns {Promise<Object>} The updated document handle
 */
export async function saveDocumentAs(id = null) {
    const docId = id || activeDocumentId;
    if (!docId) {
        throw new Error("No document to save");
    }

    // Get current document title for default filename
    const doc = openDocuments.get(docId);
    const defaultName = doc?.title || "document";

    // Show save dialog
    const path = await save({
        filters: [{ name: "Korppi Document", extensions: ["kmd"] }],
        defaultPath: `${defaultName}.kmd`
    });

    if (!path) {
        throw new Error("Save cancelled");
    }

    // Use existing saveDocument with the new path
    return await saveDocument(docId, path);
}

/**
 * Close a document
 * @param {string} id - Document ID
 * @param {boolean} force - Force close without save prompt
 * @returns {Promise<boolean>} True if closed, false if cancelled
 */
export async function closeDocument(id, force = false) {
    // Auto-create a Save patch before closing to preserve changes for reconciliation
    try {
        const { getMarkdown } = await import("./editor.js");
        await createSavePatchIfChanged(id, getMarkdown());
    } catch (err) {
        console.warn("Could not create auto-save patch on close:", err);
    }

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
