// editor.js — Clean unified version

import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx } from "@milkdown/core";
import { replaceAll } from "@milkdown/utils";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
// Re-export editorViewCtx so other modules can use it with the editor instance
export { editorViewCtx };

import { Plugin } from "@milkdown/prose/state";
import { ySyncPlugin, yUndoPlugin, undo, redo } from "y-prosemirror";
import { invoke } from "@tauri-apps/api/core";

import { ydoc, yXmlFragment, loadInitialDoc, forceSave, enablePersistence, switchDocument, loadDocumentState, isApplyingUpdate } from "./yjs-setup.js";
import { stepToSemanticPatch } from "./patch-extractor.js";
import {
    addSemanticPatches,
    flushGroup
} from "./patch-grouper.js";
import { initProfile } from "./profile-service.js";
import { getActiveDocumentId, onDocumentChange } from "./document-manager.js";

// ---------------------------------------------------------------------------
//  Initialize profile and Yjs document state before creating the editor.
// ---------------------------------------------------------------------------

export let editor;

export function getEditorContent() {
    let content = "";
    if (editor) {
        editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            // Use textBetween instead of textContent to preserve newlines
            const doc = view.state.doc;
            content = doc.textBetween(0, doc.content.size, "\n", "\n");
        });
    }
    return content;
}

/**
 * Get the current document content as Markdown.
 * This extracts markdown on-demand using Milkdown's serializer.
 */
export function getMarkdown() {
    let markdown = "";
    if (editor) {
        editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const serializer = ctx.get(serializerCtx);
            markdown = serializer(view.state.doc);
        });
    }
    return markdown;
}

/**
 * Undo the last change (uses Yjs undo stack).
 */
export function doUndo() {
    if (editor) {
        try {
            editor.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                undo(view.state, view.dispatch);
            });
        } catch (err) {
            console.error("Undo error:", err);
        }
    }
}

/**
 * Redo the last undone change (uses Yjs redo stack).
 */
export function doRedo() {
    if (editor) {
        try {
            editor.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                redo(view.state, view.dispatch);
            });
        } catch (err) {
            console.error("Redo error:", err);
        }
    }
}

/**
 * Set the editor content from a markdown string.
 * This properly parses the markdown and renders it in WYSIWYG mode.
 * @param {string} markdown - The markdown content to set
 * @returns {boolean} True if successful
 */
export function setMarkdownContent(markdown) {
    if (!editor) {
        console.error("setMarkdownContent: Editor not initialized");
        return false;
    }

    if (!markdown || typeof markdown !== 'string') {
        console.warn("setMarkdownContent: No valid markdown provided");
        return false;
    }

    try {
        editor.action(replaceAll(markdown));
        return true;
    } catch (err) {
        console.error("setMarkdownContent error:", err);
        return false;
    }
}

