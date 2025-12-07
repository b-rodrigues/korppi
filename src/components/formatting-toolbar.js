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

    const toolbar = document.querySelector('.format-toolbar');
    if (!toolbar) return;

    // Define format buttons
    const buttons = [
        // Inline marks
        { id: 'bold', icon: 'B', title: 'Bold (Ctrl+B)', markName: 'strong' },
        { id: 'italic', icon: 'I', title: 'Italic (Ctrl+I)', markName: 'emphasis', style: 'font-style: italic;' },
        { id: 'strike', icon: 'S', title: 'Strikethrough', markName: 'strike_through', style: 'text-decoration: line-through;' },
        { id: 'code', icon: '`', title: 'Inline Code', markName: 'inlineCode', style: 'font-family: monospace;' },
        { id: 'clear', icon: '⌀', title: 'Clear Formatting', action: 'clearFormat' },
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
        // Wrappers and blocks
        { id: 'quote', icon: '"', title: 'Block Quote', wrapType: 'blockquote' },
        { id: 'codeblock', icon: '<>', title: 'Code Block', nodeType: 'code_block' },
        { id: 'hr', icon: '—', title: 'Horizontal Rule', action: 'insertHr' },
        { type: 'separator' },
        // Insert elements
        { id: 'link', icon: '🔗', title: 'Insert Link', action: 'link' },
        { id: 'image', icon: '🖼️', title: 'Insert Image', action: 'image' },
        { id: 'table', icon: '⊞', title: 'Insert Table', action: 'table' },
        { id: 'break', icon: '↵', title: 'Hard Break', action: 'hardbreak' },
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
                e.preventDefault();

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
                } else if (btn.action === 'image') {
                    insertImageCommand();
                } else if (btn.action === 'table') {
                    insertTableCommand();
                } else if (btn.action === 'hardbreak') {
                    insertHardBreakCommand();
                } else if (btn.action === 'insertHr') {
                    insertHorizontalRuleCommand();
                } else if (btn.action === 'clearFormat') {
                    clearFormattingCommand();
                }
            });

            toolbar.appendChild(button);
        }
    });
}

/**
 * Toggle a mark (bold, italic, etc.)
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
            return;
        }

        const { $from } = state.selection;
        const currentNode = $from.parent;

        if (nodeTypeName === 'heading' && currentNode.type.name === 'heading' && currentNode.attrs.level === attrs.level) {
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

        if (!listType) {
            console.warn(`List type "${listTypeName}" not found in schema`);
            return;
        }

        const { $from } = state.selection;
        let inList = false;
        for (let d = $from.depth; d > 0; d--) {
            if ($from.node(d).type === listType) {
                inList = true;
                break;
            }
        }

        if (inList) {
            lift(state, dispatch);
        } else {
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
            return;
        }

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

        const { from, to } = state.selection;
        if (from === to) {
            alert("Please select some text to create a link");
            view.focus();
            return;
        }

        const url = prompt("Enter URL:");
        if (!url) {
            view.focus();
            return;
        }

        const linkType = state.schema.marks.link;
        if (!linkType) {
            console.warn("Link mark type not found in schema");
            view.focus();
            return;
        }

        const tr = state.tr.addMark(from, to, linkType.create({ href: url }));
        dispatch(tr);
        view.focus();
    });
}

/**
 * Insert image - prompts for URL and alt text
 */
function insertImageCommand() {
    if (!editorInstance) return;

    editorInstance.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;

        const url = prompt("Enter image URL:");
        if (!url) {
            view.focus();
            return;
        }

        const alt = prompt("Enter alt text (optional):", "") || "";

        const imageType = state.schema.nodes.image;
        if (!imageType) {
            console.warn("Image node type not found in schema");
            view.focus();
            return;
        }

        const { from } = state.selection;
        const imageNode = imageType.create({ src: url, alt: alt });
        const tr = state.tr.insert(from, imageNode);
        dispatch(tr);
        view.focus();
    });
}

/**
 * Insert a table - shows dialog for rows/columns
 */
