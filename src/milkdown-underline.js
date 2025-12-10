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
 */
export const underlineMark = $mark("underline", () => ({
    attrs: {},
    parseDOM: [
        { tag: "ins" },
        { tag: "u" },
        { style: "text-decoration=underline" },
    ],
    toDOM: () => ["ins", { class: "underline" }, 0],
    parseMarkdown: {
        match: (node) => node.type === "ins",
        runner: (state, node, markType) => {
            state.openMark(markType);
            state.next(node.children);
            state.closeMark(markType);
        },
    },
    toMarkdown: {
        match: (mark) => mark.type.name === "underline",
        runner: (state, mark) => {
            state.withMark(mark, "ins");
        },
    },
}));

/**
 * Remark plugin to parse ++text++ and [text]{.underline} syntax
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

                // The underlined text as ins node
                parts.push({
                    type: "ins",
                    data: { hName: "ins" },
                    children: [{ type: "text", value: underlineText }],
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
