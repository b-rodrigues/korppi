// src/document-tabs.js
// Manages the document tab UI

/**
 * @typedef {Object} DocumentHandle
 * @property {string} id - Unique document ID
 * @property {string|null} path - File path (null for unsaved documents)
 * @property {string} title - Document title
 * @property {boolean} is_modified - Whether document has unsaved changes
 * @property {number} opened_at - Timestamp when document was opened
 */

import { 
    getOpenDocuments, 
    getActiveDocumentId, 
    setActiveDocument, 
    closeDocument, 
    newDocument,
    onDocumentChange 
} from "./document-manager.js";
import { confirm } from "@tauri-apps/plugin-dialog";

let tabsContainer = null;

/**
 * Initialize the document tabs UI
 */
export function initDocumentTabs() {
    tabsContainer = document.getElementById("document-tabs");
    if (!tabsContainer) {
        console.error("Document tabs container not found");
        return;
    }
    
    // Listen for document changes
    onDocumentChange((event, document) => {
        switch (event) {
            case "new":
            case "open":
                addTab(document);
                break;
            case "close":
                removeTab(document?.id);
                break;
            case "save":
            case "modify":
            case "titleChange":
                if (document) {
                    updateTabTitle(document.id, document.title, document.is_modified);
                }
                break;
            case "activeChange":
                if (document) {
                    setActiveTab(document.id);
                }
                break;
        }
    });
    
    // Add new tab button
    const newTabBtn = document.createElement("button");
    newTabBtn.id = "new-tab-btn";
    newTabBtn.className = "new-tab-btn";
    newTabBtn.title = "New Document";
    newTabBtn.textContent = "+";
    newTabBtn.addEventListener("click", async () => {
        try {
            await newDocument();
        } catch (e) {
            console.error("Failed to create new document:", e);
        }
    });
    tabsContainer.appendChild(newTabBtn);
}

/**
 * Add a tab for a document
 * @param {Object} docHandle - Document handle
 */
export function addTab(docHandle) {
    if (!tabsContainer) return;
    
    // Check if tab already exists
    const existingTab = document.getElementById(`tab-${docHandle.id}`);
    if (existingTab) {
        setActiveTab(docHandle.id);
        return;
    }
    
    const tab = createTabElement(docHandle);
    
    // Insert before the new tab button
    const newTabBtn = document.getElementById("new-tab-btn");
    if (newTabBtn) {
        tabsContainer.insertBefore(tab, newTabBtn);
    } else {
        tabsContainer.appendChild(tab);
    }
    
    setActiveTab(docHandle.id);
}

/**
 * Create a tab element
 * @param {DocumentHandle} doc - Document handle
 * @returns {HTMLElement} Tab element
 */
function createTabElement(doc) {
    const tab = document.createElement("div");
    tab.id = `tab-${doc.id}`;
    tab.className = "document-tab";
    tab.dataset.documentId = doc.id;
    
    const title = document.createElement("span");
    title.className = "tab-title";
    title.textContent = doc.title;
    
    const modified = document.createElement("span");
    modified.className = "tab-modified";
    modified.textContent = "•";
    modified.style.display = doc.is_modified ? "inline" : "none";
    
    const closeBtn = document.createElement("span");
    closeBtn.className = "tab-close";
    closeBtn.textContent = "×";
    closeBtn.title = "Close";
    
    closeBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        await handleCloseTab(doc.id);
    });
    
    tab.addEventListener("click", () => {
        setActiveDocument(doc.id);
    });
    
    tab.appendChild(title);
    tab.appendChild(modified);
    tab.appendChild(closeBtn);
    
    return tab;
}

/**
 * Handle closing a tab with unsaved changes confirmation
 * @param {string} documentId - Document ID
 */
