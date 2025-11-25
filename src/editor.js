// src/editor.js
import { yXmlFragment } from "./yjs-setup.js";

import { Editor, rootCtx, defaultValueCtx } from "@milkdown/core";
import { nord } from "@milkdown/theme-nord";
import { commonmark } from "@milkdown/preset-commonmark";
import { prosemirrorCtx } from "@milkdown/prose";

import { ySyncPlugin, yUndoPlugin } from "y-prosemirror";

async function setupEditor() {
  const mount = document.getElementById("editor");
  if (!mount) {
    console.error("No #editor element found in DOM");
    return;
  }

  const initialText = `# Korppi

Welcome to the Korppi prototype.

- This document is powered by **Milkdown** (editor).
- The underlying state is a **Yjs** CRDT document.
- There is currently **no persistence**: reload = fresh doc.
`;

  const editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, mount);
      ctx.set(defaultValueCtx, initialText);
    })
    .use(nord)
    .use(commonmark)
    .create();

  // Inject Yjs into the underlying ProseMirror state.
  editor.action((ctx) => {
    const view = ctx.get(prosemirrorCtx);
    const state = view.state;

    const newState = state.reconfigure({
      ...state,
      plugins: [
        ...state.plugins,
        // Sync ProseMirror <-> Yjs
        ySyncPlugin(yXmlFragment),
        // Local undo/redo that respects CRDT history
        yUndoPlugin(),
      ],
    });

    view.updateState(newState);
  });

  // For now, nothing more: Y.Doc lives in memory only.
  console.log("Milkdown + Yjs editor initialized.");
}

setupEditor();
