// src/history.js
import { invoke } from "@tauri-apps/api/tauri";

export async function loadPatches() {
    try {
        const patches = await invoke("list_patches");
        return patches;
    } catch (err) {
        console.error("Failed to load patches:", err);
        return [];
    }
}

export function renderHistory(patches) {
    const sidebar = document.getElementById("history-sidebar");
    if (!sidebar) return;

    sidebar.innerHTML = ""; // clear

    for (const p of patches) {
        const div = document.createElement("div");
        div.className = "patch-entry";

        const date = new Date(p.timestamp).toLocaleString();

        div.innerHTML = `
            <div class="patch-timestamp">${date}</div>
            <div class="patch-author">Author: ${p.author}</div>
            <div class="patch-kind">Type: ${p.kind}</div>
            <pre class="patch-data">${JSON.stringify(p.data, null, 2)}</pre>
        `;

        sidebar.appendChild(div);
    }
}

export async function showHistory() {
    const patches = await loadPatches();
    renderHistory(patches);
    document.getElementById("history-sidebar").style.display = "block";
}

export function hideHistory() {
    document.getElementById("history-sidebar").style.display = "none";
}
