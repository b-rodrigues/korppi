import { initEditor, getMarkdown } from "./editor.js";
import { fetchPatchList, fetchPatch, renderPatchList, renderPatchDetails, initTimeline } from "./timeline.js";
import { initConflictUI } from "./conflict-ui.js";
import { exportAsMarkdown, exportAsDocx } from "./kmd-service.js";
import { forceSave } from "./yjs-setup.js";
import { startReconciliation } from "./reconcile.js";
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

// New UI components
import { initResizableSidebars } from "./components/resizable-sidebar.js";
import { initThemeToggle } from "./components/theme-toggle.js";
import { initProfileButton } from "./components/profile-button.js";
import { initFormattingToolbar } from "./components/formatting-toolbar.js";
import { initCommentsPanel, initEditorContextMenu } from "./comments-ui.js";
import { listComments } from "./comments-service.js";
import { initWelcomeModal } from "./components/welcome-modal.js";

// Store the current markdown content
let currentMarkdown = "";

// Listen for markdown updates from the editor
window.addEventListener("markdown-updated", (event) => {
    currentMarkdown = event.detail.markdown || "";
});

/**
 * Check for pending patches and comments, warn user before export.
 * Returns true if user confirms, false if cancelled.
 */
async function confirmExportWithWarnings() {
    const warnings = [];

    // Check for pending patches
    try {
        const patches = await fetchPatchList();
        const pendingPatches = patches.filter(p => p.review_status === "pending");
        if (pendingPatches.length > 0) {
            warnings.push(`${pendingPatches.length} pending patch${pendingPatches.length > 1 ? 'es' : ''}`);
        }
    } catch (err) {
        console.warn("Could not check patch status:", err);
    }

    // Check for comments
    try {
        const comments = await listComments();
        const activeComments = comments.filter(c => c.status !== "deleted");
        if (activeComments.length > 0) {
            warnings.push(`${activeComments.length} comment${activeComments.length > 1 ? 's' : ''}`);
        }
    } catch (err) {
        console.warn("Could not check comments:", err);
    }

    if (warnings.length === 0) {
        return true; // No warnings, proceed
    }

    const message = `This document has ${warnings.join(" and ")} that will NOT be included in the export.\n\nMD/DOCX formats only export the current text content. To preserve patches and comments, use the KMD format instead.\n\nProceed with export?`;

    return confirm(message);
}

/**
 * Show recent documents panel
 */
async function showRecentDocuments() {
    const recentPanel = document.getElementById("recent-documents");
    const recentList = document.getElementById("recent-list");
    const editorScroll = document.querySelector(".editor-scroll");

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
        if (editorScroll) editorScroll.style.display = "none";
    } catch (err) {
        console.error("Failed to load recent documents:", err);
    }
}

/**
 * Hide recent documents panel
 */
function hideRecentDocuments() {
    const recentPanel = document.getElementById("recent-documents");
    const editorScroll = document.querySelector(".editor-scroll");

    if (recentPanel) recentPanel.style.display = "none";
    if (editorScroll) editorScroll.style.display = "block";
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

    // 1. Initialize UI Layout Components (sidebars, theme)
    initResizableSidebars();
    initThemeToggle();
    await initProfileButton();

    // Initialize welcome modal after profile button is ready
    await initWelcomeModal();

    // 2. Initialize Document Action Buttons
    const newDocBtn = document.getElementById("new-doc-btn");
    const openDocBtn = document.getElementById("open-doc-btn");
    const saveDocBtn = document.getElementById("save-doc-btn");
    const reconcileBtn = document.getElementById("reconcile-btn");
    const exportMdBtn = document.getElementById("export-md-btn");
    const exportDocxBtn = document.getElementById("export-docx-btn");
    const newTabBtn = document.getElementById("new-tab-btn");

    if (newDocBtn) {
        newDocBtn.addEventListener("click", async () => {
            try {
                await newDocument();
            } catch (err) {
                console.error("Failed to create new document:", err);
            }
        });
    }

    if (newTabBtn) {
        newTabBtn.addEventListener("click", async () => {
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

    if (reconcileBtn) {
        reconcileBtn.addEventListener("click", async () => {
            try {
                await startReconciliation();
            } catch (err) {
                console.error("Reconciliation failed:", err);
                alert("Reconciliation failed: " + err);
            }
        });
    }

    if (exportMdBtn) {
        exportMdBtn.addEventListener("click", async () => {
            try {
                // Warn about pending patches/comments
                const proceed = await confirmExportWithWarnings();
                if (!proceed) return;

                const markdown = getMarkdown();
                const path = await exportAsMarkdown(markdown);
            } catch (err) {
                console.error("Markdown export failed:", err);
                alert("Markdown export failed: " + err);
            }
        });
    }

    if (exportDocxBtn) {
        exportDocxBtn.addEventListener("click", async () => {
            try {
                // Warn about pending patches/comments
                const proceed = await confirmExportWithWarnings();
                if (!proceed) return;

                const markdown = getMarkdown();
                const path = await exportAsDocx(markdown);
                if (path) {
                    console.log("DOCX exported successfully to:", path);
                }
            } catch (err) {
                console.error("DOCX export failed:", err);
                alert("DOCX export failed: " + err);
            }
        });
    }

    // 3. Initialize Conflict UI and Keyboard Shortcuts
    initConflictUI();
    initKeyboardShortcuts();
    initDocumentTabs();

    // 4. Initialize Recent Documents Panel Buttons
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

    // 5. Initialize Timeline and Comments (right sidebar)
    initTimeline();
    initCommentsPanel();

    // 6. Initialize Document Manager
    try {
        await initDocumentManager();
        updateDocumentUI();
    } catch (err) {
        console.error("Failed to initialize document manager:", err);
        showRecentDocuments();
    }

    // 7. Listen for document changes
    onDocumentChange((event, doc) => {
        updateDocumentUI();
    });

    // 8. Initialize Editor
    try {
        const editor = await initEditor();
        // Initialize formatting toolbar with editor instance
        initFormattingToolbar(editor);
        // Initialize comments context menu
        initEditorContextMenu();
    } catch (err) {
        console.error("Failed to initialize editor:", err);
    }
});
