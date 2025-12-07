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
    console.log("Formatting toolbar initialized with editor:", !!editor);

    const toolbar = document.querySelector('.format-toolbar');
    if (!toolbar) return;

    // Define format buttons - mark commands use ProseMirror toggleMark
    // Note: mark names must match the schema (commonmark + GFM): emphasis, strong, inlineCode, link, strikethrough
    const buttons = [
        { id: 'bold', icon: 'B', title: 'Bold (Ctrl+B)', markName: 'strong' },
        { id: 'italic', icon: 'I', title: 'Italic (Ctrl+I)', markName: 'emphasis', style: 'font-style: italic;' },
        { id: 'strike', icon: 'S', title: 'Strikethrough', markName: 'strike_through', style: 'text-decoration: line-through;' },
        { id: 'code', icon: '`', title: 'Inline Code', markName: 'inlineCode', style: 'font-family: monospace;' },
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
                // Use mousedown to prevent stealing focus from editor
                button.addEventListener('mousedown', (e) => {
                    e.preventDefault(); // Prevent focus change
                    console.log(`Format button clicked: ${btn.markName}`);
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
    console.log("toggleMarkCommand called with:", markName);
    console.log("editorInstance:", !!editorInstance);

    if (!editorInstance) {
        console.warn('Editor not initialized');
        return;
    }

    try {
        editorInstance.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            console.log("Got view:", !!view);

            const { state, dispatch } = view;
            console.log("Selection:", state.selection.from, "-", state.selection.to);

            // Get the mark type from the schema
            const markType = state.schema.marks[markName];
            if (!markType) {
                console.warn(`Mark type "${markName}" not found in schema`);
                console.log("Available marks:", Object.keys(state.schema.marks));
                return;
            }
            console.log("Found mark type:", markName);

            // Execute the toggleMark command
            const cmd = toggleMark(markType);
            const result = cmd(state, dispatch);
            console.log("Command result:", result);

            // Keep focus on the editor
            view.focus();
        });
    } catch (err) {
        console.error("Error in toggleMarkCommand:", err);
    }
}

/**
 * Update formatting toolbar to show editor instance 
 */
export function setEditorInstance(editor) {
    editorInstance = editor;
}
