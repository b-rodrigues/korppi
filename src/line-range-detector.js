// src/line-range-detector.js
// Detect which lines a patch affects for line-based reconciliation

import { calculateCharDiff } from './diff-highlighter.js';

/**
 * Calculate the line range affected by a patch
 * @param {string} oldText - Previous version
 * @param {string} newText - New version
 * @returns {{ startLine: number, endLine: number, type: string } | null}
 */
export function detectLineRange(oldText, newText) {
    if (!newText) {
        return null;
    }

    // If both are empty or identical, no changes
    if (oldText === newText) {
        return null;
    }

    // Handle case where oldText is empty (new content)
    if (!oldText || oldText.length === 0) {
        const lines = newText.split('\n');
        return {
            startLine: 1,
            endLine: lines.length,
            type: 'added',
            affectedLines: lines.length
        };
    }

    const diffOps = calculateCharDiff(oldText, newText);

    // Check if there are any actual changes
    const hasChanges = diffOps.some(op => op.type !== 'equal');
    if (!hasChanges) {
        return null;
    }

    // Find first and last changed positions in the NEW text
    let firstChangePos = -1;
    let lastChangePos = -1;
    let newTextPos = 0;

    for (const op of diffOps) {
        if (op.type === 'add') {
            // Addition in new text
            if (firstChangePos === -1) {
                firstChangePos = newTextPos;
            }
            lastChangePos = newTextPos + op.text.length;
            newTextPos += op.text.length;
        } else if (op.type === 'delete') {
            // Deletion - mark position but don't advance in new text
            if (firstChangePos === -1) {
                firstChangePos = newTextPos;
            }
            lastChangePos = Math.max(lastChangePos, newTextPos);
        } else {
            // Equal - advance position
            newTextPos += op.text.length;
        }
    }

    if (firstChangePos === -1) {
        return null; // No changes found
    }

    // Convert character positions to line numbers in the NEW text
    const lines = newText.split('\n');
    let charCount = 0;
    let startLine = 1;
    let endLine = 1;
    let foundStart = false;

    for (let i = 0; i < lines.length; i++) {
        const lineLength = lines[i].length + 1; // +1 for newline
        const lineEnd = charCount + lineLength;

        if (!foundStart && lineEnd > firstChangePos) {
            startLine = i + 1; // 1-indexed
            foundStart = true;
        }

        if (lineEnd > lastChangePos) {
            endLine = i + 1; // 1-indexed
            break;
        }

        charCount += lineLength;
    }

    // Ensure endLine is at least startLine
    if (endLine < startLine) {
        endLine = startLine;
    }

    // Determine change type
    let type = 'modified';
    const hasAdditions = diffOps.some(op => op.type === 'add');
    const hasDeletions = diffOps.some(op => op.type === 'delete');

    if (hasAdditions && !hasDeletions) {
        type = 'added';
    } else if (hasDeletions && !hasAdditions) {
        type = 'deleted';
    }

    return {
        startLine,
        endLine,
        type,
        affectedLines: endLine - startLine + 1
    };
}

/**
 * Format line range for display
 * @param {{ startLine: number, endLine: number }} range
 * @returns {string}
 */
export function formatLineRange(range) {
    if (!range) return '';

    if (range.startLine === range.endLine) {
        return `Line ${range.startLine}`;
    }

    return `Lines ${range.startLine}-${range.endLine}`;
}
