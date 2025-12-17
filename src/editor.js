// editor.js — Clean unified version

import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx } from "@milkdown/core";
import { replaceAll } from "@milkdown/utils";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { underlinePlugin } from "./milkdown-underline.js";
import { figurePlugin, rebuildFigureRegistry, resetFigureRegistry } from "./milkdown-figure.js";
// Re-export editorViewCtx so other modules can use it with the editor instance
export { editorViewCtx };
// Re-export figure registry functions for use by other modules
export { rebuildFigureRegistry, resetFigureRegistry };

import { Plugin, PluginKey, TextSelection } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import { ySyncPlugin, yUndoPlugin, undo, redo } from "y-prosemirror";
import { invoke } from "@tauri-apps/api/core";

import { ydoc, yXmlFragment, loadInitialDoc, forceSave, enablePersistence, switchDocument, loadDocumentState, isApplyingUpdate } from "./yjs-setup.js";
import { stepToSemanticPatch } from "./patch-extractor.js";
import {
    addSemanticPatches,
    flushGroup
} from "./patch-grouper.js";
import { initProfile } from "./profile-service.js";
import { getActiveDocumentId, onDocumentChange } from "./document-manager.js";
import { calculateCharDiff } from "./diff-highlighter.js";
import { stripMarkdown } from "./utils.js";

// Create a unique key for the highlight plugin
const highlightKey = new PluginKey("hunk-highlight");

/**
 * Plugin to render transient highlights for hunk hovering.
 * Now supports "Ghost Preview" (widgets for inserts, inline for deletes).
 */
const hunkHighlightPlugin = new Plugin({
    key: highlightKey,
    state: {
        init() {
            return DecorationSet ? DecorationSet.empty : null;
        },
        apply(tr, set) {
            try {
                if (!DecorationSet || !Decoration) return set;

                // map existing decorations
                set = set.map(tr.mapping, tr.doc);

                // Check for our meta action
                const action = tr.getMeta(highlightKey);
                if (action) {
                    if (action.type === 'set') {
                        // Standard Highlight (Yellow Background)
                        let to = action.to;
                        if (to > tr.doc.content.size) to = tr.doc.content.size;

                        let from = action.from;
                        if (from >= to) {
                            to = Math.min(from + 1, tr.doc.content.size);
                            if (from === to && from > 0) from = from - 1;
                        }

                        return DecorationSet.create(tr.doc, [
                            Decoration.inline(from, to, { class: 'hunk-hover-highlight' })
                        ]);
                    } else if (action.type === 'preview') {
                        // Ghost Preview
                        const decorations = [];

                        // Helper to create insert widget
                        const createInsert = (text, pos) => {
                            const safePos = Math.min(pos, tr.doc.content.size);
                            // Use side: -1 for end-of-document to ensure widget renders
                            const side = safePos >= tr.doc.content.size ? -1 : 1;
                            return Decoration.widget(safePos, (view) => {
                                const span = document.createElement('span');
                                span.className = 'ghost-insert';
                                span.textContent = text;
                                return span;
                            }, { side });
                        };

                        // Helper to create delete inline
                        const createDelete = (from, to) => {
                            if (to > tr.doc.content.size) to = tr.doc.content.size;
                            return Decoration.inline(from, to, { class: 'ghost-delete' });
                        };

                        if (action.kind === 'insert') {
                            decorations.push(createInsert(action.text, action.from));
                        } else if (action.kind === 'delete') {
                            decorations.push(createDelete(action.from, action.to));
                        } else if (action.kind === 'replace') {
                            // Replace = Delete Range + Insert Widget at end of range
                            if (action.deleteFrom !== undefined && action.deleteTo !== undefined) {
                                decorations.push(createDelete(action.deleteFrom, action.deleteTo));
                                // Insert after the deletion
                                decorations.push(createInsert(action.text, action.deleteTo));
                            }
                        }

                        return DecorationSet.create(tr.doc, decorations);

                    } else if (action.type === 'diffPreview') {
                        // Full diff preview with multiple operations
                        const decorations = [];
                        const ops = action.operations || [];

                        // Helper to create insert widget
                        const createInsertWidget = (text, pos) => {
                            const safePos = Math.min(pos, tr.doc.content.size);
                            // Use side: -1 for end-of-document to ensure widget renders
                            // (side: 1 at doc.content.size has nothing to attach after)
                            const side = safePos >= tr.doc.content.size ? -1 : 1;
                            return Decoration.widget(safePos, () => {
                                const span = document.createElement('span');
                                span.className = 'ghost-insert';
                                span.textContent = text;
                                return span;
                            }, { side });
                        };

                        // Helper to create delete inline decoration
                        const createDeleteDecoration = (from, to) => {
                            const safeFrom = Math.max(0, Math.min(from, tr.doc.content.size));
                            const safeTo = Math.max(safeFrom, Math.min(to, tr.doc.content.size));
                            if (safeFrom >= safeTo) return null;
                            return Decoration.inline(safeFrom, safeTo, { class: 'ghost-delete' });
                        };

                        for (const op of ops) {
                            if (op.type === 'add' && op.text) {
                                decorations.push(createInsertWidget(op.text, op.pos));
                            } else if (op.type === 'delete' && op.from !== undefined && op.to !== undefined) {
                                const deco = createDeleteDecoration(op.from, op.to);
                                if (deco) decorations.push(deco);
                            }
                        }

                        return DecorationSet.create(tr.doc, decorations);

                    } else if (action.type === 'clear') {
                        return DecorationSet.empty;
                    }
                }
                return set;
            } catch (err) {
                console.error("Hunk Highlight Plugin Check Failed:", err);
                return set;
            }
        }
    },
    props: {
        decorations(state) {
            return this.getState(state);
        }
    }
});

