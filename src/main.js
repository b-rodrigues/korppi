import "./editor.js";
import { fetchPatchList, fetchPatch, renderPatchList, renderPatchDetails } from "./timeline.js";
import { initConflictUI } from "./conflict-ui.js";
import { initProfileSettings } from "./profile-settings.js";
import { exportDocument, importDocument, exportAsMarkdown } from "./kmd-service.js";

// Store the current markdown content
let currentMarkdown = "";

// Listen for markdown updates from the editor
window.addEventListener("markdown-updated", (event) => {
    currentMarkdown = event.detail.markdown || "";
});

window.addEventListener("DOMContentLoaded", async () => {
    // Initialize profile settings UI
    initProfileSettings();

    // Initialize conflict UI
    initConflictUI();

    // KMD file operations
    const exportKmdBtn = document.getElementById("export-kmd-btn");
    const importKmdBtn = document.getElementById("import-kmd-btn");
    const exportMdBtn = document.getElementById("export-md-btn");

    if (exportKmdBtn) {
        exportKmdBtn.addEventListener("click", async () => {
            try {
                const result = await exportDocument();
                if (result) {
                    console.log("Exported to:", result.path);
                    console.log("Document metadata:", result.meta);
                    // Could show success notification here
                }
            } catch (err) {
                console.error("Export failed:", err);
                alert("Export failed: " + err);
            }
        });
    }

    if (importKmdBtn) {
        importKmdBtn.addEventListener("click", async () => {
            try {
                const meta = await importDocument();
                if (meta) {
                    console.log("Imported document:", meta.title);
                    // Reload to apply the imported Yjs state.
                    // TODO: In the future, consider implementing a more graceful
                    // refresh mechanism that reinitializes Yjs without full page reload.
                    // This would preserve UI state better, but requires careful handling
                    // of the Yjs document merge and editor re-sync.
                    location.reload();
                }
            } catch (err) {
                console.error("Import failed:", err);
                alert("Import failed: " + err);
            }
        });
    }

    if (exportMdBtn) {
        exportMdBtn.addEventListener("click", async () => {
            try {
                const path = await exportAsMarkdown(currentMarkdown);
                if (path) {
                    console.log("Exported Markdown to:", path);
                    // Could show success notification here
                }
            } catch (err) {
                console.error("Markdown export failed:", err);
                alert("Markdown export failed: " + err);
            }
        });
    }

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
