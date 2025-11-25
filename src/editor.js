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

        // Aggregate info for now. Later we can inspect steps in detail.
        const stepsCount = transactions.reduce(
          (acc, tr) => acc + tr.steps.length,
          0
        );

        if (stepsCount === 0) return;

        const patch = {
          timestamp: Date.now(),
          author: "local", // TODO: later: real identity
          kind: "transaction",
          data: {
            steps: stepsCount,
            docSizeBefore: oldState.doc.content.size,
            docSizeAfter: newState.doc.content.size,
          },
        };

        // Fire & forget
        invoke("record_patch", { patch }).catch((err) => {
          console.error("Failed to record patch:", err);
        });

        return null; // do not modify the transaction
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
