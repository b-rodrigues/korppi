import { initEditor, getMarkdown, doUndo, doRedo, setMarkdownContent } from "./editor.js";
import { fetchPatchList, fetchPatch, renderPatchList, renderPatchDetails, initTimeline } from "./timeline.js";
import { initConflictUI } from "./conflict-ui.js";
import { exportAsMarkdown, exportAsDocx } from "./kmd-service.js";
import { forceSave } from "./yjs-setup.js";
import { startReconciliation } from "./reconcile.js";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { showSaveConfirmModal } from "./components/save-confirm-modal.js";
import {
    initDocumentManager,
    newDocument,
    openDocument,
    importDocument,
    saveDocument,
    saveDocumentAs,
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
import { initEditorModeToggle, syncRawEditor } from "./components/editor-mode-toggle.js";
import { initProfileButton } from "./components/profile-button.js";
import { initFormattingToolbar } from "./components/formatting-toolbar.js";
import { initCommentsPanel, initEditorContextMenu } from "./comments-ui.js";
import { listComments } from "./comments-service.js";
import { initWelcomeModal } from "./components/welcome-modal.js";
import { initSearch } from "./search.js";
import { initAutosave } from "./autosave.js";
import { initWordCount } from "./word-count.js";
import { initSidebarController } from "./components/sidebar-controller.js";
import { initPatchMergeWizard, openPatchMergeWizard } from "./patch-merge-wizard.js";
import { initHunkReviewPanel } from "./hunk-review-panel.js";

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
        // We'll rely on the backend to tell us which patches need review
        // Note: This logic assumes current user context.
        // For a generic export warning, we might want "patches not accepted by anyone"
        // but for now, "patches needing MY review" is a decent proxy or we can just fetch all patches
        // and check if any are not authored by me and not accepted.

        // Simpler approach: Fetch all patches, check if any non-local patches lack acceptance.
        // However, without a robust "global acceptance" concept, this is tricky.
        // Let's stick to: "Are there patches I haven't reviewed?"

        // Actually, for export, the warning is usually about "unmerged changes".
        // In this system, "accepted" patches are merged into the document view (if we implement that view).
        // If we export the *current view*, we export what we see.
        // If we see patches that are pending, we might be exporting a state that includes them (if applying all)
        // or excludes them. KMD export includes history, so it's safe.
        // MD/DOCX export is the snapshot.

        // Let's warn if there are patches that the current user hasn't reviewed yet.
        // This prompts them to maybe review before finalizing the doc.

        // Ideally we'd call `get_patches_needing_review` but we need the current user ID.
        // Let's use fetchPatchList and filter client-side for now as we don't have easy access to user ID here without importing profile service.

        // Importing profile service dynamically to avoid circular deps if any
        const { getCachedProfile } = await import("./profile-service.js");
        const { invoke } = await import("@tauri-apps/api/core");
        const { getActiveDocumentId } = await import("./document-manager.js");

        const profile = getCachedProfile();
        const currentUserId = profile?.id || 'local';
        const docId = getActiveDocumentId();

        if (docId) {
            const patches = await invoke("get_document_patches_needing_review", {
                docId,
                reviewerId: currentUserId
            });

            if (patches.length > 0) {
                warnings.push(`${patches.length} pending patch${patches.length > 1 ? 'es' : ''}`);
            }
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

    // Disable default browser context menu globally
    // (The editor has its own custom context menu)
    // Ctrl+Right-click allows browser dev menu for debugging
    document.addEventListener("contextmenu", (e) => {
        // Ctrl+Right-click: allow browser dev menu for debugging
        if (e.ctrlKey) return;

        // Allow context menu inside editor (handled by comments-ui.js)
        if (e.target.closest("#editor")) return;

        // Prevent default browser context menu everywhere else
        e.preventDefault();
    });

    // 1. Initialize UI Layout Components (sidebars, theme)
    initResizableSidebars();
    initSidebarController(); // Hide right sidebar by default
    initThemeToggle();
    await initProfileButton();

    // Initialize welcome modal after profile button is ready
    await initWelcomeModal();

    // 2. Initialize Document Action Buttons
    const newDocBtn = document.getElementById("new-doc-btn");
    const openDocBtn = document.getElementById("open-doc-btn");
    const saveDocBtn = document.getElementById("save-doc-btn");
    const saveAsBtn = document.getElementById("save-as-btn");
    const reconcileBtn = document.getElementById("reconcile-btn");
    const exportMdBtn = document.getElementById("export-md-btn");
    const exportDocxBtn = document.getElementById("export-docx-btn");
    const newTabBtn = document.getElementById("new-tab-btn");
    const undoBtn = document.getElementById("undo-btn");
    const redoBtn = document.getElementById("redo-btn");

    // Wire up Undo/Redo buttons
    if (undoBtn) {
        undoBtn.addEventListener("click", () => doUndo());
    }
    if (redoBtn) {
        redoBtn.addEventListener("click", () => doRedo());
    }

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

    // Import button handler
    const importDocBtn = document.getElementById("import-doc-btn");
    if (importDocBtn) {
        importDocBtn.addEventListener("click", async () => {
            try {
                const result = await importDocument();
                // Wait for Yjs document switch to complete before restoring content
                if (result.content) {
                    // The document switch is triggered by setActiveDocument inside importDocument.
                    // We need to wait for the yjs-doc-replaced event to fire before restoring.
                    await new Promise(resolve => {
                        const handler = () => {
                            window.removeEventListener("yjs-doc-replaced", handler);
                            resolve();
                        };
                        window.addEventListener("yjs-doc-replaced", handler);
                        // Timeout fallback in case the event already fired
                        setTimeout(resolve, 100);
                    });
                    setMarkdownContent(result.content);
                    // Trigger word count update after content is loaded
                    window.dispatchEvent(new CustomEvent("document-changed"));
                }
            } catch (err) {
                if (!err.toString().includes("No file selected")) {
                    console.error("Failed to import document:", err);
                    alert("Failed to import document: " + err);
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

    if (saveAsBtn) {
        saveAsBtn.addEventListener("click", async () => {
            try {
                await forceSave();
                await saveDocumentAs();
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
    initSearch();
    initAutosave();
    initWordCount();
    initPatchMergeWizard();
    initHunkReviewPanel();

    // Wire up Merge Patches button
    const mergePatchesBtn = document.getElementById("merge-patches-btn");
    if (mergePatchesBtn) {
        mergePatchesBtn.addEventListener("click", () => {
            openPatchMergeWizard();
        });
    }

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

    // Import button in recent documents panel
    const importDocumentBtn = document.getElementById("import-document-btn");
    if (importDocumentBtn) {
        importDocumentBtn.addEventListener("click", async () => {
            try {
                const result = await importDocument();
                // Wait for Yjs document switch to complete before restoring content
                if (result.content) {
                    await new Promise(resolve => {
                        const handler = () => {
                            window.removeEventListener("yjs-doc-replaced", handler);
                            resolve();
                        };
                        window.addEventListener("yjs-doc-replaced", handler);
                        // Timeout fallback in case the event already fired
                        setTimeout(resolve, 100);
                    });
                    setMarkdownContent(result.content);
                    // Trigger word count update after content is loaded
                    window.dispatchEvent(new CustomEvent("document-changed"));
                }
            } catch (err) {
                if (!err.toString().includes("No file selected")) {
                    console.error("Failed to import document:", err);
                    alert("Failed to import document: " + err);
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
        // Sync raw editor content when document changes
        if (event === "activeChange") {
            syncRawEditor();
        }
    });

    // 8. Initialize Editor
    try {
        const editor = await initEditor();
        // Initialize formatting toolbar with editor instance
        initFormattingToolbar(editor);
        // Initialize comments context menu
        initEditorContextMenu();
        // Initialize editor mode toggle (raw/rendered)
        initEditorModeToggle();

        // Add a click-catcher element below the editor content to allow clicking below content
        const editorDiv = document.getElementById('editor');
        if (editorDiv && !editorDiv.querySelector('.editor-click-catcher')) {
            const clickCatcher = document.createElement('div');
            clickCatcher.className = 'editor-click-catcher';
            clickCatcher.style.cssText = `
                min-height: 50vh;
                cursor: text;
            `;
            editorDiv.appendChild(clickCatcher);

            // Handle clicks on the catcher to position cursor at end
            clickCatcher.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();

                const { editorViewCtx } = await import('./editor.js');
                editor.action((ctx) => {
                    const view = ctx.get(editorViewCtx);
                    const doc = view.state.doc;
                    const endPos = doc.content.size;

                    const lastChild = doc.lastChild;
                    let tr = view.state.tr;

                    // If last element is a code block, table, image, or if there's no content, insert a new paragraph
                    if (!lastChild ||
                        lastChild.type.name === 'code_block' ||
                        lastChild.type.name === 'fence' ||
                        lastChild.type.name === 'table' ||
                        lastChild.type.name === 'image') {
                        const paragraphType = view.state.schema.nodes.paragraph;
                        if (paragraphType) {
                            tr = tr.insert(endPos, paragraphType.create());
                        }
                    }

                    // Set selection to end
                    const newEndPos = tr.doc.content.size;
                    tr = tr.setSelection(
                        view.state.selection.constructor.near(tr.doc.resolve(newEndPos))
                    );

                    view.dispatch(tr);
                    view.focus();
                });
            });
        }

        // Also handle clicks on the ProseMirror padding (below content but inside the editor)
        const proseMirrorEl = editorDiv.querySelector('.ProseMirror');
        if (proseMirrorEl) {
            proseMirrorEl.addEventListener('click', async (e) => {
                // Only handle clicks directly on the ProseMirror container (not on child content)
                if (e.target !== proseMirrorEl) return;

                const { editorViewCtx } = await import('./editor.js');
                editor.action((ctx) => {
                    const view = ctx.get(editorViewCtx);
                    const doc = view.state.doc;
                    const endPos = doc.content.size;

                    const lastChild = doc.lastChild;
                    let tr = view.state.tr;

                    // If last element is a code block, table, image, or if there's no content, insert a paragraph
                    if (!lastChild ||
                        lastChild.type.name === 'code_block' ||
                        lastChild.type.name === 'fence' ||
                        lastChild.type.name === 'table' ||
                        lastChild.type.name === 'image') {
                        const paragraphType = view.state.schema.nodes.paragraph;
                        if (paragraphType) {
                            tr = tr.insert(endPos, paragraphType.create());
                        }
                    }

                    // Set selection to end
                    const newEndPos = tr.doc.content.size;
                    tr = tr.setSelection(
                        view.state.selection.constructor.near(tr.doc.resolve(newEndPos))
                    );

                    view.dispatch(tr);
                    view.focus();
                });
            });
        }

        // Figure double-click handler - edit caption and label
        const proseMirrorForFigures = editorDiv.querySelector('.ProseMirror');
        if (proseMirrorForFigures) {
            proseMirrorForFigures.addEventListener('dblclick', async (e) => {
                // Find if we clicked on a figure or its children
                let figureEl = e.target.closest('figure.figure');
                if (!figureEl) return;

                e.preventDefault();
                e.stopPropagation();

                const currentLabel = figureEl.getAttribute('data-label') || '';
                const figcaption = figureEl.querySelector('figcaption');
                // Extract caption without the "Figure N: " prefix
                let currentCaption = '';
                if (figcaption) {
                    const captionText = figcaption.textContent || '';
                    const prefixMatch = captionText.match(/^Figure \d+:\s*/);
                    currentCaption = prefixMatch ? captionText.slice(prefixMatch[0].length) : captionText;
                }

                // Show edit dialog
                const overlay = document.createElement('div');
                overlay.className = 'modal';
                overlay.style.display = 'flex';
                overlay.innerHTML = `
                    <div class="modal-content" style="max-width: 400px;">
                        <div class="modal-header">
                            <h2>Edit Figure</h2>
                        </div>
                        <div class="modal-body">
                            <div class="form-group">
                                <label for="edit-figure-caption">Caption:</label>
                                <input type="text" id="edit-figure-caption" value="${currentCaption.replace(/"/g, '&quot;')}" style="width: 100%;">
                            </div>
                            <div class="form-group">
                                <label for="edit-figure-label">Label (for cross-references):</label>
                                <input type="text" id="edit-figure-label" value="${currentLabel.replace(/"/g, '&quot;')}" style="width: 100%;">
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button id="edit-figure-cancel" class="btn-secondary">Cancel</button>
                            <button id="edit-figure-save" class="btn-primary">Save</button>
                        </div>
                    </div>
                `;
                document.body.appendChild(overlay);

                const captionInput = overlay.querySelector('#edit-figure-caption');
                const labelInput = overlay.querySelector('#edit-figure-label');
                const saveBtn = overlay.querySelector('#edit-figure-save');
                const cancelBtn = overlay.querySelector('#edit-figure-cancel');

                captionInput.focus();
                captionInput.select();

                const cleanup = () => document.body.removeChild(overlay);

                saveBtn.addEventListener('click', async () => {
                    const newCaption = captionInput.value.trim();
                    let newLabel = labelInput.value.trim();

                    // Ensure label has fig: prefix if provided
                    if (newLabel && !newLabel.startsWith('fig:')) {
                        newLabel = 'fig:' + newLabel;
                    }

                    // Update the figure node attrs
                    const { editorViewCtx } = await import('./editor.js');
                    editor.action((ctx) => {
                        const view = ctx.get(editorViewCtx);
                        const { state, dispatch } = view;

                        // Find the figure node by position
                        let figPos = null;
                        state.doc.descendants((node, pos) => {
                            if (node.type.name === 'figure' &&
                                node.attrs.label === currentLabel) {
                                figPos = pos;
                                return false;
                            }
                        });

                        if (figPos !== null) {
                            const tr = state.tr.setNodeMarkup(figPos, null, {
                                ...state.doc.nodeAt(figPos).attrs,
                                caption: newCaption,
                                label: newLabel || null
                            });
                            dispatch(tr);
                        }
                        view.focus();
                    });

                    cleanup();
                });

                cancelBtn.addEventListener('click', cleanup);

                overlay.addEventListener('click', (e) => {
                    if (e.target === overlay) cleanup();
                });

                overlay.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        saveBtn.click();
                    } else if (e.key === 'Escape') {
                        cleanup();
                    }
                });
            });
        }
    } catch (err) {
        console.error("Failed to initialize editor:", err);
    }

    // 9. Handle window close with unsaved changes prompt
    const appWindow = getCurrentWindow();
    await appWindow.onCloseRequested(async (event) => {
        // Check for any unsaved documents
        const docs = getOpenDocuments();
        const unsavedDocs = Array.from(docs.values()).filter(d => d.is_modified);

        if (unsavedDocs.length > 0) {
            // Prevent default close - we'll handle it
            event.preventDefault();

            // Build message based on number of unsaved docs
            const docNames = unsavedDocs.map(d => d.title).join('", "');
            const message = unsavedDocs.length === 1
                ? `Do you want to save changes to "${unsavedDocs[0].title}"?`
                : `Do you want to save changes to ${unsavedDocs.length} documents?\n"${docNames}"`;

            // Show custom modal with Save / Don't Save / Cancel buttons
            const result = await showSaveConfirmModal(message);

            if (result === 'cancel') {
                // User clicked Cancel - return to app without doing anything
                return;
            }

            if (result === 'save') {
                // User clicked "Save" - save all documents then quit
                try {
                    for (const doc of unsavedDocs) {
                        await saveDocument(doc.id);
                    }
                } catch (err) {
                    console.error("Failed to save documents:", err);
                    // If save fails, don't close - let user try again
                    return;
                }
            }
            // result === 'dontsave' means quit without saving

            // Force save Yjs internal state
            try {
                await forceSave();
            } catch (err) {
                console.error("Failed to save Yjs state:", err);
            }

            // Now close the window
            try {
                await appWindow.destroy();
            } catch (err) {
                console.error("Failed to destroy window:", err);
                // Try close as fallback
                await appWindow.close();
            }
        } else {
            // No unsaved changes, just save Yjs state
            try {
                await forceSave();
            } catch (err) {
                console.error("Failed to save Yjs state:", err);
            }
        }
    });
});
