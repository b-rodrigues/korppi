import { invoke } from "@tauri-apps/api/tauri";

export async function fetchPatchList() {
    return await invoke("list_patches").catch(() => []);
}

export async function fetchPatch(id) {
    return await invoke("get_patch", { id }).catch(() => null);
}

export function renderPatchList(patches) {
    const list = document.getElementById("timeline-list");
    list.innerHTML = "";

    patches.forEach((patch) => {
        const div = document.createElement("div");
        div.className = "timeline-item";
        div.dataset.id = patch.id;

        const ts = new Date(patch.timestamp).toLocaleString();

        div.innerHTML = `
            <div><strong>#${patch.id}</strong> - ${patch.kind}</div>
            <div class="timeline-timestamp">${ts}</div>
        `;

        list.appendChild(div);
    });
}

export function renderPatchDetails(patch) {
    const details = document.getElementById("timeline-details");
    details.innerHTML = `
        <h3>Patch #${patch.id}</h3>
        <p><strong>Author:</strong> ${patch.author}</p>
        <p><strong>Kind:</strong> ${patch.kind}</p>
        <pre>${JSON.stringify(patch.data, null, 2)}</pre>
    `;
}
