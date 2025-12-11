// src/components/editor-mode-toggle.js
// Toggle between rendered markdown (WYSIWYG) and raw markdown view

import { getMarkdown, setMarkdownContent } from "../editor.js";

const MODE_KEY = 'korppi-editor-mode';

let currentMode = 'rendered'; // 'rendered' or 'raw'

/**
 * Initialize editor mode toggle
 */
export function initEditorModeToggle() {
    // Load saved mode preference
    const savedMode = localStorage.getItem(MODE_KEY);
    if (savedMode === 'raw') {
        currentMode = 'raw';
        applyMode('raw');
    }

    // Set up toggle button
    const toggleBtn = document.getElementById('editor-mode-toggle');
    if (toggleBtn) {
        updateToggleButton(toggleBtn, currentMode);
        toggleBtn.addEventListener('click', () => {
            const newMode = currentMode === 'rendered' ? 'raw' : 'rendered';
            setMode(newMode);
            updateToggleButton(toggleBtn, newMode);
        });
    }
}

/**
 * Set the editor mode
 */
export function setMode(mode) {
    if (mode === currentMode) return;

    const editorEl = document.getElementById('editor');
    const rawEditorEl = document.getElementById('raw-editor');

    if (!editorEl || !rawEditorEl) return;

    if (mode === 'raw') {
        // Switching to raw mode: get current markdown and show in textarea
        const markdown = getMarkdown();
        rawEditorEl.value = markdown;
        editorEl.style.display = 'none';
        rawEditorEl.style.display = 'block';
        rawEditorEl.focus();
    } else {
        // Switching to rendered mode: apply raw content back to editor
        const rawContent = rawEditorEl.value;
        rawEditorEl.style.display = 'none';
        editorEl.style.display = 'block';
        setMarkdownContent(rawContent);
    }

    currentMode = mode;
    localStorage.setItem(MODE_KEY, mode);

    // Dispatch event for other components
    window.dispatchEvent(new CustomEvent('editor-mode-changed', { detail: { mode } }));
}

/**
 * Get current editor mode
 */
export function getMode() {
    return currentMode;
}

/**
 * Apply mode without syncing content (used on init)
 */
function applyMode(mode) {
    const editorEl = document.getElementById('editor');
    const rawEditorEl = document.getElementById('raw-editor');

    if (!editorEl || !rawEditorEl) return;

    if (mode === 'raw') {
        editorEl.style.display = 'none';
        rawEditorEl.style.display = 'block';
    } else {
        rawEditorEl.style.display = 'none';
        editorEl.style.display = 'block';
    }
}

/**
 * Update toggle button appearance
 */
function updateToggleButton(btn, mode) {
    btn.innerHTML = mode === 'rendered'
        ? '<span class="icon">📄</span><span class="label">Raw</span>'
        : '<span class="icon">✨</span><span class="label">Rich</span>';
    btn.title = mode === 'rendered' ? 'Switch to raw markdown view' : 'Switch to rich text view';
}

/**
 * Sync raw editor content when document changes (for document switching)
 */
export function syncRawEditor() {
    if (currentMode === 'raw') {
        const rawEditorEl = document.getElementById('raw-editor');
        if (rawEditorEl) {
            rawEditorEl.value = getMarkdown();
        }
    }
}
