// src/components/formatting-toolbar.js
// Dense formatting toolbar that integrates with Milkdown/ProseMirror

import { editorViewCtx } from "@milkdown/core";
import { toggleMark } from "@milkdown/prose/commands";
import { setBlockType, wrapIn, lift } from "@milkdown/prose/commands";
import { wrapInList } from "@milkdown/prose/schema-list";
import { registerFigure, figureRegistry, sectionRegistry, tableRegistry, getReferenceText } from "../milkdown-figure.js";

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
        { id: 'underline', icon: 'U', title: 'Underline (Ctrl+U)', markName: 'underline', style: 'text-decoration: underline;' },
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
        { id: 'figure', icon: '🖼️', title: 'Insert Image', action: 'figure' },
        { id: 'crossref', icon: '§', title: 'Insert Cross-Reference', action: 'crossref' },
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
                } else if (btn.action === 'figure') {
                    insertFigureCommand();
                } else if (btn.action === 'crossref') {
                    insertCrossRefCommand();
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

    // Listen for insert requests from context menu
    window.addEventListener('insert-table-request', () => insertTableCommand());
    window.addEventListener('insert-image-request', () => insertFigureCommand());
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
 * Insert a table - shows dialog for rows/columns/caption/label
 */
function insertTableCommand() {
    if (!editorInstance) return;

    // Show table dialog
    showTableDialog((numRows, numCols, caption, label) => {
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

            let tr = state.tr;
            let insertPos = from;

            // Add caption and label BEFORE the table if provided
            if (caption || label) {
                // Build caption text: "Caption text {#tbl:label}"
                let captionParts = [];

                if (caption) {
                    captionParts.push(caption);
                }

                if (label) {
                    // Add label syntax
                    if (caption) {
                        captionParts.push(` {#${label}}`);
                    } else {
                        captionParts.push(`{#${label}}`);
                    }
                    // Register the table for cross-referencing
                    registerFigure(label);
                }

                const captionText = captionParts.join('');
                if (captionText && paragraphType) {
                    const captionParagraph = paragraphType.create(null, schema.text(captionText));
                    tr = tr.insert(insertPos, captionParagraph);
                    insertPos += captionParagraph.nodeSize;
                }
            }

            // Insert the table after the caption
            tr = tr.insert(insertPos, tableNode);

            dispatch(tr);
            view.focus();
        });
    });
}

/**
 * Show table dialog for rows/columns/caption/label
 */
