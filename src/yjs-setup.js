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

export let ydoc = new Y.Doc();
export let yXmlFragment = ydoc.getXmlFragment("prosemirror");

let applyingCounter = 0;
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
    applyingCounter++;

    try {
        const state = await getDocumentState(id);
        if (state && state.length > 0) {
            Y.applyUpdate(ydoc, state);
        } else {
            // console.log("YJS: Loaded state is empty");
        }
    } catch (err) {
        console.warn("Failed to load document state, starting fresh:", err);
    } finally {
        applyingCounter--;
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
    // alert("saveCurrentState called. applyingCounter=" + applyingCounter);
    if (applyingCounter > 0) {
        return;
    }

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
        if (applyingCounter > 0) return;
        debouncedSave();

        // Mark the current document as modified
        const docId = currentDocId || getActiveDocumentId();
        if (docId) {
            markDocumentModified(docId, true).catch(() => { });
        }
    });
}

export function beginApplyingDiskUpdates() {
    applyingCounter++;
}

export function endApplyingDiskUpdates() {
    applyingCounter--;
}

// Force immediate save (for beforeunload, etc.)
export async function forceSave() {
    if (saveTimeout) clearTimeout(saveTimeout);
    await saveCurrentState();
}

/**
 * Completely replace the Yjs document with a fresh one.
 * This avoids history merge issues when switching documents.
 */
export function resetYDoc() {
    if (ydoc) {
        ydoc.destroy();
    }

    ydoc = new Y.Doc();
    yXmlFragment = ydoc.getXmlFragment("prosemirror");

    // Re-enable persistence on the new doc
    enablePersistence();

    // Notify the editor to rebind plugins
    window.dispatchEvent(new CustomEvent('yjs-doc-replaced'));
}

/**
 * Switch to a different document
 * @param {string} docId - Document ID to switch to
 */
export async function switchDocument(docId) {
    // Save current state first
    await forceSave();

    // Replace the Yjs document entirely
    resetYDoc();

    // Load new document state into the fresh doc
    await loadDocumentState(docId);
}

/**
 * Restore the document state from a text snapshot.
 * This replaces the current Yjs document content with the provided text.
 * @param {string} textContent - The text content to restore
 */
export function restoreDocumentState(textContent) {
    if (!textContent || typeof textContent !== 'string') {
        console.warn("restoreDocumentState: No valid text content provided");
        return false;
    }

    applyingCounter++;

    try {
        // Get the XML fragment and clear it
        const xmlFragment = ydoc.getXmlFragment("prosemirror");
        
        // Use a transaction to make the change atomic
        ydoc.transact(() => {
            // Delete all existing content
            while (xmlFragment.length > 0) {
                xmlFragment.delete(0, 1);
            }

            // Create a paragraph node with the restored text
            // Split by newlines to create separate paragraphs
            const paragraphs = textContent.split('\n');
            
            for (const para of paragraphs) {
                const paragraph = new Y.XmlElement('paragraph');
                const textNode = new Y.XmlText();
                textNode.insert(0, para);
                paragraph.insert(0, [textNode]);
                xmlFragment.push([paragraph]);
            }
        });

        // Mark the document as modified
        const docId = currentDocId || getActiveDocumentId();
        if (docId) {
            markDocumentModified(docId, true).catch(() => { });
        }

        // Notify the editor that content was restored
        window.dispatchEvent(new CustomEvent('yjs-content-restored'));

        return true;
    } catch (err) {
        console.error("Failed to restore document state:", err);
        return false;
    } finally {
        applyingCounter--;
    }
}
