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
    if (!oldText || !newText) {
        return null;
    }

    // Fast path: if texts are identical, no changes
    if (oldText === newText) {
        return null;
    }

    const diffOps = calculateCharDiff(oldText, newText);

    // Find first and last changed positions
    let firstChangePos = -1;
    let lastChangePos = -1;
    let currentPos = 0;

    for (const op of diffOps) {
        if (op.type !== 'equal') {
            if (firstChangePos === -1) {
                firstChangePos = currentPos;
            }
            lastChangePos = currentPos + op.text.length;
        }

        if (op.type !== 'delete') {
            currentPos += op.text.length;
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

        if (!foundStart && charCount + lineLength > firstChangePos) {
            startLine = i + 1; // 1-indexed
            foundStart = true;
        }

        if (charCount + lineLength > lastChangePos) {
            endLine = i + 1; // 1-indexed
            break;
        }

        charCount += lineLength;
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
