import {
  ydoc,
  yXmlFragment,
  loadInitialDoc,
  enablePersistence,
  beginApplyingDiskUpdates,
  endApplyingDiskUpdates
} from "./yjs-setup.js";

import { Editor, rootCtx, defaultValueCtx } from "@milkdown/core";
import { nord } from "@milkdown/theme-nord";
import { commonmark } from "@milkdown/preset-commonmark";
import { prosemirrorCtx } from "@milkdown/prose";
import { invoke } from "@tauri-apps/api/tauri";
import { Plugin } from "@milkdown/prose/state";
import { ySyncPlugin, yUndoPlugin } from "y-prosemirror";
import { stepToSemanticPatch } from "./patch-extractor.js";
import { addSemanticPatches, flushGroup } from "./patch-grouper.js";

async function setupEditor() {
  const mount = document.getElementById("editor");

  beginApplyingDiskUpdates();
  await loadInitialDoc();
  endApplyingDiskUpdates();

  enablePersistence();

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, mount);
      ctx.set(defaultValueCtx, ""); // replaced by Yjs
    })
    .use(nord)
    .use(commonmark)
    .create();

  editor.action((ctx) => {
    const view = ctx.get(prosemirrorCtx);
    const state = view.state;

    const patchLoggerPlugin = new Plugin({
        appendTransaction(transactions, oldState, newState) {
            if (!transactions.length) return;

            const semanticPatches = [];

            for (const tr of transactions) {
                for (const step of tr.steps) {
                    const semantic = stepToSemanticPatch(step, oldState, newState);
                    semanticPatches.push(semantic);
                }
            }

            if (semanticPatches.length === 0) return;

            // Feed the new semantic patches into the grouper
            const groupedRecord = addSemanticPatches(semanticPatches, "local");

            // Only write to SQLite when a group is flushed
            if (groupedRecord) {
              invoke("record_patch", { patch: groupedRecord }).catch((err) => {
                console.error("Failed to record grouped patch:", err);
              });
            }

            return null;
        },
    });

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
}

setupEditor();

window.addEventListener("blur", () => {
  const record = flushGroup("local");
  if (!record) return;
  invoke("record_patch", { patch: record }).catch((err) => {
    console.error("Failed to record grouped patch on blur:", err);
  });
});

window.addEventListener("beforeunload", (event) => {
  const record = flushGroup("local");
  if (!record) return;
  // We can't reliably await here; just fire and forget.
  invoke("record_patch", { patch: record }).catch(() => {});
});