function insertTableCommand() {
    if (!editorInstance) return;

    // Show table dialog
    showTableDialog((numRows, numCols) => {
        editorInstance.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { state, dispatch } = view;
            const { from } = state.selection;
            const schema = state.schema;

            // Get table node types from schema
            const tableType = schema.nodes.table;
            const tableRowType = schema.nodes.table_row;
            const tableHeaderRowType = schema.nodes.table_header_row;
            const tableCellType = schema.nodes.table_cell;
            const tableHeaderType = schema.nodes.table_header;
            const paragraphType = schema.nodes.paragraph;

            if (!tableType || !tableRowType || !tableCellType) {
                console.warn("Table node types not found in schema");
                alert("Table insertion not supported in current editor configuration");
                view.focus();
                return;
            }

            // Helper to create cell content (paragraph with text)
            const createCellContent = (text) => {
                if (paragraphType) {
                    return paragraphType.create(null, text ? schema.text(text) : null);
                }
                return text ? schema.text(text) : null;
            };

            // Build table rows
            const rows = [];

            // Header row
            const headerCellType = tableHeaderType || tableCellType;
            const headerCells = [];
            for (let c = 0; c < numCols; c++) {
                headerCells.push(headerCellType.create(null, createCellContent(`Header ${c + 1}`)));
            }
            const headerRowNodeType = tableHeaderRowType || tableRowType;
            rows.push(headerRowNodeType.create(null, headerCells));

            // Data rows
            for (let r = 1; r < numRows; r++) {
                const cells = [];
                for (let c = 0; c < numCols; c++) {
                    const cellNum = (r - 1) * numCols + c + 1;
                    cells.push(tableCellType.create(null, createCellContent(`Cell ${cellNum}`)));
                }
                rows.push(tableRowType.create(null, cells));
            }

            // Create table node
            const tableNode = tableType.create(null, rows);

            // Insert the table
            const tr = state.tr.insert(from, tableNode);
            dispatch(tr);
            view.focus();
        });
    });
}

/**
 * Show table dialog for rows/columns
 */
function showTableDialog(callback) {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.style.display = 'flex';

    overlay.innerHTML = `
        <div class="modal-content" style="max-width: 280px;">
            <div class="modal-header">
                <h2>Insert Table</h2>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="table-rows">Rows (including header):</label>
                    <input type="number" id="table-rows" min="2" max="20" value="3" style="width: 100%;">
                </div>
                <div class="form-group">
                    <label for="table-cols">Columns:</label>
                    <input type="number" id="table-cols" min="1" max="10" value="3" style="width: 100%;">
                </div>
            </div>
            <div class="modal-footer">
                <button id="table-cancel" class="btn-secondary">Cancel</button>
                <button id="table-insert" class="btn-primary">Insert</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const rowsInput = overlay.querySelector('#table-rows');
    const colsInput = overlay.querySelector('#table-cols');
    const insertBtn = overlay.querySelector('#table-insert');
    const cancelBtn = overlay.querySelector('#table-cancel');

    // Focus rows input
    rowsInput.focus();
    rowsInput.select();

    const cleanup = () => {
        document.body.removeChild(overlay);
    };

    insertBtn.addEventListener('click', () => {
        const rows = parseInt(rowsInput.value) || 3;
        const cols = parseInt(colsInput.value) || 3;
        cleanup();
        callback(Math.max(2, Math.min(20, rows)), Math.max(1, Math.min(10, cols)));
    });

    cancelBtn.addEventListener('click', cleanup);

    // Handle Enter key
    const handleKeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            insertBtn.click();
        } else if (e.key === 'Escape') {
            cleanup();
        }
    };

    rowsInput.addEventListener('keydown', handleKeydown);
    colsInput.addEventListener('keydown', handleKeydown);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup();
    });
}


/**
 * Insert hard break (line break within paragraph)
 */
function insertHardBreakCommand() {
    if (!editorInstance) return;

    editorInstance.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;

        const hardbreakType = state.schema.nodes.hardbreak;
        if (!hardbreakType) {
            console.warn("Hardbreak node type not found in schema");
            view.focus();
            return;
        }

        const { from } = state.selection;
        const tr = state.tr.insert(from, hardbreakType.create());
        dispatch(tr);
        view.focus();
    });
}

/**
 * Insert horizontal rule
 */
function insertHorizontalRuleCommand() {
    if (!editorInstance) return;

    editorInstance.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;

        const hrType = state.schema.nodes.hr;
        if (!hrType) {
            console.warn("HR node type not found in schema");
            view.focus();
            return;
        }

        const { from } = state.selection;
        const tr = state.tr.insert(from, hrType.create());
        dispatch(tr);
        view.focus();
    });
}

/**
 * Clear all marks from selection
 */
function clearFormattingCommand() {
    if (!editorInstance) return;

    editorInstance.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const { state, dispatch } = view;

        const { from, to } = state.selection;
        if (from === to) {
            view.focus();
            return;
        }

        // Remove all marks from selection
        let tr = state.tr;
        for (const markName of Object.keys(state.schema.marks)) {
            const markType = state.schema.marks[markName];
            tr = tr.removeMark(from, to, markType);
        }
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