/**
 * Highlight a range in the editor (transient)
 */
export function highlightEditorRange(from, to) {
    if (editor) {
        editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const tr = view.state.tr.setMeta(highlightKey, { type: 'set', from, to });
            view.dispatch(tr);
        });
    }
}

/**
 * Clear the current highlight/preview
 */
export function clearEditorHighlight() {
    if (editor) {
        editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            const tr = view.state.tr.setMeta(highlightKey, { type: 'clear' });
            view.dispatch(tr);
        });
    }
}

/**
 * Show a full diff preview in the editor using ghost decorations.
 * @param {Array} operations - Array of {type: 'add'|'delete', text, pos, from, to}
 *   - For 'add': {type: 'add', text: string, pos: number}
 *   - For 'delete': {type: 'delete', from: number, to: number}
 */
export function showDiffPreview(operations) {
    if (!editor) return;

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const tr = view.state.tr.setMeta(highlightKey, {
            type: 'diffPreview',
            operations
        });
        view.dispatch(tr);
    });
}

/**
 * Build a mapping from character offsets (in plain text) to ProseMirror positions.
 * Returns a function that converts character offset to PM position.
 * @returns {{charToPm: function(number): number, pmText: string}}
 */
export function getCharToPmMapping() {
    if (!editor) return { charToPm: (n) => n, pmText: '' };

    let result = { charToPm: (n) => n, pmText: '' };

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const doc = view.state.doc;

        // Build arrays: charOffsets[i] = PM position for character i in extracted text
        const charOffsets = [];
        let textContent = '';

        doc.descendants((node, pos) => {
            if (node.isText) {
                for (let i = 0; i < node.text.length; i++) {
                    charOffsets.push(pos + i);
                    textContent += node.text[i];
                }
            } else if (node.isBlock && charOffsets.length > 0) {
                // Add newline for block boundaries
                // Map the newline to the position RIGHT AFTER the last character,
                // not to the start of the next block. This ensures insertions at
                // block boundaries appear at the end of the previous block's content.
                const lastCharPos = charOffsets[charOffsets.length - 1];
                charOffsets.push(lastCharPos + 1);
                textContent += '\n';
            }
            return true;
        });

        result = {
            charToPm: (charOffset) => {
                if (charOffset < 0) return 0;
                if (charOffset >= charOffsets.length) {
                    return charOffsets.length > 0 ? charOffsets[charOffsets.length - 1] + 1 : doc.content.size;
                }
                return charOffsets[charOffset];
            },
            pmText: textContent,
            docSize: doc.content.size
        };
    });

    return result;
}

/**
 * Build a robust mapping from Markdown Offsets to ProseMirror Positions.
 * Uses the serializer to map Blocks to Markdown ranges.
 * 
 * Returns: {
 *   charToPm: (mdOffset) => pmPos,
 *   blockMap: Array<{ mdStart, mdEnd, pmStart, pmEnd, text }>
 * }
 */
import { computeBlockMapping } from './mapping-logic.js';

