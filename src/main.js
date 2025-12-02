import "./editor.js";
import { fetchPatchList, fetchPatch, renderPatchList, renderPatchDetails } from "./timeline.js";
import { initConflictUI } from "./conflict-ui.js";

window.addEventListener("DOMContentLoaded", async () => {
    // Initialize conflict UI
    initConflictUI();

    // Timeline code...
    const toggle = document.getElementById("timeline-toggle");
    const container = document.getElementById("timeline-container");
    const list = document.getElementById("timeline-list");

    toggle.addEventListener("click", async () => {
        if (container.style.display === "none") {
            container.style.display = "block";
            const patches = await fetchPatchList();
            renderPatchList(patches);
        } else {
            container.style.display = "none";
        }
    });

    list.addEventListener("click", async (event) => {
        const item = event.target.closest(".timeline-item");
        if (!item) return;

        const id = parseInt(item.dataset.id);
        const patch = await fetchPatch(id);
        if (patch) renderPatchDetails(patch);
    });
});
