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