export function getMarkdownToPmMapping() {
    if (!editor) return { charToPm: (n) => n, blockMap: [] };

    let mapping = { charToPm: (n) => n, blockMap: [] };

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const doc = view.state.doc;
        const serializer = ctx.get(serializerCtx);
        const schema = view.state.schema;

        const safeSerializer = (node) => {
            try {
                // Try direct serialization first
                return serializer(node);
            } catch (err) {
                // If direct fails (e.g. Milkdown stack interactions), try wrapping in a temporary doc
                try {
                    // Create a temp doc with just this node
                    // Note: This might add a trailing newline which standard blocks have anyway.
                    // But we want the block's own markdown.
                    const tempDoc = schema.topNodeType.create(null, node);
                    // Serialize the doc
                    let md = serializer(tempDoc);
                    // Removing trailing newline usually added by doc serialization
                    return md.trim();
                } catch (e2) {
                    console.warn("[BlockMap] Serialization completely failed for node:", node, e2);
                    throw err; // Throw original
                }
            }
        };

        // Note: We use the original serializer for the full doc because it works on doc.
        // But computeBlockMapping uses the passed serializer for individual blocks.
        // We pass safeSerializer.
        // For the "fullMarkdown" arg inside computeBlockMapping, we can just pass the doc.
        // Wait, computeBlockMapping calls serializer(doc) inside.
        // safeSerializer handles doc too (direct call).

        mapping = computeBlockMapping(doc, safeSerializer);
    });

    return mapping;
}

/**
 * Scroll the editor to make the range visible
 */
export function scrollToEditorRange(from, to) {
    if (editor) {
        editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            try {
                // Safeguard against out of bounds
                const safeFrom = Math.min(from, view.state.doc.content.size);
                // const resolved = view.state.doc.resolve(safeFrom);
                const tr = view.state.tr;

                // We want to scroll to 'safeFrom'. 
                // Creating a selection is one way, but strictly scrolling to a point 
                // can be done by ensure that point is in view.
                // We'll trust ScrollIntoView with the transaction.
                // To help it, we might need a selection change, but let's try just the flag if possible?
                // ProseMirror usually scrolls to selection.
                // Let's create a temporary selection at the target.
                const resolved = view.state.doc.resolve(safeFrom);
                tr.setSelection(TextSelection.near(resolved));
                tr.scrollIntoView();
                view.dispatch(tr);
            } catch (e) {
                console.warn("Autoscroll failed:", e);
            }
        });
    }
}

/**
 * Helper: Find best relative match for text in editor.
 * Uses Head/Tail anchoring and Gap detection to handle node boundaries robustly.
 */
/**
 * Helper: Find best relative match for text in editor.
 * Uses Head/Tail anchoring and Gap detection.
 * @param {EditorView} view
 * @param {string} text
 * @param {number} relativePos - fallback ratio
 * @param {number} [targetPmPos] - Precise PM position if available
 */
