// src/kmd-service.js
// Service for KMD (Korppi Markdown Document) file operations

import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";

/**
 * Export the current document as a KMD file.
 * Opens a file save dialog and exports the document.
 * @returns {Promise<{path: string, meta: Object}|null>} Export result or null if cancelled
 */
export async function exportDocument() {
    const path = await save({
        filters: [{ name: 'Korppi Document', extensions: ['kmd'] }],
        defaultPath: 'document.kmd'
    });

    if (path) {
        const meta = await invoke("export_kmd", { path });
        return { path, meta };
    }
    return null;
}

/**
 * Import a KMD file into the current document.
 * Opens a file open dialog and imports the document.
 * @returns {Promise<Object|null>} Document metadata or null if cancelled
 */
export async function importDocument() {
    const path = await open({
        filters: [{ name: 'Korppi Document', extensions: ['kmd'] }],
        multiple: false
    });

    if (path) {
        const meta = await invoke("import_kmd", { path });
        return meta;
    }
    return null;
}

/**
 * Export the document as a plain Markdown file.
 * Gets the current editor content and saves it.
 * @param {string} markdownContent - The markdown content to export
 * @returns {Promise<string|null>} Export path or null if cancelled
 */
export async function exportAsMarkdown(markdownContent) {
    const path = await save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        defaultPath: 'document.md'
    });

    if (path) {
        await invoke("export_markdown", { path, content: markdownContent });
        return path;
    }
    return null;
}

/**
 * Export the document as a DOCX file.
 * Gets the current editor content and converts it to DOCX format.
 * Requires pandoc for proper conversion - shows warning if not available.
 * @param {string} markdownContent - The markdown content to export
 * @returns {Promise<string|null>} Export path or null if cancelled
 */
export async function exportAsDocx(markdownContent) {
    // Check if pandoc is available
    const hasPandoc = await invoke("check_pandoc_available");

    if (!hasPandoc) {
        // Show warning dialog about pandoc requirement
        const shouldContinue = await showPandocWarningDialog();
        if (!shouldContinue) {
            return null;
        }
    }

    const path = await save({
        filters: [{ name: 'Word Document', extensions: ['docx'] }],
        defaultPath: 'document.docx'
    });

    if (path) {
        await invoke("export_docx", { path, content: markdownContent });
        return path;
    }
    return null;
}

/**
 * Show a warning dialog when pandoc is not installed.
 * Provides link to download pandoc.
 * @returns {Promise<boolean>} true if user wants to continue without pandoc, false to cancel
 */
async function showPandocWarningDialog() {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal';
        overlay.style.display = 'flex';
        overlay.innerHTML = `
            <div class="modal-content" style="max-width: 450px;">
                <div class="modal-header">
                    <h2>⚠️ Pandoc Not Found</h2>
                </div>
                <div class="modal-body">
                    <p><strong>Pandoc</strong> is required for exporting documents with proper formatting.</p>
                    <p>Without Pandoc, the export will contain only plain text without formatting, images, or tables.</p>
                    <p style="margin-top: 12px;">
                        <a href="#" id="pandoc-download-link" style="color: var(--accent-color); text-decoration: underline;">
                            📥 Download Pandoc from pandoc.org
                        </a>
                    </p>
                </div>
                <div class="modal-footer">
                    <button id="pandoc-cancel" class="btn-secondary">Cancel Export</button>
                    <button id="pandoc-continue" class="btn-primary">Export Anyway</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const downloadLink = overlay.querySelector('#pandoc-download-link');
        const cancelBtn = overlay.querySelector('#pandoc-cancel');
        const continueBtn = overlay.querySelector('#pandoc-continue');

        const cleanup = () => document.body.removeChild(overlay);

        downloadLink.addEventListener('click', async (e) => {
            e.preventDefault();
            // Open the pandoc installation page in the default browser
            await invoke("open_url", { url: "https://pandoc.org/installing.html" });
        });

        continueBtn.addEventListener('click', () => {
            cleanup();
            resolve(true);
        });

        cancelBtn.addEventListener('click', () => {
            cleanup();
            resolve(false);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                cleanup();
                resolve(false);
            }
        });

        overlay.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                cleanup();
                resolve(false);
            }
        });
    });
}

/**
 * Get current document metadata.
 * @returns {Promise<Object>} Document metadata
 */
export async function getDocumentMeta() {
    return await invoke("get_document_meta");
}

/**
 * Update the document title.
 * @param {string} title - New document title
 * @returns {Promise<void>}
 */
export async function setDocumentTitle(title) {
    return await invoke("set_document_title", { title });
}

/**
 * Write text content to a file.
 * @param {string} path - File path
 * @param {string} content - Text content
 * @returns {Promise<void>}
 */
export async function writeTextFile(path, content) {
    return await invoke("write_text_file", { path, content });
}
