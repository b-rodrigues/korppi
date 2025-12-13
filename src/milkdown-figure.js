// src/milkdown-figure.js
// Custom cross-reference plugin for Milkdown
// Adds support for figures, sections, and tables with labels using Pandoc-compatible syntax:
//
// Figures: ![Caption text](image.png){#fig:label}
// Sections: # Heading {#sec:label}
// Tables: | table | ... | {#tbl:label}
//
// Cross-references: @fig:label, @sec:label, @tbl:label

import { $node, $inputRule, $command, $remark } from "@milkdown/utils";
import { InputRule } from "@milkdown/prose/inputrules";
import { visit } from "unist-util-visit";

// Global registries to track labels and numbers for each type
export const figureRegistry = new Map();
export const sectionRegistry = new Map();
export const tableRegistry = new Map();

let figureCounter = 0;
let sectionCounter = 0;
let tableCounter = 0;

/**
 * Reset all registries (call when loading a new document)
 */
export function resetFigureRegistry() {
    figureRegistry.clear();
    sectionRegistry.clear();
    tableRegistry.clear();
    figureCounter = 0;
    sectionCounter = 0;
    tableCounter = 0;
}

/**
 * Register a label and return its number
 * @param {string} label - The label (e.g., "fig:myplot", "sec:intro", "tbl:data")
 * @returns {number} The assigned number
 */
export function registerFigure(label) {
    if (label.startsWith("fig:")) {
        if (figureRegistry.has(label)) return figureRegistry.get(label);
        figureCounter++;
        figureRegistry.set(label, figureCounter);
        return figureCounter;
    } else if (label.startsWith("sec:")) {
        if (sectionRegistry.has(label)) return sectionRegistry.get(label);
        sectionCounter++;
        sectionRegistry.set(label, sectionCounter);
        return sectionCounter;
    } else if (label.startsWith("tbl:")) {
        if (tableRegistry.has(label)) return tableRegistry.get(label);
        tableCounter++;
        tableRegistry.set(label, tableCounter);
        return tableCounter;
    }
    return 0;
}

/**
 * Get number for a label
 * @param {string} label - The label
 * @returns {number|null} The number or null if not found
 */
export function getFigureNumber(label) {
    if (label.startsWith("fig:")) return figureRegistry.get(label) || null;
    if (label.startsWith("sec:")) return sectionRegistry.get(label) || null;
    if (label.startsWith("tbl:")) return tableRegistry.get(label) || null;
    return null;
}

/**
 * Get the display text for a reference
 * @param {string} label - The label
 * @returns {string} The display text (e.g., "Figure 1", "Section 2", "Table 3")
 */
export function getReferenceText(label) {
    const num = getFigureNumber(label);
    if (!num) return `[${label}]`;

    if (label.startsWith("fig:")) return `Figure ${num}`;
    if (label.startsWith("sec:")) return `Section ${num}`;
    if (label.startsWith("tbl:")) return `Table ${num}`;
    return `[${label}]`;
}

/**
 * Rebuild all registries by scanning document content
 * @param {string} markdown - The markdown content
 */