async function handleCloseTab(documentId) {
    const docs = getOpenDocuments();
    const doc = docs.get(documentId);
    
    if (doc && doc.is_modified) {
        const result = await confirm(
            `Save changes to "${doc.title}" before closing?`,
            {
                title: "Unsaved Changes",
                kind: "warning",
            }
        );
        
        if (result) {
            // User wants to save
            const { saveDocument } = await import("./document-manager.js");
            try {
                await saveDocument(documentId);
            } catch (e) {
                console.error("Failed to save document:", e);
                return; // Don't close if save failed
            }
        }
    }
    
    await closeDocument(documentId, true);
}

/**
 * Remove a tab
 * @param {string} documentId - Document ID
 */
export function removeTab(documentId) {
    if (!tabsContainer || !documentId) return;
    
    const tab = document.getElementById(`tab-${documentId}`);
    if (tab) {
        tab.remove();
    }
}

/**
 * Set the active tab
 * @param {string} documentId - Document ID
 */
export function setActiveTab(documentId) {
    if (!tabsContainer) return;
    
    // Remove active class from all tabs
    const tabs = tabsContainer.querySelectorAll(".document-tab");
    tabs.forEach(tab => tab.classList.remove("active"));
    
    // Add active class to the selected tab
    const activeTab = document.getElementById(`tab-${documentId}`);
    if (activeTab) {
        activeTab.classList.add("active");
    }
}

/**
 * Update a tab's title and modified state
 * @param {string} documentId - Document ID
 * @param {string} title - New title
 * @param {boolean} isModified - Whether document is modified
 */
export function updateTabTitle(documentId, title, isModified) {
    if (!tabsContainer) return;
    
    const tab = document.getElementById(`tab-${documentId}`);
    if (!tab) return;
    
    const titleEl = tab.querySelector(".tab-title");
    const modifiedEl = tab.querySelector(".tab-modified");
    
    if (titleEl) {
        titleEl.textContent = title;
    }
    
    if (modifiedEl) {
        modifiedEl.style.display = isModified ? "inline" : "none";
    }
}

/**
 * Get the next tab in order
 * @param {string} currentId - Current document ID
 * @returns {string|null} Next document ID or null
 */
export function getNextTabId(currentId) {
    if (!tabsContainer) return null;
    
    const tabs = tabsContainer.querySelectorAll(".document-tab");
    const tabArray = Array.from(tabs);
    const currentIndex = tabArray.findIndex(t => t.dataset.documentId === currentId);
    
    if (currentIndex === -1) return null;
    
    // Try next tab, then previous
    if (currentIndex < tabArray.length - 1) {
        return tabArray[currentIndex + 1].dataset.documentId;
    } else if (currentIndex > 0) {
        return tabArray[currentIndex - 1].dataset.documentId;
    }
    
    return null;
}

/**
 * Switch to the next tab (for Ctrl+Tab)
 */
export function switchToNextTab() {
    const activeId = getActiveDocumentId();
    if (!activeId || !tabsContainer) return;
    
    const tabs = tabsContainer.querySelectorAll(".document-tab");
    const tabArray = Array.from(tabs);
    const currentIndex = tabArray.findIndex(t => t.dataset.documentId === activeId);
    
    if (currentIndex === -1) return;
    
    const nextIndex = (currentIndex + 1) % tabArray.length;
    const nextId = tabArray[nextIndex].dataset.documentId;
    setActiveDocument(nextId);
}

/**
 * Switch to the previous tab (for Ctrl+Shift+Tab)
 */
export function switchToPreviousTab() {
    const activeId = getActiveDocumentId();
    if (!activeId || !tabsContainer) return;
    
    const tabs = tabsContainer.querySelectorAll(".document-tab");
    const tabArray = Array.from(tabs);
    const currentIndex = tabArray.findIndex(t => t.dataset.documentId === activeId);
    
    if (currentIndex === -1) return;
    
    const prevIndex = (currentIndex - 1 + tabArray.length) % tabArray.length;
    const prevId = tabArray[prevIndex].dataset.documentId;
    setActiveDocument(prevId);
}
