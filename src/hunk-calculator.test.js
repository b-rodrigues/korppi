// src/hunk-calculator.test.js
// Tests for the hunk calculator

import { describe, it, expect } from 'vitest';
import { calculateHunks, formatHunksForDebug } from './hunk-calculator.js';

describe('calculateHunks', () => {
    describe('basic functionality', () => {
        it('returns empty array for identical texts', () => {
            const base = 'line 1\nline 2\nline 3';
            const modified = 'line 1\nline 2\nline 3';
            const hunks = calculateHunks(base, modified);
            expect(hunks).toEqual([]);
        });

        it('detects a single line addition', () => {
            const base = 'line 1\nline 3';
            const modified = 'line 1\nline 2\nline 3';
            const hunks = calculateHunks(base, modified);

            expect(hunks.length).toBe(1);
            expect(hunks[0].type).toBe('add');
            expect(hunks[0].modifiedLines).toEqual(['line 2']);
        });

        it('detects a single line deletion', () => {
            const base = 'line 1\nline 2\nline 3';
            const modified = 'line 1\nline 3';
            const hunks = calculateHunks(base, modified);

            expect(hunks.length).toBe(1);
            expect(hunks[0].type).toBe('delete');
            expect(hunks[0].baseLines).toEqual(['line 2']);
        });

        it('detects a modification (replace)', () => {
            const base = 'line 1\noriginal line\nline 3';
            const modified = 'line 1\nmodified line\nline 3';
            const hunks = calculateHunks(base, modified);

            expect(hunks.length).toBe(1);
            expect(hunks[0].type).toBe('modify');
            expect(hunks[0].baseLines).toEqual(['original line']);
            expect(hunks[0].modifiedLines).toEqual(['modified line']);
        });
    });

    describe('multiple separate hunks', () => {
        it('creates separate hunks for non-adjacent changes', () => {
            const base = 'line 1\nline 2\nline 3\nline 4\nline 5';
            const modified = 'changed 1\nline 2\nline 3\nline 4\nchanged 5';
            const hunks = calculateHunks(base, modified);

            // Should be 2 separate hunks (line 1 and line 5)
            expect(hunks.length).toBe(2);

            // First hunk: line 1 -> changed 1
            expect(hunks[0].type).toBe('modify');
            expect(hunks[0].baseLines).toEqual(['line 1']);
            expect(hunks[0].modifiedLines).toEqual(['changed 1']);

            // Second hunk: line 5 -> changed 5
            expect(hunks[1].type).toBe('modify');
            expect(hunks[1].baseLines).toEqual(['line 5']);
            expect(hunks[1].modifiedLines).toEqual(['changed 5']);
        });

        it('creates separate hunks for additions at different locations', () => {
            const base = 'line 1\nline 2\nline 3';
            const modified = 'new first\nline 1\nline 2\nline 3\nnew last';
            const hunks = calculateHunks(base, modified);

            expect(hunks.length).toBe(2);
            expect(hunks[0].type).toBe('add');
            expect(hunks[0].modifiedLines).toEqual(['new first']);
            expect(hunks[1].type).toBe('add');
            expect(hunks[1].modifiedLines).toEqual(['new last']);
        });
    });

    describe('contiguous changes form single hunk', () => {
        it('groups consecutive changed lines into one hunk', () => {
            const base = 'line 1\nline 2\nline 3\nline 4\nline 5';
            const modified = 'line 1\nchanged 2\nchanged 3\nline 4\nline 5';
            const hunks = calculateHunks(base, modified);

            // Lines 2-3 are contiguous, should be one hunk
            expect(hunks.length).toBe(1);
            expect(hunks[0].type).toBe('modify');
            expect(hunks[0].baseLines).toEqual(['line 2', 'line 3']);
            expect(hunks[0].modifiedLines).toEqual(['changed 2', 'changed 3']);
        });

        it('groups consecutive additions into one hunk', () => {
            const base = 'line 1\nline 2';
            const modified = 'line 1\nnew A\nnew B\nnew C\nline 2';
            const hunks = calculateHunks(base, modified);

            expect(hunks.length).toBe(1);
            expect(hunks[0].type).toBe('add');
            expect(hunks[0].modifiedLines).toEqual(['new A', 'new B', 'new C']);
        });
    });

    describe('line positions', () => {
        it('correctly reports line positions for additions', () => {
            const base = 'line 1\nline 2';
            const modified = 'line 1\ninserted\nline 2';
            const hunks = calculateHunks(base, modified);

            expect(hunks[0].modifiedStartLine).toBe(1);
            expect(hunks[0].modifiedEndLine).toBe(2);
        });

        it('correctly reports line positions for deletions', () => {
            const base = 'line 1\nto delete\nline 2';
            const modified = 'line 1\nline 2';
            const hunks = calculateHunks(base, modified);

            expect(hunks[0].baseStartLine).toBe(1);
            expect(hunks[0].baseEndLine).toBe(2);
        });
    });
});

describe('formatHunksForDebug', () => {
    it('formats hunks in a readable way', () => {
        const base = 'hello\nworld';
        const modified = 'hello\nnew world';
        const hunks = calculateHunks(base, modified);
        const formatted = formatHunksForDebug(hunks);

        expect(formatted).toContain('MODIFY');
        expect(formatted).toContain('world');
        expect(formatted).toContain('new world');
    });
});
