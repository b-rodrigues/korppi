import * as Y from "yjs";
import { invoke } from "@tauri-apps/api/tauri";

export const ydoc = new Y.Doc();
export const yXmlFragment = ydoc.getXmlFragment("prosemirror");

export async function loadInitialDoc() {
  const update = await invoke("load_doc").catch(() => []);
  if (update && update.length > 0) {
    Y.applyUpdate(ydoc, new Uint8Array(update));
  }
}

// Attach a listener to push updates to Rust.
let isApplyingFromDisk = false;

export function enablePersistence() {
  ydoc.on("update", async (update) => {
    if (isApplyingFromDisk) return; // avoid feedback loop

    try {
      await invoke("store_update", { update: Array.from(update) });
    } catch (err) {
      console.error("Failed to store update:", err);
    }
  });
}

export function beginApplyingDiskUpdates() {
  isApplyingFromDisk = true;
}

export function endApplyingDiskUpdates() {
  isApplyingFromDisk = false;
}
