import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getActiveDocumentId } from "./document-manager.js";
import { getEditorContent } from "./editor.js";

/**
 * Start reconciliation process
 */
export async function startReconciliation() {
    const docId = getActiveDocumentId();
    if (!docId) {
        alert("No active document. Please create or open a document first.");
        return;
    }

    // Save current state before importing (for reset functionality)
    const currentContent = getEditorContent();
    localStorage.setItem('reconciliation-snapshot', currentContent);

    // Let user pick one or more .kmd files
    const selectedPaths = await open({
        title: "Select Korppi Document(s) to Reconcile",
        multiple: true,
        directory: false,
        filters: [{
            name: "Korppi Document",
            extensions: ["kmd"]
        }]
    });

    if (!selectedPaths || selectedPaths.length === 0) {
        return; // User cancelled
    }

    try {
        // Import patches from each selected file
        for (const sourcePath of selectedPaths) {
            await invoke("import_patches_from_document", {
                targetDocId: docId,
                sourcePath: sourcePath
            });
        }

        const fileCount = selectedPaths.length;
        alert(`Patches imported from ${fileCount} file${fileCount > 1 ? 's' : ''} successfully! Check the timeline to review and accept them.`);

        // Refresh the timeline to show imported patches
        window.dispatchEvent(new CustomEvent('reconciliation-imported'));

    } catch (err) {
        console.error("Reconciliation failed:", err);
        alert(`Failed to import patches: ${err}`);
    }
}
