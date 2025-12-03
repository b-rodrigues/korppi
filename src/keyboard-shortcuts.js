// src/keyboard-shortcuts.js
// Keyboard shortcuts for document operations

import { 
    newDocument, 
    openDocument, 
    saveDocument, 
    closeDocument,
    getActiveDocumentId 
} from "./document-manager.js";
import { switchToNextTab, switchToPreviousTab } from "./document-tabs.js";
import { confirm } from "@tauri-apps/plugin-dialog";

/**
 * Initialize keyboard shortcuts
 */
export function initKeyboardShortcuts() {
    document.addEventListener("keydown", handleKeyDown);
}

/**
 * Handle keydown events for shortcuts
 * @param {KeyboardEvent} e - Keyboard event
 */
async function handleKeyDown(e) {
    // Check for Ctrl (Windows/Linux) or Cmd (Mac)
    const isMod = e.ctrlKey || e.metaKey;
    
    if (!isMod) return;
    
    switch (e.key.toLowerCase()) {
        case "n":
            // Ctrl/Cmd + N: New document
            e.preventDefault();
            try {
                await newDocument();
            } catch (err) {
                console.error("Failed to create new document:", err);
            }
            break;
            
        case "o":
            // Ctrl/Cmd + O: Open document
            e.preventDefault();
            try {
                await openDocument();
            } catch (err) {
                if (!err.toString().includes("No file selected")) {
                    console.error("Failed to open document:", err);
                }
            }
            break;
            
        case "s":
            // Ctrl/Cmd + S: Save document
            // Ctrl/Cmd + Shift + S: Save As
            e.preventDefault();
            try {
                const activeId = getActiveDocumentId();
                if (!activeId) {
                    console.warn("No active document to save");
                    return;
                }
                
                if (e.shiftKey) {
                    // Save As - pass null to trigger the save dialog
                    // For a true "Save As", we need to pass a special indicator
                    // Currently this behaves same as Save for unsaved documents
                    await saveDocument(activeId, null);
                } else {
                    // Regular save
                    await saveDocument(activeId);
                }
            } catch (err) {
                if (!err.toString().includes("cancelled")) {
                    console.error("Failed to save document:", err);
                }
            }
            break;
            
        case "w":
            // Ctrl/Cmd + W: Close document
            e.preventDefault();
            try {
                const activeId = getActiveDocumentId();
                if (!activeId) {
                    console.warn("No active document to close");
                    return;
                }
                
                // Try to close, will return false if unsaved changes
                const closed = await closeDocument(activeId, false);
                if (!closed) {
                    // Ask user what to do
                    const { getOpenDocuments } = await import("./document-manager.js");
                    const docs = getOpenDocuments();
                    const doc = docs.get(activeId);
                    
                    const result = await confirm(
                        `Save changes to "${doc?.title || 'Untitled'}" before closing?`,
                        {
                            title: "Unsaved Changes",
                            kind: "warning",
                        }
                    );
                    
                    if (result) {
                        // Save then close
                        await saveDocument(activeId);
                    }
                    // Close regardless (force)
                    await closeDocument(activeId, true);
                }
            } catch (err) {
                console.error("Failed to close document:", err);
            }
            break;
            
        case "tab":
            // Ctrl/Cmd + Tab: Switch to next tab
            // Ctrl/Cmd + Shift + Tab: Switch to previous tab
            e.preventDefault();
            if (e.shiftKey) {
                switchToPreviousTab();
            } else {
                switchToNextTab();
            }
            break;
    }
}

/**
 * Remove keyboard shortcut listeners
 */
export function destroyKeyboardShortcuts() {
    document.removeEventListener("keydown", handleKeyDown);
}
