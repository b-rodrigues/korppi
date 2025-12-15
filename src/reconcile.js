import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { getActiveDocumentId } from "./document-manager.js";
import { getMarkdown } from "./editor.js";
import { showRightSidebar } from "./components/sidebar-controller.js";

// In-memory storage for computed hunks during reconciliation
let reconciliationHunks = [];

/**
 * Get the current reconciliation hunks
 * @returns {Array} Array of AuthoredHunk objects
 */
export function getReconciliationHunks() {
    return reconciliationHunks;
}

/**
 * Clear the reconciliation hunks
 */
export function clearReconciliationHunks() {
    reconciliationHunks = [];
}

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
    const baseContent = getMarkdown();
    localStorage.setItem('reconciliation-snapshot', baseContent);

    // Save the timestamp when reconciliation started (for resetting reviews)
    const reconciliationStartTime = Date.now();
    localStorage.setItem('reconciliation-start-time', reconciliationStartTime.toString());

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

        // Fetch all patches for this document
        const patches = await invoke("list_document_patches", { id: docId }).catch(() => []);

        // Filter to only Save patches with snapshots
        const savePatchesWithSnapshots = patches.filter(p =>
            p.kind === "Save" && p.data?.snapshot
        );

        console.log(`Reconciliation: ${savePatchesWithSnapshots.length} patches with snapshots`);

        // Prepare patch data for Rust hunk calculator
        const patchInputs = savePatchesWithSnapshots.map(p => ({
            id: p.id,
            uuid: p.uuid || null,
            author: p.author,
            author_name: p.data?.authorName || p.author,
            author_color: p.data?.authorColor || '#3498db',
            timestamp: p.timestamp,
            snapshot: p.data.snapshot
        }));

        // Calculate hunks: BASE vs each PATCH
        // This is done in Rust for performance
        reconciliationHunks = await invoke("calculate_hunks_for_patches", {
            baseContent: baseContent,
            patches: patchInputs
        });

        console.log(`Reconciliation: Computed ${reconciliationHunks.length} hunks`);

        // Detailed debug output for each hunk
        console.log('=== RECONCILIATION HUNKS ===');
        for (const hunk of reconciliationHunks) {
            console.log(`\n--- Hunk ${hunk.hunk_id} ---`);
            console.log(`  Type: ${hunk.type}`);
            console.log(`  Author: ${hunk.author_name} (${hunk.author})`);
            console.log(`  Color: ${hunk.author_color}`);
            console.log(`  Base lines: ${hunk.base_start_line}-${hunk.base_end_line}`);
            console.log(`  Modified lines: ${hunk.modified_start_line}-${hunk.modified_end_line}`);
            if (hunk.base_lines && hunk.base_lines.length > 0) {
                console.log(`  Base content (${hunk.base_lines.length} lines):`);
                hunk.base_lines.forEach((line, i) => console.log(`    - "${line}"`));
            }
            if (hunk.modified_lines && hunk.modified_lines.length > 0) {
                console.log(`  Modified content (${hunk.modified_lines.length} lines):`);
                hunk.modified_lines.forEach((line, i) => console.log(`    + "${line}"`));
            }
        }
        console.log('=== END HUNKS ===');

        // Refresh the timeline to show imported patches
        window.dispatchEvent(new CustomEvent('reconciliation-imported'));

        // Auto-show the right sidebar with timeline tab
        showRightSidebar('timeline');

        // Dispatch event that hunks are ready
        window.dispatchEvent(new CustomEvent('reconciliation-hunks-ready', {
            detail: { hunks: reconciliationHunks }
        }));

    } catch (err) {
        console.error("Reconciliation failed:", err);
        alert(`Failed to import patches: ${err}`);
    }
}
