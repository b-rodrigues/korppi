import { initEditor } from "./editor.js";
import { fetchPatchList, fetchPatch, renderPatchList, renderPatchDetails } from "./timeline.js";
import { initConflictUI } from "./conflict-ui.js";

// Global error handler to catch load errors
// Global error handler removed
// alert removed
import { initProfileSettings } from "./profile-settings.js";
import { exportAsMarkdown } from "./kmd-service.js";
import { forceSave } from "./yjs-setup.js";
import {
    initDocumentManager,
    newDocument,
    openDocument,
    saveDocument,
    getRecentDocuments,
    clearRecentDocuments,
    getOpenDocuments,
    onDocumentChange
} from "./document-manager.js";
import { initDocumentTabs } from "./document-tabs.js";
import { initKeyboardShortcuts } from "./keyboard-shortcuts.js";
import { initCollaborationUI, refreshPendingBadge } from "./collaboration-ui.js";

// Store the current markdown content
let currentMarkdown = "";

// Listen for markdown updates from the editor
window.addEventListener("markdown-updated", (event) => {
    currentMarkdown = event.detail.markdown || "";
    console.log("Main: markdown-updated, length=" + currentMarkdown.length);
});

/**
 * Show recent documents panel
 */
async function showRecentDocuments() {
    const recentPanel = document.getElementById("recent-documents");
    const recentList = document.getElementById("recent-list");
    const editor = document.getElementById("editor");

    if (!recentPanel || !recentList) return;

    try {
        const recent = await getRecentDocuments();
        recentList.innerHTML = "";

        if (recent.length === 0) {
            recentList.innerHTML = '<li class="empty-message">No recent documents</li>';
        } else {
            for (const doc of recent) {
                const li = document.createElement("li");
                li.innerHTML = `
                    <div>
                        <span class="doc-title">${doc.title}</span>
                        <span class="doc-path">${doc.path}</span>
                    </div>
                    <span class="doc-date">${new Date(doc.last_opened).toLocaleDateString()}</span>
                `;
                li.addEventListener("click", async () => {
                    try {
                        await openDocument(doc.path);
                        hideRecentDocuments();
                    } catch (err) {
                        console.error("Failed to open recent document:", err);
                        alert("Failed to open document: " + err);
                    }
                });
                recentList.appendChild(li);
            }
        }

        recentPanel.style.display = "block";
        if (editor) editor.style.display = "none";
    } catch (err) {
        console.error("Failed to load recent documents:", err);
    }
}

/**
 * Hide recent documents panel
 */
function hideRecentDocuments() {
    const recentPanel = document.getElementById("recent-documents");
    const editor = document.getElementById("editor");

    if (recentPanel) recentPanel.style.display = "none";
    if (editor) editor.style.display = "block";
}

/**
 * Update UI based on open documents
 */
function updateDocumentUI() {
    const docs = getOpenDocuments();
    if (docs.size === 0) {
        showRecentDocuments();
    } else {
        hideRecentDocuments();
    }
}

window.addEventListener("DOMContentLoaded", async () => {

    // 1. Initialize Main App Buttons (New, Open, Save, Export)
    // We do this FIRST so they are clickable immediately.
    const newDocBtn = document.getElementById("new-doc-btn");
    const openDocBtn = document.getElementById("open-doc-btn");
    const saveDocBtn = document.getElementById("save-doc-btn");
    const exportMdBtn = document.getElementById("export-md-btn");

    if (newDocBtn) {
        newDocBtn.addEventListener("click", async () => {
            try {
                await newDocument();
            } catch (err) {
                console.error("Failed to create new document:", err);
            }
        });
    }

    if (openDocBtn) {
        openDocBtn.addEventListener("click", async () => {
            try {
                await openDocument();
            } catch (err) {
                if (!err.toString().includes("No file selected")) {
                    console.error("Failed to open document:", err);
                }
            }
        });
    }

    if (saveDocBtn) {
        saveDocBtn.addEventListener("click", async () => {
            try {
                await forceSave();
                await saveDocument();
            } catch (err) {
                if (!err.toString().includes("cancelled")) {
                    console.error("Failed to save document:", err);
                }
            }
        });
    }

    if (exportMdBtn) {
        exportMdBtn.addEventListener("click", async () => {
            try {
                const path = await exportAsMarkdown(currentMarkdown);
                if (path) {
                    console.log("Exported Markdown to:", path);
                }
            } catch (err) {
                console.error("Markdown export failed:", err);
                alert("Markdown export failed: " + err);
            }
        });
    }

    // 2. Initialize UI Components
    initProfileSettings();
    initConflictUI();
    initKeyboardShortcuts();
    initDocumentTabs();
    initCollaborationUI();

    // 3. Initialize Recent Documents Panel Buttons
    const newDocumentBtn = document.getElementById("new-document-btn");
    const openDocumentBtn = document.getElementById("open-document-btn");
    const clearRecentBtn = document.getElementById("clear-recent-btn");

    if (newDocumentBtn) {
        newDocumentBtn.addEventListener("click", async () => {
            try {
                await newDocument();
            } catch (err) {
                console.error("Failed to create new document:", err);
            }
        });
    }

    if (openDocumentBtn) {
        openDocumentBtn.addEventListener("click", async () => {
            try {
                await openDocument();
            } catch (err) {
                if (!err.toString().includes("No file selected")) {
                    console.error("Failed to open document:", err);
                }
            }
        });
    }

    if (clearRecentBtn) {
        clearRecentBtn.addEventListener("click", async () => {
            try {
                await clearRecentDocuments();
                await showRecentDocuments();
            } catch (err) {
                console.error("Failed to clear recent documents:", err);
            }
        });
    }

    // 4. Initialize Timeline
    const toggle = document.getElementById("timeline-toggle");
    const container = document.getElementById("timeline-container");
    const list = document.getElementById("timeline-list");

    if (toggle && container && list) {
        toggle.addEventListener("click", async () => {
            if (container.style.display === "none") {
                container.style.display = "block";
                const patches = await fetchPatchList();
                renderPatchList(patches);
            } else {
                container.style.display = "none";
            }
        });

        list.addEventListener("click", async (event) => {
            const item = event.target.closest(".timeline-item");
            if (!item) return;

            const id = parseInt(item.dataset.id);
            const patch = await fetchPatch(id);
            if (patch) renderPatchDetails(patch);
        });
    }

    // 5. Initialize Document Manager (Async - might block/fail)
    try {
        console.log("Initializing document manager...");
        await initDocumentManager();
        console.log("Document manager initialized");
        updateDocumentUI();
    } catch (err) {
        console.error("Failed to initialize document manager:", err);
        alert("Failed to init doc manager: " + err);
        showRecentDocuments();
    }

    // Listen for document changes
    onDocumentChange((event, doc) => {
        updateDocumentUI();
        refreshPendingBadge();
    });

    // 6. Initialize Editor (Last step to avoid blocking UI)
    try {
        console.log("Initializing editor...");
        await initEditor();
        console.log("Editor initialized");
    } catch (err) {
        console.error("Failed to initialize editor:", err);
    }
});
