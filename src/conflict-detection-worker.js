// src/conflict-detection-worker.js
// Web Worker for parallel diff calculations

import { calculateCharDiff } from './diff-highlighter.js';

/**
 * Process a batch of diff calculations
 * @param {Array} tasks - Array of {index, prevContent, currentContent}
 * @returns {Array} - Array of {index, ranges}
 */
function processDiffBatch(tasks) {
    const results = [];

    for (const task of tasks) {
        const ranges = extractEditRanges(task.prevContent, task.currentContent);
        results.push({
            index: task.index,
            patchId: task.patchId,
            author: task.author,
            ranges
        });
    }

    return results;
}

/**
 * Extract character ranges affected by edits between two texts
 */
function extractEditRanges(oldText, newText) {
    if (oldText === newText) {
        return [];
    }

    const diff = calculateCharDiff(oldText, newText);
    const ranges = [];
    let newTextPos = 0;

    for (const op of diff) {
        if (op.type === 'add') {
            ranges.push({
                start: newTextPos,
                end: newTextPos + op.text.length
            });
            newTextPos += op.text.length;
        } else if (op.type === 'delete') {
            ranges.push({
                start: newTextPos,
                end: newTextPos
            });
        } else {
            newTextPos += op.text.length;
        }
    }

    return mergeRanges(ranges);
}

/**
 * Merge adjacent or overlapping ranges
 */
function mergeRanges(ranges) {
    if (ranges.length <= 1) return ranges;

    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    const merged = [{ ...sorted[0] }];

    for (let i = 1; i < sorted.length; i++) {
        const current = sorted[i];
        const last = merged[merged.length - 1];

        if (current.start <= last.end) {
            last.end = Math.max(last.end, current.end);
        } else {
            merged.push({ ...current });
        }
    }

    return merged;
}

// Worker message handler
self.onmessage = function(e) {
    const { type, tasks, id } = e.data;

    if (type === 'processBatch') {
        const results = processDiffBatch(tasks);
        self.postMessage({ type: 'batchComplete', results, id });
    }
};
