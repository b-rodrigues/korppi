// src/components/formatting-toolbar.js
// Dense formatting toolbar that integrates with Milkdown/ProseMirror

import { editorViewCtx } from "@milkdown/core";
import { toggleMark } from "@milkdown/prose/commands";

let editorInstance = null;

/**
 * Initialize the formatting toolbar
 * @param {Object} editor - The Milkdown editor instance
 */
export function initFormattingToolbar(editor) {
    editorInstance = editor;

    const toolbar = document.querySelector('.format-toolbar');
    if (!toolbar) return;

    // Define format buttons - mark commands use ProseMirror toggleMark
    const buttons = [
        { id: 'bold', icon: 'B', title: 'Bold (Ctrl+B)', markName: 'strong' },
        { id: 'italic', icon: 'I', title: 'Italic (Ctrl+I)', markName: 'em', style: 'font-style: italic;' },
        { id: 'strike', icon: 'S', title: 'Strikethrough', markName: 'strikethrough', style: 'text-decoration: line-through;' },
        { type: 'separator' },
        { id: 'h1', icon: 'H1', title: 'Heading 1', notImplemented: true },
        { id: 'h2', icon: 'H2', title: 'Heading 2', notImplemented: true },
        { id: 'h3', icon: 'H3', title: 'Heading 3', notImplemented: true },
        { type: 'separator' },
        { id: 'bullet', icon: '•', title: 'Bullet List', notImplemented: true },
        { id: 'number', icon: '1.', title: 'Numbered List', notImplemented: true },
        { type: 'separator' },
        { id: 'quote', icon: '"', title: 'Block Quote', notImplemented: true },
        { id: 'code', icon: '<>', title: 'Code Block', notImplemented: true },
        { id: 'link', icon: '🔗', title: 'Insert Link', notImplemented: true },
    ];

    toolbar.innerHTML = '';

    buttons.forEach(btn => {
        if (btn.type === 'separator') {
            const sep = document.createElement('div');
            sep.className = 'format-separator';
            toolbar.appendChild(sep);
        } else {
            const button = document.createElement('button');
            button.className = 'format-btn';
            button.id = `format-${btn.id}`;
            button.title = btn.title;
            button.innerHTML = `<span style="${btn.style || ''}">${btn.icon}</span>`;

            if (btn.markName) {
                button.addEventListener('click', (e) => {
                    e.preventDefault();
                    toggleMarkCommand(btn.markName);
                });
            } else if (btn.notImplemented) {
                button.addEventListener('click', () => {
                    console.log(`${btn.title} not yet implemented`);
                });
                button.style.opacity = '0.5';
            }
            toolbar.appendChild(button);
        }
    });
}

/**
 * Toggle a mark (bold, italic, etc.) using ProseMirror's toggleMark command
 * @param {string} markName - The mark type name ('strong', 'em', etc.)
 */
function toggleMarkCommand(markName) {
    if (!editorInstance) {
        console.warn('Editor not initialized');
        return;
    }

    editorInstance.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;

        // Get the mark type from the schema
        const markType = state.schema.marks[markName];
        if (!markType) {
            console.warn(`Mark type "${markName}" not found in schema`);
            return;
        }

        // Execute the toggleMark command
        const cmd = toggleMark(markType);
        cmd(state, dispatch);

        // Keep focus on the editor
        view.focus();
    });
}

/**
 * Update formatting toolbar to show editor instance 
 */
export function setEditorInstance(editor) {
    editorInstance = editor;
}
