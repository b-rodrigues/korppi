// src/components/formatting-toolbar.js
// Dense formatting toolbar that integrates with Milkdown

import { invoke } from "@tauri-apps/api/core";

let editorInstance = null;

/**
 * Initialize the formatting toolbar
 * @param {Object} editor - The Milkdown editor instance
 */
export function initFormattingToolbar(editor) {
    editorInstance = editor;

    const toolbar = document.querySelector('.format-toolbar');
    if (!toolbar) return;

    // Define format buttons
    const buttons = [
        { id: 'bold', icon: 'B', title: 'Bold (Ctrl+B)', command: 'toggleBold' },
        { id: 'italic', icon: 'I', title: 'Italic (Ctrl+I)', command: 'toggleItalic', style: 'font-style: italic;' },
        { id: 'strike', icon: 'S', title: 'Strikethrough', command: 'toggleStrikethrough', style: 'text-decoration: line-through;' },
        { type: 'separator' },
        { id: 'h1', icon: 'H1', title: 'Heading 1', command: 'setHeading', args: { level: 1 } },
        { id: 'h2', icon: 'H2', title: 'Heading 2', command: 'setHeading', args: { level: 2 } },
        { id: 'h3', icon: 'H3', title: 'Heading 3', command: 'setHeading', args: { level: 3 } },
        { type: 'separator' },
        { id: 'bullet', icon: '•', title: 'Bullet List', command: 'toggleBulletList' },
        { id: 'number', icon: '1.', title: 'Numbered List', command: 'toggleOrderedList' },
        { type: 'separator' },
        { id: 'quote', icon: '"', title: 'Block Quote', command: 'toggleBlockquote' },
        { id: 'code', icon: '<>', title: 'Code Block', command: 'toggleCodeBlock' },
        { id: 'link', icon: '🔗', title: 'Insert Link', command: 'insertLink' },
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
            button.addEventListener('click', () => executeCommand(btn.command, btn.args));
            toolbar.appendChild(button);
        }
    });
}

/**
 * Execute a formatting command
 */
function executeCommand(command, args) {
    if (!editorInstance) {
        console.warn('Editor not initialized');
        return;
    }

    // For now, dispatch keyboard events as Milkdown doesn't expose direct commands easily
    // This is a placeholder - actual implementation depends on Milkdown version
    const commandMap = {
        'toggleBold': () => document.execCommand('bold'),
        'toggleItalic': () => document.execCommand('italic'),
        'toggleStrikethrough': () => document.execCommand('strikethrough'),
    };

    if (commandMap[command]) {
        commandMap[command]();
    } else {
        console.log(`Command ${command} not yet implemented`);
    }
}

/**
 * Update formatting toolbar to show editor instance 
 */
export function setEditorInstance(editor) {
    editorInstance = editor;
}