function findBestMatch(view, text, relativePos, targetPmPos) {
    if (!text) return null;

    // 1. Prepare Text
    let cleanText = text.replace(/\s+/g, ' ').trim();
    // Strip MD links/images [Text](Url) - handle empty url too
    cleanText = cleanText.replace(/!?(?:\[([^\]]*)\])\([^\)]*\)/g, '$1');
    // Strip simple formatting: * _ # ` ~ (also strikethrough)
    cleanText = cleanText.replace(/[*_#`~]/g, '');
    cleanText = cleanText.replace(/[\[\]\(\)]/g, '');
    cleanText = cleanText.trim();

    if (cleanText.length === 0) return null;

    const SnippetLen = 40;
    const searchHead = cleanText.substring(0, SnippetLen);
    const searchTail = cleanText.slice(-SnippetLen);

    const doc = view.state.doc;
    const docSize = doc.content.size;

    // 2. Build Virtual Text Stream & Candidate Map
    let virtualText = "";
    let lastEndPos = 0;

    // nodeMap: { vStart, vEnd, pmStart }
    const nodeMap = [];

    doc.descendants((node, pos) => {
        if (node.isText) {
            // Check Gap
            if (lastEndPos > 0 && pos - lastEndPos >= 2) {
                virtualText += " "; // Block boundary
            }

            const vStart = virtualText.length;
            virtualText += node.text;
            const vEnd = virtualText.length;

            nodeMap.push({ vStart, vEnd, pmStart: pos });
            lastEndPos = pos + node.nodeSize;
        }
    });

    // 6. Map Virtual Indices -> PM Positions (Moved up for use in scoring)
    const mapToPM = (vIndex) => {
        const node = nodeMap.find(n => vIndex >= n.vStart && vIndex <= n.vEnd);
        if (node) {
            const offset = vIndex - node.vStart;
            return node.pmStart + offset;
        }
        const nextNode = nodeMap.find(n => n.vStart > vIndex);
        if (nextNode) return nextNode.pmStart;
        return docSize;
    };

    // 3. Find Matches in Virtual Text
    const headMatches = [];
    let idx = virtualText.indexOf(searchHead);
    while (idx !== -1) {
        headMatches.push(idx);
        idx = virtualText.indexOf(searchHead, idx + 1);
    }

    if (headMatches.length === 0) {
        // console.warn(`[PreviewDebug] Head NOT found: "${searchHead}"`);
        return null;
    }

    // 4. Select Best Head
    // If targetPmPos is provided, sort by distance to it (converted from candidate vIndex -> PM)
    // Otherwise use estimated virtual index
    if (targetPmPos !== undefined) {
        headMatches.sort((a, b) => {
            const posA = mapToPM(a);
            const posB = mapToPM(b);
            return Math.abs(posA - targetPmPos) - Math.abs(posB - targetPmPos);
        });
    } else {
        const estimatedIndex = Math.floor(virtualText.length * relativePos);
        headMatches.sort((a, b) => Math.abs(a - estimatedIndex) - Math.abs(b - estimatedIndex));
    }

    const bestHeadIndex = headMatches[0];

    // 5. Find Tail
    let bestTailIndex = -1;
    if (cleanText.length <= SnippetLen) {
        bestTailIndex = bestHeadIndex + cleanText.length;
    } else {
        const searchStart = bestHeadIndex + cleanText.length - SnippetLen - 20;
        const tailIdx = virtualText.indexOf(searchTail, Math.max(bestHeadIndex, searchStart));

        if (tailIdx !== -1 && (tailIdx - bestHeadIndex) < cleanText.length * 1.5) {
            bestTailIndex = tailIdx + searchTail.length;
        } else {
            bestTailIndex = bestHeadIndex + cleanText.length;
        }
    }

    const fromPos = mapToPM(bestHeadIndex);
    const toPos = mapToPM(bestTailIndex);

    return { from: fromPos, to: toPos };
}

/**
 * Robust Text Finder for Highlighting.
 */
export function highlightByText(text, type, relativePos) {
    if (!editor || !text) return;

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const match = findBestMatch(view, text, relativePos);

        if (!match) return;

        let from = match.from;
        let to = match.to;

        if (type === 'point') {
            from = to;
            to = Math.min(from + 1, view.state.doc.content.size);
            if (from === to && from > 0) from = from - 1;
        }

        const tr = view.state.tr.setMeta(highlightKey, { type: 'set', from, to });
        view.dispatch(tr);
        setTimeout(() => scrollToEditorRange(from, to), 0);
    });
}

/**
 * Show Ghost Preview for a Hunk by simulating the change in plain text space.
 * NOW USES COORDINATE MAPPING instead of text search for reliability.
 * @param {string} hunkType - 'add', 'delete', or 'modify'
 * @param {number} baseStart - Start position in markdown
 * @param {number} baseEnd - End position in markdown
 * @param {string} modifiedText - Text being added (for add/mod hunks)
 * @param {string} markdownContent - The full markdown content
 * @param {string} baseText - Text being deleted/replaced (for delete/mod hunks)
 */
export function previewHunkWithDiff(hunkType, baseStart, baseEnd, modifiedText, markdownContent, baseText) {
    if (!editor) return;

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);

        // Use coordinate mapping - maps markdown offsets directly to PM positions
        const { charToPm } = getMarkdownToPmMapping();

        console.log(`[HunkPreview] Type: ${hunkType}, BaseStart: ${baseStart}, BaseEnd: ${baseEnd}`);

        const operations = [];

        if (hunkType === 'delete') {
            // Map the delete range directly
            const fromPm = charToPm(baseStart);
            const toPm = charToPm(baseEnd);

            console.log(`[HunkPreview] Delete: MD ${baseStart}-${baseEnd} -> PM ${fromPm}-${toPm}`);

            if (fromPm < toPm) {
                operations.push({
                    type: 'delete',
                    from: fromPm,
                    to: toPm
                });
            } else if (baseEnd > baseStart) {
                // Ensure at least 1 char range for non-empty deletes
                operations.push({
                    type: 'delete',
                    from: fromPm,
                    to: fromPm + 1
                });
            }
        } else if (hunkType === 'add') {
            // Map the insertion point directly
            const posPm = charToPm(baseStart);

            console.log(`[HunkPreview] Add: MD ${baseStart} -> PM ${posPm}, text: "${modifiedText.substring(0, 30)}..."`);

            operations.push({
                type: 'add',
                text: modifiedText,
                pos: posPm
            });
        } else {
            // Modify = delete + add
            const fromPm = charToPm(baseStart);
            const toPm = charToPm(baseEnd);

            console.log(`[HunkPreview] Modify: MD ${baseStart}-${baseEnd} -> PM ${fromPm}-${toPm}`);

            // Delete the old text
            if (fromPm < toPm) {
                operations.push({
                    type: 'delete',
                    from: fromPm,
                    to: toPm
                });
            }

            // Add the new text at the same position
            if (modifiedText) {
                operations.push({
                    type: 'add',
                    text: modifiedText,
                    pos: fromPm
                });
            }
        }

        console.log(`[HunkPreview] Final operations:`, operations);

        if (operations.length > 0) {
            showDiffPreview(operations);
        } else {
            console.warn(`[HunkPreview] No operations generated!`);
        }
    });
}




