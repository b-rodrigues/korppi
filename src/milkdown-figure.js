// src/milkdown-figure.js
// Custom figure plugin for Milkdown
// Adds support for figures with captions and labels using Pandoc-compatible syntax:
// ![Caption text](image.png){#fig:label}
// Cross-references: @fig:label

import { $node, $inputRule, $command, $remark } from "@milkdown/utils";
import { InputRule } from "@milkdown/prose/inputrules";
import { visit } from "unist-util-visit";

// Global figure registry to track labels and numbers
// This is reset on document load and populated during parsing
export const figureRegistry = new Map();
let figureCounter = 0;

/**
 * Reset the figure registry (call when loading a new document)
 */
export function resetFigureRegistry() {
    figureRegistry.clear();
    figureCounter = 0;
}

/**
 * Get the next figure number and register a label
 * @param {string} label - The figure label (e.g., "fig:myplot")
 * @returns {number} The figure number
 */
export function registerFigure(label) {
    if (figureRegistry.has(label)) {
        return figureRegistry.get(label);
    }
    figureCounter++;
    figureRegistry.set(label, figureCounter);
    return figureCounter;
}

/**
 * Get figure number for a label
 * @param {string} label - The figure label
 * @returns {number|null} The figure number or null if not found
 */
export function getFigureNumber(label) {
    return figureRegistry.get(label) || null;
}

/**
 * Rebuild figure registry by scanning document content
 * @param {string} markdown - The markdown content
 */
export function rebuildFigureRegistry(markdown) {
    resetFigureRegistry();

    // Match figure syntax: ![caption](url){#fig:label}
    const figureRegex = /!\[([^\]]*)\]\(([^)]+)\)\{#(fig:[^}]+)\}/g;
    let match;

    while ((match = figureRegex.exec(markdown)) !== null) {
        const label = match[3];
        registerFigure(label);
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
            // Create image child
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
            // Find the image child
            let imageSrc = "";
            let imageAlt = "";
            node.content.forEach((child) => {
                if (child.type.name === "image") {
                    imageSrc = child.attrs.src || "";
                    imageAlt = child.attrs.alt || "";
                }
            });

            const caption = node.attrs.caption || imageAlt;
            const label = node.attrs.label;

            // Output as: ![caption](src){#label}
            let output = `![${caption}](${imageSrc})`;
            if (label) {
                output += `{#${label}}`;
            }

            state.addNode("paragraph", undefined, output);
        },
    },
}));

/**
 * Create the figure reference (cross-reference) node
 * Renders as "Figure N" where N is the figure number
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
            tag: "a.figure-ref",
            getAttrs: (dom) => ({
                label: dom.getAttribute("data-label") || "",
            }),
        },
    ],
    toDOM: (node) => {
        const label = node.attrs.label;
        const figNum = getFigureNumber(label);
        const text = figNum ? `Figure ${figNum}` : `[${label}]`;

        return [
            "a",
            {
                class: "figure-ref",
                "data-label": label,
                href: `#${label}`,
            },
            text,
        ];
    },
    parseMarkdown: {
        match: (node) => node.type === "figureRef",
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
 * Remark plugin to parse figure syntax and cross-references
 * Converts:
 * - ![caption](url){#fig:label} -> figure node
 * - @fig:label -> figureRef node
 */
export const figureRemarkPlugin = $remark("figureRemark", () => {
    return () => (tree) => {
        // First pass: collect all figure labels
        visit(tree, "paragraph", (node) => {
            if (!node.children) return;

            node.children.forEach((child) => {
                if (child.type === "text" && child.value) {
                    // Look for figure definitions
                    const figureRegex = /!\[([^\]]*)\]\(([^)]+)\)\{#(fig:[^}]+)\}/g;
                    let match;
                    while ((match = figureRegex.exec(child.value)) !== null) {
                        registerFigure(match[3]);
                    }
                }
            });
        });

        // Also check images with attributes
        visit(tree, "image", (node, index, parent) => {
            if (!parent || !parent.children) return;

            // Check if there's text after the image with {#fig:label}
            const nextSibling = parent.children[index + 1];
            if (nextSibling && nextSibling.type === "text" && nextSibling.value) {
                const attrMatch = nextSibling.value.match(/^\{#(fig:[^}]+)\}/);
                if (attrMatch) {
                    registerFigure(attrMatch[1]);
                }
            }
        });

        // Second pass: process paragraphs to convert figure syntax
        visit(tree, "paragraph", (node, index, parent) => {
            if (!node.children || node.children.length === 0) return;

            // Check if this paragraph contains only an image with figure attributes
            // Pattern: image followed by {#fig:label} text
            if (node.children.length >= 1) {
                const firstChild = node.children[0];

                // Case 1: Text node with full figure markdown syntax
                if (firstChild.type === "text" && firstChild.value) {
                    const figureMatch = firstChild.value.match(/^!\[([^\]]*)\]\(([^)]+)\)\{#(fig:[^}]+)\}$/);
                    if (figureMatch && node.children.length === 1) {
                        const [, caption, src, label] = figureMatch;

                        // Replace paragraph with figure node
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

                            // Replace paragraph with figure node
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
                    // Match @fig:label references
                    const refRegex = /@(fig:[a-zA-Z0-9_-]+)/g;
                    let lastIndex = 0;
                    let match;
                    const parts = [];

                    while ((match = refRegex.exec(child.value)) !== null) {
                        modified = true;

                        // Text before the reference
                        if (match.index > lastIndex) {
                            parts.push({
                                type: "text",
                                value: child.value.slice(lastIndex, match.index),
                            });
                        }

                        // The reference
                        parts.push({
                            type: "figureRef",
                            data: { label: match[1] },
                        });

                        lastIndex = match.index + match[0].length;
                    }

                    // Remaining text
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
 * Input rule: typing @fig:label creates a figure reference
 */
export const figureRefInputRule = $inputRule((ctx) => {
    const nodeType = figureRefNode.type(ctx);
    return new InputRule(
        /@(fig:[a-zA-Z0-9_-]+)\s$/,
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

        // Register the figure label
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
 * Command to insert a figure reference
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
 * Complete figure plugin array - use all of these together
 */
export const figurePlugin = [
    figureRemarkPlugin,
    figureNode,
    figureRefNode,
    figureRefInputRule,
    insertFigureCommand,
    insertFigureRefCommand,
];
