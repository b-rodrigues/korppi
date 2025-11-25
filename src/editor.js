// editor.js — Clean unified version

import { Editor, rootCtx, defaultValueCtx } from "@milkdown/core";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { commonmark } from "@milkdown/preset-commonmark";
import { prosemirrorCtx } from "@milkdown/kit/internal";
import { ySyncPlugin, yUndoPlugin } from "y-prosemirror";
import { invoke } from "@tauri-apps/api/tauri";

import { ydoc, yXmlFragment, loadInitialDoc, forceSave } from "./yjs-setup.js";
import { stepToSemanticPatch } from "./patch-extractor.js";
import {
    addSemanticPatches,
    flushGroup
} from "./patch-grouper.js";

// ---------------------------------------------------------------------------
//  Initialize Yjs document state before creating the editor.
// ---------------------------------------------------------------------------
await loadInitialDoc();

// ---------------------------------------------------------------------------
//  Create the Milkdown editor with Yjs + semantic patch logging.
// ---------------------------------------------------------------------------
export const editor = await Editor.make()
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
    .use(listener)
    .create();

// ---------------------------------------------------------------------------
//  Patch logger plugin (semantic patches + grouping).
// ---------------------------------------------------------------------------
editor.action((ctx) => {
    const view = ctx.get(prosemirrorCtx);
    const state = view.state;

    const patchLoggerPlugin = new view.state.Plugin({
        appendTransaction(transactions, oldState, newState) {
            if (!transactions.length) return;

            const semanticPatches = [];

            for (const tr of transactions) {
                // Skip Yjs-generated transactions (mirror updates)
                if (tr.getMeta("y-sync$")) continue;

                for (const step of tr.steps) {
                    const semantic = stepToSemanticPatch(step, oldState, newState);
                    semanticPatches.push(semantic);
                }
            }

            if (semanticPatches.length === 0) return;

            // Feed semantic patches into the grouper
            const groupedRecord = addSemanticPatches(semanticPatches, "local");

            // Only when the grouper flushes do we persist to SQLite
            if (groupedRecord) {
                invoke("record_patch", { patch: groupedRecord }).catch((err) => {
                    console.error("Failed to record grouped patch:", err);
                });
            }

            return null;
        },
    });

    // Inject the correct plugin list
    const newState = state.reconfigure({
        ...state,
        plugins: [
            ...state.plugins,
            ySyncPlugin(yXmlFragment),
            yUndoPlugin(),
            patchLoggerPlugin,
        ],
    });

    view.updateState(newState);
});

// ---------------------------------------------------------------------------
//  Lifecycle integration — ensure we flush + save on loss of focus.
// ---------------------------------------------------------------------------

// On window blur: flush semantic group + force Yjs save
window.addEventListener("blur", () => {
    const record = flushGroup("local");
    if (record) {
        invoke("record_patch", { patch: record }).catch((err) => {
            console.error("Failed to record grouped patch on blur:", err);
        });
    }
    forceSave();
});

// On tab hide (user switches tab)
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
        const record = flushGroup("local");
        if (record) {
            invoke("record_patch", { patch: record }).catch(() => {});
        }
        forceSave();
    }
});

// Last resort: before page unload.
window.addEventListener("beforeunload", () => {
    const record = flushGroup("local");
    if (record) {
        // Fire and forget — cannot guarantee async execution
        invoke("record_patch", { patch: record }).catch(() => {});
    }
    forceSave();
});