/**
 * Show Ghost Preview for a Hunk using direct position mapping.
 * This version takes a markdown position and converts it to PM position
 * using the same logic as renderGhostPreview.
 * @param {string} text - The text to insert, or the text being deleted.
 * @param {string} kind - 'insert', 'delete', or 'replace'
 * @param {number} markdownPos - Character position in the markdown string
 * @param {string} markdownContent - The full markdown content
 * @param {string} [deleteTextOrInsertText] - For replace: text being deleted. For insert: ignored.
 */
export function previewGhostHunkByPosition(text, kind, markdownPos, markdownContent, deleteTextOrInsertText) {
    if (!editor) return;

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);

        // Import stripMarkdown dynamically to avoid circular deps
        // Actually, we'll compute the position directly

        // Get character-to-PM-position mapping (plain text from PM)
        const { charToPm, pmText } = getCharToPmMapping();

        // Strip markdown from the content up to markdownPos to find the plain text offset
        // We need to find what plain text position corresponds to markdownPos in markdown
        const prefixMarkdown = markdownContent.substring(0, markdownPos);

        // Strip markdown from the prefix - this gives us the plain text before the insert point
        // We need stripMarkdown here - let's inline a simple version
        let prefixPlain = prefixMarkdown;
        // Remove images: ![alt](url) -> alt
        prefixPlain = prefixPlain.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
        // Remove links: [text](url) -> text
        prefixPlain = prefixPlain.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
        // Remove bold: **text** -> text
        prefixPlain = prefixPlain.replace(/\*\*([^*]+)\*\*/g, '$1');
        prefixPlain = prefixPlain.replace(/__([^_]+)__/g, '$1');
        // Remove italic (careful not to match list items)
        prefixPlain = prefixPlain.replace(/(?<![*_])\*([^*\n]+)\*(?![*])/g, '$1');
        prefixPlain = prefixPlain.replace(/(?<![_*])_([^_\n]+)_(?![_])/g, '$1');
        // Remove strikethrough
        prefixPlain = prefixPlain.replace(/~~([^~]+)~~/g, '$1');
        // Remove inline code
        prefixPlain = prefixPlain.replace(/`([^`]+)`/g, '$1');
        // Remove heading markers
        prefixPlain = prefixPlain.replace(/^(#{1,6})\s+/gm, '');
        // Remove blockquote markers
        prefixPlain = prefixPlain.replace(/^>\s*/gm, '');
        // Remove horizontal rules
        prefixPlain = prefixPlain.replace(/^[-*_]{3,}\s*$/gm, '');
        // Remove list markers
        prefixPlain = prefixPlain.replace(/^[\s]*[-*+]\s+/gm, '');
        prefixPlain = prefixPlain.replace(/^[\s]*\d+\.\s+/gm, '');
        // Normalize newlines
        prefixPlain = prefixPlain.replace(/\n{2,}/g, '\n');

        // The plain text offset is the length of the stripped prefix
        const plainOffset = prefixPlain.length;

        let from, to;
        let deleteFrom, deleteTo;

        if (kind === 'insert') {
            // Insert at the plain text offset
            const posPm = charToPm(plainOffset);
            from = posPm;
            to = posPm;
        } else if (kind === 'delete') {
            // Delete: we need the range of text being deleted
            // Strip markdown from the delete text to get its plain length
            let deleteTextPlain = text;
            deleteTextPlain = deleteTextPlain.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/\*\*([^*]+)\*\*/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/__([^_]+)__/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/(?<![*_])\*([^*\n]+)\*(?![*])/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/(?<![_*])_([^_\n]+)_(?![_])/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/~~([^~]+)~~/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/`([^`]+)`/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/^(#{1,6})\s+/gm, '');
            deleteTextPlain = deleteTextPlain.replace(/^>\s*/gm, '');
            deleteTextPlain = deleteTextPlain.replace(/^[-*_]{3,}\s*$/gm, '');
            deleteTextPlain = deleteTextPlain.replace(/^[\s]*[-*+]\s+/gm, '');
            deleteTextPlain = deleteTextPlain.replace(/^[\s]*\d+\.\s+/gm, '');
            deleteTextPlain = deleteTextPlain.replace(/\n{2,}/g, '\n');

            const fromPm = charToPm(plainOffset);
            const toPm = charToPm(plainOffset + deleteTextPlain.length);
            from = fromPm;
            to = toPm;
        } else if (kind === 'replace') {
            // Replace: delete the old text and insert new text at that position
            const deleteText = deleteTextOrInsertText;
            let deleteTextPlain = deleteText || '';
            deleteTextPlain = deleteTextPlain.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/\*\*([^*]+)\*\*/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/__([^_]+)__/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/(?<![*_])\*([^*\n]+)\*(?![*])/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/(?<![_*])_([^_\n]+)_(?![_])/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/~~([^~]+)~~/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/`([^`]+)`/g, '$1');
            deleteTextPlain = deleteTextPlain.replace(/^(#{1,6})\s+/gm, '');
            deleteTextPlain = deleteTextPlain.replace(/^>\s*/gm, '');
            deleteTextPlain = deleteTextPlain.replace(/^[-*_]{3,}\s*$/gm, '');
            deleteTextPlain = deleteTextPlain.replace(/^[\s]*[-*+]\s+/gm, '');
            deleteTextPlain = deleteTextPlain.replace(/^[\s]*\d+\.\s+/gm, '');
            deleteTextPlain = deleteTextPlain.replace(/\n{2,}/g, '\n');

            deleteFrom = charToPm(plainOffset);
            deleteTo = charToPm(plainOffset + deleteTextPlain.length);
        }

        const tr = view.state.tr.setMeta(highlightKey, {
            type: 'preview',
            kind,
            from,
            to,
            deleteFrom,
            deleteTo,
            text // text to insert
        });
        view.dispatch(tr);

        // Scroll target
        const scrollTarget = (kind === 'replace') ? deleteFrom : from;
        if (scrollTarget !== undefined) {
            setTimeout(() => scrollToEditorRange(scrollTarget, scrollTarget), 0);
        }
    });
}

/**
 * Show Ghost Preview for a Hunk
 * @param {string} text - The text to insert, or the text being deleted.
 * @param {string} kind - 'insert' or 'delete'
 * @param {number} relativePos - Position heuristic
 * @param {string} [contextOrDeleteText] - For insert: context. For replace: text to delete.
 */
export function previewGhostHunk(text, kind, relativePos, contextOrDeleteText) {
    if (!editor) return;

    // Use Serializer Map to get precise estimation
    const mapping = getMarkdownToPmMapping();
    const content = getMarkdown();
    const estimatedPmPos = mapping.charToPm(Math.floor(relativePos * content.length));

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);

        let from, to;
        let deleteFrom, deleteTo;

        if (kind === 'insert') {
            const context = contextOrDeleteText;
            if (!context) {
                from = 0;
            } else {
                // Pass estimatedPmPos to findBestMatch
                const match = findBestMatch(view, context, relativePos, estimatedPmPos);
                if (match) {
                    // Insert AFTER the context
                    from = match.to; // User precise end of context
                } else {
                    from = estimatedPmPos;
                }
            }
            to = from;
        } else if (kind === 'delete') {
            const match = findBestMatch(view, text, relativePos, estimatedPmPos);
            if (match) {
                from = match.from;
                to = match.to;
            } else {
                return;
            }
        } else if (kind === 'replace') {
            const deleteText = contextOrDeleteText;
            if (deleteText) {
                const match = findBestMatch(view, deleteText, relativePos, estimatedPmPos);
                if (match) {
                    deleteFrom = match.from;
                    deleteTo = match.to;
                } else {
                    return;
                }
            }
        }

        const tr = view.state.tr.setMeta(highlightKey, {
            type: 'preview',
            kind,
            from,
            to,
            deleteFrom,
            deleteTo,
            text
        });
        view.dispatch(tr);

        // Scroll target
        const scrollTarget = (kind === 'replace') ? deleteFrom : from;
        if (scrollTarget !== undefined) {
            setTimeout(() => scrollToEditorRange(scrollTarget, scrollTarget), 0);
        }
    });
}

// ... (other exports)

// ...



// ---------------------------------------------------------------------------
//  Initialize profile and Yjs document state before creating the editor.
// ---------------------------------------------------------------------------

export let editor;

export function getEditorContent() {
    let content = "";
    if (editor) {
        editor.action((ctx) => {
            const view = ctx.get(editorViewCtx);
            // Use textBetween instead of textContent to preserve newlines
            const doc = view.state.doc;
            content = doc.textBetween(0, doc.content.size, "\n", "\n");
        });
    }
    return content;
}

/**
 * Get the current document content as Markdown.
 * This extracts markdown on-demand using Milkdown's serializer.
 */
export function getMarkdown() {
    let markdown = "";
    if (editor) {
        try {
            editor.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                const serializer = ctx.get(serializerCtx);
                markdown = serializer(view.state.doc);
            });
        } catch (err) {
            console.error("[ERROR] getMarkdown serialization failed:", err);
        }
    }
    return markdown;
}

/**
 * Serialize a single ProseMirror node to Markdown.
 * Useful for calculating precise offset mappings.
 * @param {Node} node - The ProseMirror node to serialize
 * @returns {string} The markdown string
 */
export function serializeNode(node) {
    let markdown = "";
    if (editor) {
        try {
            editor.action((ctx) => {
                const serializer = ctx.get(serializerCtx);
                // The serializer usually expects a Node.
                markdown = serializer(node);
            });
        } catch (err) {
            console.error("[ERROR] serializeNode failed:", err);
        }
    }
    return markdown;
}

/**
 * Undo the last change (uses Yjs undo stack).
 */
export function doUndo() {
    if (editor) {
        try {
            editor.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                undo(view.state, view.dispatch);
            });
        } catch (err) {
            console.error("Undo error:", err);
        }
    }
}

/**
 * Redo the last undone change (uses Yjs redo stack).
 */
export function doRedo() {
    if (editor) {
        try {
            editor.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                redo(view.state, view.dispatch);
            });
        } catch (err) {
            console.error("Redo error:", err);
        }
    }
}

/**
 * Pre-process markdown to convert pandoc-specific syntax to standard HTML.
 * Converts spans like [text]{.underline} to <u>text</u>
 * @param {string} markdown - Raw markdown from pandoc
 * @returns {string} Processed markdown
 */
function preprocessMarkdown(markdown) {
    if (!markdown) return markdown;

    // Note: [text]{.underline} and ++text++ are handled by the underline remark plugin

    // Convert pandoc strikethrough spans: [text]{.strikethrough} -> ~~text~~
    let processed = markdown.replace(/\[([^\]]+)\]\{\.strikethrough\}/g, '~~$1~~');

    return processed;
}

/**
 * Set the editor content from a markdown string.
 * This properly parses the markdown and renders it in WYSIWYG mode.
 * Pre-processes pandoc-specific syntax to standard markdown/HTML.
 * @param {string} markdown - The markdown content to set
 * @returns {boolean} True if successful
 */
export function setMarkdownContent(markdown) {
    if (!editor) {
        console.error("setMarkdownContent: Editor not initialized");
        return false;
    }

    if (!markdown || typeof markdown !== 'string') {
        console.warn("setMarkdownContent: No valid markdown provided");
        return false;
    }

    try {
        // Pre-process pandoc syntax before loading
        const processed = preprocessMarkdown(markdown);

        // Rebuild figure registry to assign correct numbers
        rebuildFigureRegistry(processed);

        editor.action(replaceAll(processed));
        return true;
    } catch (err) {
        console.error("setMarkdownContent error:", err);
        return false;
    }
}

export async function initEditor() {
    try {
        await initProfile();
    } catch (err) {
        console.warn("Failed to initialize profile, using defaults:", err);
    }

    // Initial load is handled by the activeChange listener in main.js/editor.js
    // or by checking active document if listener hasn't fired yet.
    // However, to avoid race conditions with the listener, we should rely on the listener
    // or explicitly check if we need to load ONLY if not already loaded.
    // For now, we'll let the listener handle it to avoid double-loading.

    enablePersistence();

    // ---------------------------------------------------------------------------
    //  Create the Milkdown editor with Yjs + semantic patch logging.
    // ---------------------------------------------------------------------------
    try {
        editor = await Editor.make()
            .config((ctx) => {
                ctx.set(rootCtx, document.getElementById("editor"));
                ctx.set(defaultValueCtx, "");

                ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, prevMarkdown) => {
                    // This ensures Markdown export stays in sync.
                    const event = new CustomEvent("markdown-updated", {
                        detail: { markdown, prevMarkdown },
                    });
                    window.dispatchEvent(event);
                });
            })
            .use(commonmark)
            .use(gfm)
            .use(underlinePlugin)
            .use(figurePlugin)
            .use(listener)
            .create();
    } catch (err) {
        console.error("Editor: Failed to create", err);
        return;
    }

    // ---------------------------------------------------------------------------
    //  Patch logger plugin (semantic patches + grouping).
    // ---------------------------------------------------------------------------
    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const state = view.state;

        const patchLoggerPlugin = new Plugin({
            appendTransaction(transactions, oldState, newState) {
                if (!transactions.length) return;

                // Skip patch recording when we're applying updates (e.g., restoring from patch)
                if (isApplyingUpdate()) {
                    return;
                }

                const semanticPatches = [];

                for (const tr of transactions) {
                    // Skip Yjs-generated transactions (mirror updates)
                    if (tr.getMeta("y-sync$")) {
                        // console.log("Skipping Yjs transaction");
                        continue;
                    }

                    for (const step of tr.steps) {
                        const semantic = stepToSemanticPatch(step, oldState, newState);
                        semanticPatches.push(semantic);
                    }
                }

                if (semanticPatches.length === 0) return;

                // Feed semantic patches into the grouper (author is now pulled from profile)
                // Use getMarkdown() to preserve formatting in snapshots
                const currentText = getMarkdown();
                const groupedRecord = addSemanticPatches(semanticPatches, currentText);

                // Only when the grouper flushes do we persist to SQLite
                if (groupedRecord) {
                    // Try to record to active document, fall back to global
                    const docId = getActiveDocumentId();
                    if (docId) {
                        invoke("record_document_patch", { id: docId, patch: groupedRecord }).catch((err) => {
                            console.error("Failed to record document patch:", err);
                            // Fall back to global patch log
                            invoke("record_patch", { patch: groupedRecord }).catch(() => { });
                        });
                    } else {
                        invoke("record_patch", { patch: groupedRecord }).catch((err) => {
                            console.error("Failed to record grouped patch:", err);
                        });
                    }
                }

                return null;
            },
        });

        // Inject the correct plugin list
        const newState = state.reconfigure({
            plugins: [
                ...state.plugins,
                ySyncPlugin(yXmlFragment),
                yUndoPlugin(),
                patchLoggerPlugin,
                hunkHighlightPlugin,
            ],
        });

        view.updateState(newState);
    });

    // Return the editor instance for external use
    return editor;
}

// Listen for Yjs document replacement (when switching docs)
window.addEventListener('yjs-doc-replaced', () => {
    if (!editor) return;

    editor.action((ctx) => {
        const view = ctx.get(editorViewCtx);
        const state = view.state;

        // Filter out existing Yjs plugins to avoid duplication/stale references
        // ySyncPlugin has key "y-sync$", yUndoPlugin has key "y-undo$"
        // hunkHighlightPlugin has key "hunk-highlight$"
        const cleanPlugins = state.plugins.filter(p =>
            !p.key.startsWith("y-sync$") &&
            !p.key.startsWith("y-undo$") &&
            !p.key.startsWith("hunk-highlight$")
        );

        // Re-inject plugins with the NEW yXmlFragment
        // Note: yXmlFragment is a live binding from yjs-setup.js
        const newState = state.reconfigure({
            plugins: [
                ...cleanPlugins,
                ySyncPlugin(yXmlFragment),
                yUndoPlugin(),
                hunkHighlightPlugin,
            ],
        });

        view.updateState(newState);
    });
});

// ---------------------------------------------------------------------------
//  Handle document switching
// ---------------------------------------------------------------------------
onDocumentChange(async (event, doc) => {
    if (event === "activeChange" && doc) {
        try {
            await switchDocument(doc.id);
        } catch (err) {
            console.error("Failed to switch document:", err);
        }
    }
});

// ---------------------------------------------------------------------------
//  Lifecycle integration — ensure we flush + save on loss of focus.
// ---------------------------------------------------------------------------

// On window blur: flush semantic group + force Yjs save
window.addEventListener("blur", () => {
    const record = flushGroup(getMarkdown());
    if (record) {
        const docId = getActiveDocumentId();
        if (docId) {
            invoke("record_document_patch", { id: docId, patch: record }).catch(() => { });
        } else {
            invoke("record_patch", { patch: record }).catch((err) => {
                console.error("Failed to record grouped patch on blur:", err);
            });
        }
    }
    forceSave();
});

// On tab hide (user switches tab)
document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
        const record = flushGroup(getMarkdown());
        if (record) {
            const docId = getActiveDocumentId();
            if (docId) {
                invoke("record_document_patch", { id: docId, patch: record }).catch(() => { });
            } else {
                invoke("record_patch", { patch: record }).catch(() => { });
            }
        }
        forceSave();
    }
});

// Last resort: before page unload.
window.addEventListener("beforeunload", () => {
    const record = flushGroup(getMarkdown());
    if (record) {
        const docId = getActiveDocumentId();
        if (docId) {
            invoke("record_document_patch", { id: docId, patch: record }).catch(() => { });
        } else {
            // Fire and forget — cannot guarantee async execution
            invoke("record_patch", { patch: record }).catch(() => { });
        }
    }
    forceSave();
});
