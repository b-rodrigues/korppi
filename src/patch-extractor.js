// src/patch-extractor.js
import { ReplaceStep, ReplaceAroundStep, AddMarkStep, RemoveMarkStep } from "@milkdown/prose/transform";

export function stepToSemanticPatch(step, oldState, newState) {
    // Insert or delete text
    if (step instanceof ReplaceStep) {
        const from = step.from;
        const to = step.to;

        let deletedText = "";
        let insertedText = "";

        try {
            deletedText = oldState.doc.textBetween(from, to, "\n", "\n");
        } catch (e) {
            // Complex node structure, can't extract text
        }

        try {
            insertedText = step.slice.content.textBetween(0, step.slice.size, "\n", "\n");
        } catch (e) {
            // Complex node structure (e.g., table), can't extract text
            // Try to get a description of what was inserted
            if (step.slice.content.firstChild) {
                insertedText = `[${step.slice.content.firstChild.type.name}]`;
            }
        }

        if (deletedText && !insertedText) {
            return {
                kind: "delete_text",
                range: [from, to],
                deletedText,
            };
        }

        if (insertedText && !deletedText) {
            return {
                kind: "insert_text",
                at: from,
                insertedText,
            };
        }

        if (insertedText && deletedText) {
            return {
                kind: "replace_text",
                range: [from, to],
                deletedText,
                insertedText,
            };
        }

        // Fallback
        return {
            kind: "replace_step_fallback",
            from,
            to,
        };
    }

    // Structural edits (wrapping, lifting, join)
    if (step instanceof ReplaceAroundStep) {
        return {
            kind: "structure_change",
            info: "ReplaceAroundStep detected",
            details: {
                from: step.from,
                to: step.to,
                gapFrom: step.gapFrom,
                gapTo: step.gapTo,
            },
        };
    }

    // Add bold/italic/etc.
    if (step instanceof AddMarkStep) {
        return {
            kind: "add_mark",
            range: [step.from, step.to],
            mark: step.mark.type.name,
        };
    }

    // Remove bold/italic/etc.
    if (step instanceof RemoveMarkStep) {
        return {
            kind: "remove_mark",
            range: [step.from, step.to],
            mark: step.mark.type.name,
        };
    }

    // Default fallback
    return {
        kind: "unknown_step",
        info: step.toJSON(),
    };
}