function showTableDialog(callback) {
    // Get next available table number for suggestion
    const nextNum = tableRegistry.size + 1;
    const suggestedLabel = `tbl:table${nextNum}`;

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.style.display = 'flex';

    overlay.innerHTML = `
        <div class="modal-content" style="max-width: 350px;">
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
                <hr style="margin: 12px 0; border: none; border-top: 1px solid var(--border-color);">
                <div class="form-group">
                    <label for="table-caption">Caption (optional):</label>
                    <input type="text" id="table-caption" placeholder="e.g., Sales data for Q4" style="width: 100%;">
                </div>
                <div class="form-group">
                    <label for="table-label">Label for cross-references (optional):</label>
                    <input type="text" id="table-label" value="${suggestedLabel}" style="width: 100%;">
                    <small style="color: var(--text-muted);">Use @${suggestedLabel} to reference this table</small>
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
    const captionInput = overlay.querySelector('#table-caption');
    const labelInput = overlay.querySelector('#table-label');
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
        const caption = captionInput.value.trim();
        let label = labelInput.value.trim();

        // Ensure label has tbl: prefix if provided
        if (label && !label.startsWith('tbl:')) {
            label = 'tbl:' + label;
        }

        cleanup();
        callback(
            Math.max(2, Math.min(20, rows)),
            Math.max(1, Math.min(10, cols)),
            caption,
            label
        );
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
    captionInput.addEventListener('keydown', handleKeydown);
    labelInput.addEventListener('keydown', handleKeydown);

    // Close on overlay click
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup();
    });
}

/**
 * Insert an image/figure with optional caption and label
 */
function insertFigureCommand() {
    if (!editorInstance) return;

    showFigureDialog((url, caption, label) => {
        editorInstance.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { state, dispatch } = view;
            const { from } = state.selection;
            const schema = state.schema;

            // Get the image node type from schema
            const imageType = schema.nodes.image;
            const figureType = schema.nodes.figure;
            const paragraphType = schema.nodes.paragraph;

            if (!imageType) {
                console.warn("Image node type not found in schema");
                view.focus();
                return;
            }

            let tr = state.tr;

            if (label && figureType) {
                // Insert as a figure with label for cross-referencing
                registerFigure(label);
                const imageNode = imageType.create({
                    src: url,
                    alt: caption || 'Figure'
                });
                const figureNode = figureType.create(
                    { label, caption: caption || '' },
                    imageNode
                );
                tr = tr.insert(from, figureNode);
            } else {
                // Insert as a simple image (optionally with alt text as caption)
                const imageNode = imageType.create({
                    src: url,
                    alt: caption || ''
                });

                // Images need to be inside a paragraph in most schemas
                if (paragraphType) {
                    const para = paragraphType.create(null, imageNode);
                    tr = tr.insert(from, para);
                } else {
                    tr = tr.insert(from, imageNode);
                }
            }

            dispatch(tr);
            view.focus();
        });
    });
}

/**
 * Show dialog for inserting a figure/image
 */
function showFigureDialog(callback) {
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.style.display = 'flex';

    // Get next available figure number for suggestion
    const nextNum = figureRegistry.size + 1;
    const suggestedLabel = `fig:figure${nextNum}`;

    overlay.innerHTML = `
        <div class="modal-content" style="max-width: 450px;">
            <div class="modal-header">
                <h2>Insert Image</h2>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="figure-url">Image source:</label>
                    <div style="display: flex; gap: 8px;">
                        <input type="text" id="figure-url" placeholder="URL or file path" style="flex: 1;">
                        <button type="button" id="figure-browse" class="btn-secondary" style="white-space: nowrap;">Browse...</button>
                    </div>
                </div>
                <hr style="margin: 12px 0; border: none; border-top: 1px solid var(--border-color);">
                <div class="form-group">
                    <label for="figure-caption">Caption (optional):</label>
                    <input type="text" id="figure-caption" placeholder="Description of the image" style="width: 100%;">
                </div>
                <div class="form-group">
                    <label for="figure-label">Label for cross-references (optional):</label>
                    <input type="text" id="figure-label" value="${suggestedLabel}" style="width: 100%;">
                    <small style="color: var(--text-muted);">Use @${suggestedLabel} to reference this image</small>
                </div>
            </div>
            <div class="modal-footer">
                <button id="figure-cancel" class="btn-secondary">Cancel</button>
                <button id="figure-insert" class="btn-primary">Insert</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const urlInput = overlay.querySelector('#figure-url');
    const browseBtn = overlay.querySelector('#figure-browse');
    const captionInput = overlay.querySelector('#figure-caption');
    const labelInput = overlay.querySelector('#figure-label');
    const insertBtn = overlay.querySelector('#figure-insert');
    const cancelBtn = overlay.querySelector('#figure-cancel');

    urlInput.focus();

    const cleanup = () => {
        document.body.removeChild(overlay);
    };

    // File browser using Tauri's dialog
    browseBtn.addEventListener('click', async () => {
        try {
            const { open } = await import('@tauri-apps/plugin-dialog');
            const selected = await open({
                multiple: false,
                filters: [{
                    name: 'Images',
                    extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp']
                }]
            });

            if (selected) {
                // Convert the file path to an asset URL that Tauri can serve
                const { convertFileSrc } = await import('@tauri-apps/api/core');
                const assetUrl = convertFileSrc(selected);
                urlInput.value = assetUrl;
            }
        } catch (err) {
            console.error('File browser error:', err);
        }
    });

    insertBtn.addEventListener('click', () => {
        const url = urlInput.value.trim();
        const caption = captionInput.value.trim();
        let label = labelInput.value.trim();

        if (!url) {
            urlInput.focus();
            return;
        }

        // Ensure label has fig: prefix if provided
        if (label && !label.startsWith('fig:')) {
            label = 'fig:' + label;
        }

        cleanup();
        callback(url, caption, label);
    });

    cancelBtn.addEventListener('click', cleanup);

    const handleKeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            insertBtn.click();
        } else if (e.key === 'Escape') {
            cleanup();
        }
    };

    urlInput.addEventListener('keydown', handleKeydown);
    captionInput.addEventListener('keydown', handleKeydown);
    labelInput.addEventListener('keydown', handleKeydown);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cleanup();
    });
}

/**
 * Insert a cross-reference (figure, section, or table)
 */