export function rebuildFigureRegistry(markdown) {
    resetFigureRegistry();

    // Match figure syntax: ![caption](url){#fig:label}
    const figureRegex = /!\[([^\]]*)\]\(([^)]+)\)\{#(fig:[^}]+)\}/g;
    let match;
    while ((match = figureRegex.exec(markdown)) !== null) {
        registerFigure(match[3]);
    }

    // Match section syntax: # Heading {#sec:label} (supports # through ######)
    const sectionRegex = /^#{1,6}\s+.*\{#(sec:[^}]+)\}/gm;
    while ((match = sectionRegex.exec(markdown)) !== null) {
        registerFigure(match[1]);
    }

    // Match table syntax: {#tbl:label} appearing after tables or on its own line after a table
    const tableRegex = /\{#(tbl:[^}]+)\}/g;
    while ((match = tableRegex.exec(markdown)) !== null) {
        registerFigure(match[1]);
    }
}

/**
 * Create the figure node
 * A figure contains an image with a caption and optional label
 */
export const figureNode = $node("figure", () => ({
    group: "block",
    content: "image",
    defining: true,
    attrs: {
        label: { default: null },
        caption: { default: "" },
    },
    parseDOM: [
        {
            tag: "figure",
            getAttrs: (dom) => ({
                label: dom.getAttribute("data-label") || null,
                caption: dom.querySelector("figcaption")?.textContent || "",
            }),
        },
    ],
    toDOM: (node) => {
        const figureNum = node.attrs.label ? getFigureNumber(node.attrs.label) : null;
        const captionPrefix = figureNum ? `Figure ${figureNum}: ` : "";

        return [
            "figure",
            {
                class: "figure",
                "data-label": node.attrs.label || "",
                id: node.attrs.label || undefined,
            },
            ["div", { class: "figure-content" }, 0],
            [
                "figcaption",
                {},
                captionPrefix + (node.attrs.caption || ""),
            ],
        ];
    },
    parseMarkdown: {
        match: (node) => node.type === "figure",
        runner: (state, node, type) => {
            const { label, caption, src, alt } = node.data || {};
            state.openNode(type, { label, caption });
            const imageType = state.schema.nodes.image;
            if (imageType) {
                state.addNode(imageType, { src, alt: alt || caption });
            }
            state.closeNode();
        },
    },
    toMarkdown: {
        match: (node) => node.type.name === "figure",
        runner: (state, node) => {
            const label = node.attrs.label;

            // Open a paragraph to contain the figure markdown
            state.openNode("paragraph");

            // Serialize the child image node using state.next()
            state.next(node.content);

            // Add the label as raw text if present
            if (label) {
                state.addNode("html", undefined, `{#${label}}`);
            }

            state.closeNode();
        },
    },
}));

/**
 * Create the cross-reference node
 * Renders as "Figure N", "Section N", or "Table N" depending on the label type
 */
export const figureRefNode = $node("figureRef", () => ({
    group: "inline",
    inline: true,
    atom: true,
    attrs: {
        label: { default: "" },
    },
    parseDOM: [
        {
            tag: "a.cross-ref",
            getAttrs: (dom) => ({
                label: dom.getAttribute("data-label") || "",
            }),
        },
        {
            tag: "a.figure-ref",
            getAttrs: (dom) => ({
                label: dom.getAttribute("data-label") || "",
            }),
        },
    ],
    toDOM: (node) => {
        const label = node.attrs.label;
        const text = getReferenceText(label);
        const refType = label.split(":")[0] || "ref";

        return [
            "a",
            {
                class: `cross-ref ${refType}-ref`,
                "data-label": label,
                href: `#${label}`,
            },
            text,
        ];
    },
    parseMarkdown: {
        match: (node) => node.type === "figureRef" || node.type === "crossRef",
        runner: (state, node, type) => {
            state.addNode(type, { label: node.data?.label || "" });
        },
    },
    toMarkdown: {
        match: (node) => node.type.name === "figureRef",
        runner: (state, node) => {
            state.addNode("text", undefined, `@${node.attrs.label}`);
        },
    },
}));

/**
 * Remark plugin to parse cross-reference syntax
 * Converts:
 * - ![caption](url){#fig:label} -> figure node
 * - # Heading {#sec:label} -> heading with id
 * - @fig:label, @sec:label, @tbl:label -> cross-reference nodes
 */
export const figureRemarkPlugin = $remark("figureRemark", () => {
    return () => (tree) => {
        // First pass: collect all labels

        // Collect figure labels
        visit(tree, "paragraph", (node) => {
            if (!node.children) return;
            node.children.forEach((child) => {
                if (child.type === "text" && child.value) {
                    const figureRegex = /!\[([^\]]*)\]\(([^)]+)\)\{#(fig:[^}]+)\}/g;
                    let match;
                    while ((match = figureRegex.exec(child.value)) !== null) {
                        registerFigure(match[3]);
                    }
                }
            });
        });

        // Collect section labels from headings
        visit(tree, "heading", (node) => {
            if (!node.children) return;
            const lastChild = node.children[node.children.length - 1];
            if (lastChild && lastChild.type === "text" && lastChild.value) {
                const match = lastChild.value.match(/\{#(sec:[^}]+)\}\s*$/);
                if (match) {
                    registerFigure(match[1]);
                }
            }
        });

        // Collect table labels
        visit(tree, "paragraph", (node) => {
            if (!node.children) return;
            node.children.forEach((child) => {
                if (child.type === "text" && child.value) {
                    const tableRegex = /\{#(tbl:[^}]+)\}/g;
                    let match;
                    while ((match = tableRegex.exec(child.value)) !== null) {
                        registerFigure(match[1]);
                    }
                }
            });
        });

        // Also check images with attributes
        visit(tree, "image", (node, index, parent) => {
            if (!parent || !parent.children) return;
            const nextSibling = parent.children[index + 1];
            if (nextSibling && nextSibling.type === "text" && nextSibling.value) {
                const attrMatch = nextSibling.value.match(/^\{#(fig:[^}]+)\}/);
                if (attrMatch) {
                    registerFigure(attrMatch[1]);
                }
            }
        });

        // Second pass: process headings to add IDs for section labels
        visit(tree, "heading", (node) => {
            if (!node.children || node.children.length === 0) return;
            const lastChild = node.children[node.children.length - 1];
            if (lastChild && lastChild.type === "text" && lastChild.value) {
                const match = lastChild.value.match(/^(.*?)\s*\{#(sec:[^}]+)\}\s*$/);
                if (match) {
                    // Remove the {#sec:label} from the text
                    lastChild.value = match[1];
                    // Store the label in the node's data
                    node.data = node.data || {};
                    node.data.hProperties = node.data.hProperties || {};
                    node.data.hProperties.id = match[2];
                    node.data.id = match[2];
                }
            }
        });

        // Process paragraphs for figures
        visit(tree, "paragraph", (node, index, parent) => {
            if (!node.children || node.children.length === 0) return;

            if (node.children.length >= 1) {
                const firstChild = node.children[0];

                // Case 1: Text node with full figure markdown syntax
                if (firstChild.type === "text" && firstChild.value) {
                    const figureMatch = firstChild.value.match(/^!\[([^\]]*)\]\(([^)]+)\)\{#(fig:[^}]+)\}$/);
                    if (figureMatch && node.children.length === 1) {
                        const [, caption, src, label] = figureMatch;
                        parent.children[index] = {
                            type: "figure",
                            data: {
                                label: label,
                                caption: caption,
                                src: src,
                                alt: caption,
                            },
                            children: [],
                        };
                        return;
                    }
                }

                // Case 2: Image node followed by {#fig:label}
                if (firstChild.type === "image") {
                    const secondChild = node.children[1];
                    if (secondChild && secondChild.type === "text" && secondChild.value) {
                        const attrMatch = secondChild.value.match(/^\{#(fig:[^}]+)\}$/);
                        if (attrMatch && node.children.length === 2) {
                            const label = attrMatch[1];
                            const caption = firstChild.alt || "";
                            const src = firstChild.url || "";
                            parent.children[index] = {
                                type: "figure",
                                data: {
                                    label: label,
                                    caption: caption,
                                    src: src,
                                    alt: caption,
                                },
                                children: [],
                            };
                            return;
                        }
                    }
                }
            }

            // Process cross-references within text nodes
            const newChildren = [];
            let modified = false;

            for (const child of node.children) {
                if (child.type === "text" && child.value) {
                    // Match @fig:label, @sec:label, @tbl:label references
                    const refRegex = /@((?:fig|sec|tbl):[a-zA-Z0-9_-]+)/g;
                    let lastIndex = 0;
                    let match;
                    const parts = [];

                    while ((match = refRegex.exec(child.value)) !== null) {
                        modified = true;

                        if (match.index > lastIndex) {
                            parts.push({
                                type: "text",
                                value: child.value.slice(lastIndex, match.index),
                            });
                        }

                        parts.push({
                            type: "figureRef",
                            data: { label: match[1] },
                        });

                        lastIndex = match.index + match[0].length;
                    }

                    if (lastIndex < child.value.length) {
                        parts.push({
                            type: "text",
                            value: child.value.slice(lastIndex),
                        });
                    }

                    if (parts.length > 0 && modified) {
                        newChildren.push(...parts);
                    } else {
                        newChildren.push(child);
                    }
                } else {
                    newChildren.push(child);
                }
            }

            if (modified) {
                node.children = newChildren;
            }
        });

        return tree;
    };
});

/**
 * Input rule: typing @fig:label, @sec:label, or @tbl:label creates a cross-reference
 */
export const figureRefInputRule = $inputRule((ctx) => {
    const nodeType = figureRefNode.type(ctx);
    return new InputRule(
        /@((?:fig|sec|tbl):[a-zA-Z0-9_-]+)\s$/,
        (state, match, start, end) => {
            const label = match[1];
            if (!label) return null;

            const tr = state.tr;
            const node = nodeType.create({ label });
            tr.replaceWith(start, end, [node, state.schema.text(" ")]);
            return tr;
        }
    );
});

/**
 * Command to insert a figure
 */
export const insertFigureCommand = $command("InsertFigure", (ctx) => (src, caption, label) => {
    return (state, dispatch) => {
        const figureType = figureNode.type(ctx);
        const imageType = state.schema.nodes.image;

        if (!figureType || !imageType) {
            console.warn("Figure or image type not found in schema");
            return false;
        }

        if (label) {
            registerFigure(label);
        }

        const imageNode = imageType.create({ src, alt: caption });
        const figure = figureType.create({ label, caption }, imageNode);

        const { from } = state.selection;
        const tr = state.tr.insert(from, figure);

        if (dispatch) {
            dispatch(tr);
        }

        return true;
    };
});

/**
 * Command to insert a cross-reference
 */
export const insertFigureRefCommand = $command("InsertFigureRef", (ctx) => (label) => {
    return (state, dispatch) => {
        const refType = figureRefNode.type(ctx);

        if (!refType) {
            console.warn("FigureRef type not found in schema");
            return false;
        }

        const node = refType.create({ label });
        const { from } = state.selection;
        const tr = state.tr.insert(from, node);

        if (dispatch) {
            dispatch(tr);
        }

        return true;
    };
});

/**
 * Complete cross-reference plugin array - use all of these together
 */
export const figurePlugin = [
    figureRemarkPlugin,
    figureNode,
    figureRefNode,
    figureRefInputRule,
    insertFigureCommand,
    insertFigureRefCommand,
];
