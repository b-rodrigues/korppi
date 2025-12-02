// editor.js — Clean unified version

import { Editor, rootCtx, defaultValueCtx } from "@milkdown/core";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { commonmark } from "@milkdown/preset-commonmark";
import { invoke } from "@tauri-apps/api/core";

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