export async function initEditor() {
    try {
        await initProfile();
    } catch (err) {
        console.warn("Failed to initialize profile, using defaults:", err);
    }

    // Initial load is handled by the activeChange listener in main.js/editor.js
    // or by checking active document if listener hasn't fired yet.
    // However, to avoid race conditions with the listener, we should rely on the listener
    // or explicitly check if we need to load ONLY if not already loaded.
    // For now, we'll let the listener handle it to avoid double-loading.

    enablePersistence();

    // ---------------------------------------------------------------------------
    //  Create the Milkdown editor with Yjs + semantic patch logging.
    // ---------------------------------------------------------------------------
    try {
        editor = await Editor.make()
            .config((ctx) => {
                ctx.set(rootCtx, document.getElementById("editor"));
                ctx.set(defaultValueCtx, "");

                ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, prevMarkdown) => {
                    // This ensures Markdown export stays in sync.
                    const event = new CustomEvent("markdown-updated", {
                        detail: { markdown, prevMarkdown },
                    });
                    window.dispatchEvent(event);
                });
            })
            .use(commonmark)
            .use(gfm)
            .use(listener)
            .create();
    } catch (err) {
        console.error("Editor: Failed to create", err);
        return;
    }

    // ---------------------------------------------------------------------------
    //  Patch logger plugin (semantic patches + grouping).
    // ---------------------------------------------------------------------------
    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const state = view.state;

        const patchLoggerPlugin = new Plugin({
            appendTransaction(transactions, oldState, newState) {
                if (!transactions.length) return;

                // Skip patch recording when we're applying updates (e.g., restoring from patch)
                if (isApplyingUpdate()) {
                    return;
                }

                const semanticPatches = [];

                for (const tr of transactions) {
                    // Skip Yjs-generated transactions (mirror updates)
                    if (tr.getMeta("y-sync$")) {
                        // console.log("Skipping Yjs transaction");
                        continue;
                    }

                    for (const step of tr.steps) {
                        const semantic = stepToSemanticPatch(step, oldState, newState);
                        semanticPatches.push(semantic);
                    }
                }

                if (semanticPatches.length === 0) return;

                // Feed semantic patches into the grouper (author is now pulled from profile)
                const currentText = newState.doc.textContent;
                const groupedRecord = addSemanticPatches(semanticPatches, currentText);

                // Only when the grouper flushes do we persist to SQLite
                if (groupedRecord) {
                    // Try to record to active document, fall back to global
                    const docId = getActiveDocumentId();
                    if (docId) {
                        invoke("record_document_patch", { id: docId, patch: groupedRecord }).catch((err) => {
                            console.error("Failed to record document patch:", err);
                            // Fall back to global patch log
                            invoke("record_patch", { patch: groupedRecord }).catch(() => { });
                        });
                    } else {
                        invoke("record_patch", { patch: groupedRecord }).catch((err) => {
                            console.error("Failed to record grouped patch:", err);
                        });
                    }
                }

                return null;
            },
        });

        // Inject the correct plugin list
        const newState = state.reconfigure({
            plugins: [
                ...state.plugins,
                ySyncPlugin(yXmlFragment),
                yUndoPlugin(),
                patchLoggerPlugin,
            ],
        });

        view.updateState(newState);
    });

    // Return the editor instance for external use
    return editor;
}

// Listen for Yjs document replacement (when switching docs)
window.addEventListener('yjs-doc-replaced', () => {
    if (!editor) return;

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const state = view.state;

        // Filter out existing Yjs plugins to avoid duplication/stale references
        // ySyncPlugin has key "y-sync$", yUndoPlugin has key "y-undo$"
        const cleanPlugins = state.plugins.filter(p =>
            !p.key.startsWith("y-sync$") &&
            !p.key.startsWith("y-undo$")
        );

        // Re-inject plugins with the NEW yXmlFragment
        // Note: yXmlFragment is a live binding from yjs-setup.js
        const newState = state.reconfigure({
            plugins: [
                ...cleanPlugins,
                ySyncPlugin(yXmlFragment),
                yUndoPlugin(),
            ],
        });

        view.updateState(newState);
    });
});

// ---------------------------------------------------------------------------
//  Handle document switching
// ---------------------------------------------------------------------------
onDocumentChange(async (event, doc) => {
    if (event === "activeChange" && doc) {
        try {
            await switchDocument(doc.id);
        } catch (err) {
            console.error("Failed to switch document:", err);
        }
    }
});

// ---------------------------------------------------------------------------
//  Lifecycle integration — ensure we flush + save on loss of focus.
// ---------------------------------------------------------------------------

// On window blur: flush semantic group + force Yjs save
window.addEventListener("blur", () => {
    const record = flushGroup(getEditorContent());
    if (record) {
        const docId = getActiveDocumentId();
        if (docId) {
            invoke("record_document_patch", { id: docId, patch: record }).catch(() => { });
        } else {
            invoke("record_patch", { patch: record }).catch((err) => {
                console.error("Failed to record grouped patch on blur:", err);
            });
        }
    }
    forceSave();
});

// On tab hide (user switches tab)
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
        const record = flushGroup(getEditorContent());
        if (record) {
            const docId = getActiveDocumentId();
            if (docId) {
                invoke("record_document_patch", { id: docId, patch: record }).catch(() => { });
            } else {
                invoke("record_patch", { patch: record }).catch(() => { });
            }
        }
        forceSave();
    }
});

// Last resort: before page unload.
window.addEventListener("beforeunload", () => {
    const record = flushGroup(getEditorContent());
    if (record) {
        const docId = getActiveDocumentId();
        if (docId) {
            invoke("record_document_patch", { id: docId, patch: record }).catch(() => { });
        } else {
            // Fire and forget — cannot guarantee async execution
            invoke("record_patch", { patch: record }).catch(() => { });
        }
    }
    forceSave();
});
