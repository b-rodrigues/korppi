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

    const newState = state.reconfigure({
      ...state,
      plugins: [
        ...state.plugins,
        ySyncPlugin(yXmlFragment),
        yUndoPlugin(),
      ],
    });

    view.updateState(newState);
  });
}

setupEditor();
