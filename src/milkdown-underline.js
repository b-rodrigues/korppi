// src/milkdown-underline.js
// Custom underline plugin for Milkdown
// Adds support for <ins>, <u> tags, ++text++ and pandoc [text]{.underline} syntax

import { $mark, $inputRule, $command, $remark } from "@milkdown/utils";
import { toggleMark } from "@milkdown/prose/commands";
import { InputRule } from "@milkdown/prose/inputrules";
import { visit } from "unist-util-visit";

/**
 * Create the underline mark
 * Interprets <ins> and <u> HTML tags as underlined text
 * Serializes to <u>text</u> in markdown
 */
export const underlineMark = $mark("underline", () => ({
    attrs: {},
    parseDOM: [
        { tag: "ins" },
        { tag: "u" },
        { style: "text-decoration=underline" },
    ],
    toDOM: () => ["u", 0],
    parseMarkdown: {
        match: (node) => node.type === "html" && node.value && /^<u>/.test(node.value),
        runner: (state, node, markType) => {
            // HTML nodes with <u> tags - extract content
            const match = node.value.match(/^<u>([\s\S]*)<\/u>$/);
            if (match) {
                state.openMark(markType);
                state.addText(match[1]);
                state.closeMark(markType);
            }
        },
    },
    toMarkdown: {
        match: (mark) => mark.type.name === "underline",
        runner: (state, mark, node) => {
            // Output as HTML <u> tag - this is universally supported in markdown
            // We need to handle the mark by wrapping the node's text content
            if (node && node.isText && node.text) {
                state.addNode("html", undefined, undefined, `<u>${node.text}</u>`);
                return false; // Signal that we've handled the node entirely
            }
        },
    },
}));

/**
 * Remark plugin to:
 * - Parse ++text++ and [text]{.underline} into <u>text</u> HTML nodes (not 'ins')
 * - The HTML nodes will be parsed back by the mark's parseMarkdown
 */
export const underlineRemarkPlugin = $remark("underlineRemark", () => {
    return () => (tree) => {
        // Process text nodes to find ++text++ or [text]{.underline} patterns
        visit(tree, "text", (node, index, parent) => {
            if (!node.value || !parent) return;

            // Combined regex for both patterns
            const regex = /(\+\+([^\+]+)\+\+|\[([^\]]+)\]\{\.underline\})/g;

            let match;
            const parts = [];
            let lastIndex = 0;

            while ((match = regex.exec(node.value)) !== null) {
                // Text before the match
                if (match.index > lastIndex) {
                    parts.push({
                        type: "text",
                        value: node.value.slice(lastIndex, match.index),
                    });
                }

                // Get the underlined text (either from ++text++ or [text]{.underline})
                const underlineText = match[2] || match[3];

                // The underlined text as HTML node (not 'ins' which causes errors)
                parts.push({
                    type: "html",
                    value: `<u>${underlineText}</u>`,
                });

                lastIndex = match.index + match[0].length;
            }

            // Remaining text after last match
            if (lastIndex < node.value.length) {
                parts.push({
                    type: "text",
                    value: node.value.slice(lastIndex),
                });
            }

            // Replace the text node with our parts
            if (parts.length > 0 && lastIndex > 0) {
                parent.children.splice(index, 1, ...parts);
                return index + parts.length; // Skip the newly inserted nodes
            }
        });

        return tree;
    };
});

/**
 * Input rule: typing ++text++ converts to underline
 */
export const underlinePlusPlusInputRule = $inputRule((ctx) => {
    const markType = underlineMark.type(ctx);
    return new InputRule(
        /\+\+([^\+]+)\+\+$/,
        (state, match, start, end) => {
            const text = match[1];
            if (!text) return null;

            const tr = state.tr;
            tr.replaceWith(start, end, state.schema.text(text, [markType.create()]));
            return tr;
        }
    );
});

/**
 * Input rule: pandoc [text]{.underline} syntax converts to underline
 */
export const underlinePandocInputRule = $inputRule((ctx) => {
    const markType = underlineMark.type(ctx);
    return new InputRule(
        /\[([^\]]+)\]\{\.underline\}$/,
        (state, match, start, end) => {
            const text = match[1];
            if (!text) return null;

            const tr = state.tr;
            tr.replaceWith(start, end, state.schema.text(text, [markType.create()]));
            return tr;
        }
    );
});

/**
 * Toggle underline command (can be triggered by Ctrl+U or toolbar button)
 */
export const toggleUnderlineCommand = $command("ToggleUnderline", (ctx) => () => {
    const markType = underlineMark.type(ctx);
    return toggleMark(markType);
});

/**
 * Complete underline plugin array - use all of these together
 */
export const underlinePlugin = [
    underlineRemarkPlugin,
    underlineMark,
    underlinePlusPlusInputRule,
    underlinePandocInputRule,
    toggleUnderlineCommand,
];
