// src/yjs-setup.js
import * as Y from "yjs";

// One Y.Doc per opened document (for now: a single in-memory doc).
export const ydoc = new Y.Doc();

// ProseMirror/Yjs convention: use an XmlFragment for the document.
export const yXmlFragment = ydoc.getXmlFragment("prosemirror");

// Optional: a helper if you later want to clear/reset content.
export const resetDoc = () => {
  ydoc.transact(() => {
    yXmlFragment.toArray().forEach(node => node.delete(0, node.length));
  });
};
