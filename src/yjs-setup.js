// src/yjs-setup.js
import * as Y from "yjs";
import { invoke } from "@tauri-apps/api/core";

export const ydoc = new Y.Doc();
export const yXmlFragment = ydoc.getXmlFragment("prosemirror");

let isApplyingFromDisk = false;
let saveTimeout = null;

export async function loadInitialDoc() {
  const update = await invoke("load_doc").catch(() => []);
  if (update && update.length > 0) {
    Y.applyUpdate(ydoc, new Uint8Array(update));
  }
}

// Debounced save to avoid hammering the filesystem
function debouncedSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  
  saveTimeout = setTimeout(async () => {
    if (isApplyingFromDisk) return;
    
    try {
      // Send the entire state vector instead of individual updates
      const fullState = Y.encodeStateAsUpdate(ydoc);
      await invoke("store_update", { fullState: Array.from(fullState) });
    } catch (err) {
      console.error("Failed to store update:", err);
    }
  }, 300); // 300ms debounce
}

export function enablePersistence() {
  ydoc.on("update", () => {
    if (isApplyingFromDisk) return;
    debouncedSave();
  });
}

export function beginApplyingDiskUpdates() {
  isApplyingFromDisk = true;
}

export function endApplyingDiskUpdates() {
  isApplyingFromDisk = false;
}

// Force immediate save (for beforeunload, etc.)
export async function forceSave() {
  if (saveTimeout) clearTimeout(saveTimeout);
  if (isApplyingFromDisk) return;
  
  const fullState = Y.encodeStateAsUpdate(ydoc);
  await invoke("store_update", { fullState: Array.from(fullState) });
}
