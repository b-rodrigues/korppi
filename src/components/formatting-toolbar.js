// src/components/formatting-toolbar.js
// Dense formatting toolbar that integrates with Milkdown/ProseMirror

import { editorViewCtx } from "@milkdown/core";
import { toggleMark } from "@milkdown/prose/commands";
import { setBlockType, wrapIn, lift } from "@milkdown/prose/commands";
import { wrapInList } from "@milkdown/prose/schema-list";

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

    // Define format buttons
    // markName = inline mark (toggleMark)
    // nodeType = block type (setBlockType for headings)
    // listType = list node (wrapInList for lists)
    // wrapType = wrapper node (wrapIn for blockquote)
    const buttons = [
        // Inline marks
        { id: 'bold', icon: 'B', title: 'Bold (Ctrl+B)', markName: 'strong' },
        { id: 'italic', icon: 'I', title: 'Italic (Ctrl+I)', markName: 'emphasis', style: 'font-style: italic;' },
        { id: 'strike', icon: 'S', title: 'Strikethrough', markName: 'strike_through', style: 'text-decoration: line-through;' },
        { id: 'code', icon: '`', title: 'Inline Code', markName: 'inlineCode', style: 'font-family: monospace;' },
        { type: 'separator' },
        // Block types (headings)
        { id: 'h1', icon: 'H1', title: 'Heading 1', nodeType: 'heading', attrs: { level: 1 } },
        { id: 'h2', icon: 'H2', title: 'Heading 2', nodeType: 'heading', attrs: { level: 2 } },
        { id: 'h3', icon: 'H3', title: 'Heading 3', nodeType: 'heading', attrs: { level: 3 } },
        { id: 'paragraph', icon: '¶', title: 'Normal Paragraph', nodeType: 'paragraph' },
        { type: 'separator' },
        // Lists
        { id: 'bullet', icon: '•', title: 'Bullet List', listType: 'bullet_list' },
        { id: 'number', icon: '1.', title: 'Numbered List', listType: 'ordered_list' },
        { type: 'separator' },
        // Wrappers
        { id: 'quote', icon: '"', title: 'Block Quote', wrapType: 'blockquote' },
        { id: 'codeblock', icon: '<>', title: 'Code Block', nodeType: 'code_block' },
        { type: 'separator' },
        // Link (special handling)
        { id: 'link', icon: '🔗', title: 'Insert Link', action: 'link' },
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

            // Use mousedown to prevent stealing focus from editor
            button.addEventListener('mousedown', (e) => {
                e.preventDefault(); // Prevent focus change

                if (btn.markName) {
                    toggleMarkCommand(btn.markName);
                } else if (btn.nodeType) {
                    setBlockTypeCommand(btn.nodeType, btn.attrs);
                } else if (btn.listType) {
                    toggleListCommand(btn.listType);
                } else if (btn.wrapType) {
                    wrapInCommand(btn.wrapType);
                } else if (btn.action === 'link') {
                    insertLinkCommand();
                }
            });

            toolbar.appendChild(button);
        }
    });
}

/**
 * Toggle a mark (bold, italic, etc.) using ProseMirror's toggleMark command
 */
function toggleMarkCommand(markName) {
    if (!editorInstance) return;

    editorInstance.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;

        const markType = state.schema.marks[markName];
        if (!markType) {
            console.warn(`Mark type "${markName}" not found in schema`);
            return;
        }

        toggleMark(markType)(state, dispatch);
        view.focus();
    });
}

/**
 * Set block type (heading, paragraph, codeBlock)
 */
function setBlockTypeCommand(nodeTypeName, attrs = {}) {
    if (!editorInstance) return;

    editorInstance.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;

        const nodeType = state.schema.nodes[nodeTypeName];
        if (!nodeType) {
            console.warn(`Node type "${nodeTypeName}" not found in schema`);
            console.log("Available nodes:", Object.keys(state.schema.nodes));
            return;
        }

        // Check if we're already in this block type - if so, convert to paragraph
        const { $from } = state.selection;
        const currentNode = $from.parent;

        if (nodeTypeName === 'heading' && currentNode.type.name === 'heading' && currentNode.attrs.level === attrs.level) {
            // Already a heading of this level - convert to paragraph
            const paragraphType = state.schema.nodes.paragraph;
            if (paragraphType) {
                setBlockType(paragraphType)(state, dispatch);
            }
        } else {
            setBlockType(nodeType, attrs)(state, dispatch);
        }

        view.focus();
    });
}

/**
 * Toggle list (bullet or ordered)
 */
function toggleListCommand(listTypeName) {
    if (!editorInstance) return;

    editorInstance.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;

        const listType = state.schema.nodes[listTypeName];
        const listItemType = state.schema.nodes.listItem;

        if (!listType) {
            console.warn(`List type "${listTypeName}" not found in schema`);
            console.log("Available nodes:", Object.keys(state.schema.nodes));
            return;
        }

        // Check if we're already in a list - if so, lift out
        const { $from } = state.selection;
        let inList = false;
        for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type === listType) {
                inList = true;
                break;
            }
        }

        if (inList) {
            // Already in this list type - lift out
            lift(state, dispatch);
        } else {
            // Wrap in list
            wrapInList(listType)(state, dispatch);
        }

        view.focus();
    });
}

/**
 * Wrap in blockquote
 */
function wrapInCommand(wrapTypeName) {
    if (!editorInstance) return;

    editorInstance.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;

        const wrapType = state.schema.nodes[wrapTypeName];
        if (!wrapType) {
            console.warn(`Node type "${wrapTypeName}" not found in schema`);
            console.log("Available nodes:", Object.keys(state.schema.nodes));
            return;
        }

        // Check if we're already in a blockquote - if so, lift out
        const { $from } = state.selection;
        let inWrap = false;
        for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type === wrapType) {
                inWrap = true;
                break;
            }
        }

        if (inWrap) {
            lift(state, dispatch);
        } else {
            wrapIn(wrapType)(state, dispatch);
        }

        view.focus();
    });
}

/**
 * Insert link - prompts for URL
 */
function insertLinkCommand() {
    if (!editorInstance) return;

    editorInstance.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;

        // Check if there's a selection
        const { from, to } = state.selection;
        if (from === to) {
            alert("Please select some text to create a link");
            view.focus();
            return;
        }

        // Prompt for URL
        const url = prompt("Enter URL:");
        if (!url) {
            view.focus();
            return;
        }

        // Get the link mark type
        const linkType = state.schema.marks.link;
        if (!linkType) {
            console.warn("Link mark type not found in schema");
            view.focus();
            return;
        }

        // Apply link mark to selection
        const tr = state.tr.addMark(from, to, linkType.create({ href: url }));
        dispatch(tr);
        view.focus();
    });
}

/**
 * Update formatting toolbar to show editor instance 
 */
export function setEditorInstance(editor) {
    editorInstance = editor;
}