function insertCrossRefCommand() {
    if (!editorInstance) return;

    // Get all available references
    const figures = Array.from(figureRegistry.entries()).map(([label, num]) => ({
        label,
        num,
        type: 'Figure'
    }));
    const sections = Array.from(sectionRegistry.entries()).map(([label, num]) => ({
        label,
        num,
        type: 'Section'
    }));
    const tables = Array.from(tableRegistry.entries()).map(([label, num]) => ({
        label,
        num,
        type: 'Table'
    }));

    const allRefs = [...figures, ...sections, ...tables];

    if (allRefs.length === 0) {
        alert('No labeled elements found in the document.\n\nTo create labels:\n- Figures: ![Caption](url){#fig:label}\n- Sections: # Heading {#sec:label}\n- Tables: Add {#tbl:label} after your table');
        return;
    }

    showCrossRefDialog(allRefs, (label) => {
        editorInstance.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const { state, dispatch } = view;
            const { from } = state.selection;

            // Insert the reference syntax
            const refText = `@${label}`;
            const tr = state.tr.insertText(refText, from);
            dispatch(tr);
            view.focus();
        });
    });
}

/**
 * Show dialog for selecting a cross-reference
 */
function showCrossRefDialog(refs, callback) {
    const overlay = document.createElement('div');
    overlay.className = 'modal';
    overlay.style.display = 'flex';

    // Group references by type
    const figureOptions = refs
        .filter(r => r.type === 'Figure')
        .map(r => `<option value="${r.label}">Figure ${r.num} (${r.label})</option>`)
        .join('');
    const sectionOptions = refs
        .filter(r => r.type === 'Section')
        .map(r => `<option value="${r.label}">Section ${r.num} (${r.label})</option>`)
        .join('');
    const tableOptions = refs
        .filter(r => r.type === 'Table')
        .map(r => `<option value="${r.label}">Table ${r.num} (${r.label})</option>`)
        .join('');

    overlay.innerHTML = `
        <div class="modal-content" style="max-width: 400px;">
            <div class="modal-header">
                <h2>Insert Cross-Reference</h2>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="crossref-select">Select reference:</label>
                    <select id="crossref-select" style="width: 100%;">
                        ${figureOptions ? `<optgroup label="Figures">${figureOptions}</optgroup>` : ''}
                        ${sectionOptions ? `<optgroup label="Sections">${sectionOptions}</optgroup>` : ''}
                        ${tableOptions ? `<optgroup label="Tables">${tableOptions}</optgroup>` : ''}
                    </select>
                </div>
                <div class="form-group">
                    <small style="color: var(--text-muted);">Or type a label manually:</small>
                    <input type="text" id="crossref-manual" placeholder="fig:label, sec:label, or tbl:label" style="width: 100%; margin-top: 4px;">
                </div>
            </div>
            <div class="modal-footer">
                <button id="crossref-cancel" class="btn-secondary">Cancel</button>
                <button id="crossref-insert" class="btn-primary">Insert</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const selectEl = overlay.querySelector('#crossref-select');
    const manualInput = overlay.querySelector('#crossref-manual');
    const insertBtn = overlay.querySelector('#crossref-insert');
    const cancelBtn = overlay.querySelector('#crossref-cancel');

    selectEl.focus();

    const cleanup = () => {
        document.body.removeChild(overlay);
    };

    insertBtn.addEventListener('click', () => {
        let label = manualInput.value.trim() || selectEl.value;

        if (!label) {
            selectEl.focus();
            return;
        }

        // Validate label format
        if (!label.match(/^(fig|sec|tbl):/)) {
            alert('Label must start with fig:, sec:, or tbl:');
            manualInput.focus();
            return;
        }

        cleanup();
        callback(label);
    });

    cancelBtn.addEventListener('click', cleanup);

    const handleKeydown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            insertBtn.click();
        } else if (e.key === 'Escape') {
            cleanup();
        }
    };

    selectEl.addEventListener('keydown', handleKeydown);
    manualInput.addEventListener('keydown', handleKeydown);

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

/**
 * Toggle bold formatting (exported for keyboard shortcuts)
 */
export function toggleBold() {
    toggleMarkCommand('strong');
}

/**
 * Toggle italic formatting (exported for keyboard shortcuts)
 */
export function toggleItalic() {
    toggleMarkCommand('emphasis');
}

/**
 * Toggle underline formatting (exported for keyboard shortcuts)
 */
export function toggleUnderline() {
    toggleMarkCommand('underline');
}

/**
 * Toggle strikethrough formatting (exported for keyboard shortcuts)
 */
export function toggleStrikethrough() {
    toggleMarkCommand('strike_through');
}
