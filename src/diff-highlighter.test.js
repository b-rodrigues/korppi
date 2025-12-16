// src/diff-highlighter.test.js
// Unit tests for character-level diff highlighting

import { describe, it, expect } from 'vitest';
import { calculateCharDiff, diffToRanges, buildInlineDiffText } from './diff-highlighter.js';

describe('calculateCharDiff', () => {
    describe('fast paths', () => {
        it('returns empty array for two empty strings', () => {
            const result = calculateCharDiff('', '');
            expect(result).toEqual([]);
        });

        it('returns single equal op for identical non-empty strings', () => {
            const result = calculateCharDiff('hello world', 'hello world');
            expect(result).toEqual([{ type: 'equal', text: 'hello world' }]);
        });

        it('returns single add op when old is empty', () => {
            const result = calculateCharDiff('', 'hello');
            expect(result).toEqual([{ type: 'add', text: 'hello' }]);
        });

        it('returns single delete op when new is empty', () => {
            const result = calculateCharDiff('hello', '');
            expect(result).toEqual([{ type: 'delete', text: 'hello' }]);
        });
    });

    describe('word-level diffing', () => {
        it('detects single word addition at end', () => {
            const result = calculateCharDiff('hello', 'hello world');
            expect(result).toEqual([
                { type: 'equal', text: 'hello' },
                { type: 'add', text: ' world' }
            ]);
        });

        it('detects single word addition at start', () => {
            const result = calculateCharDiff('world', 'hello world');
            expect(result).toEqual([
                { type: 'add', text: 'hello ' },
                { type: 'equal', text: 'world' }
            ]);
        });

        it('detects single word deletion', () => {
            const result = calculateCharDiff('hello world', 'hello');
            expect(result).toEqual([
                { type: 'equal', text: 'hello' },
                { type: 'delete', text: ' world' }
            ]);
        });

        it('detects word replacement', () => {
            const result = calculateCharDiff('hello world', 'hello there');
            expect(result).toEqual([
                { type: 'equal', text: 'hello ' },
                { type: 'delete', text: 'world' },
                { type: 'add', text: 'there' }
            ]);
        });

        it('detects multiple word changes', () => {
            const result = calculateCharDiff('the quick fox', 'a slow dog');
            // LCS finds nothing common, so we get delete then add
            expect(result.some(op => op.type === 'delete')).toBe(true);
            expect(result.some(op => op.type === 'add')).toBe(true);
        });
    });

    describe('whitespace handling', () => {
        it('preserves whitespace tokens', () => {
            const result = calculateCharDiff('a  b', 'a   b');
            // Should detect the whitespace change
            const hasWhitespaceChange = result.some(op =>
                (op.type === 'add' || op.type === 'delete') && /^\s+$/.test(op.text)
            );
            expect(hasWhitespaceChange).toBe(true);
        });

        it('handles newlines correctly', () => {
            const result = calculateCharDiff('line1\nline2', 'line1\nline2\nline3');
            expect(result).toContainEqual({ type: 'add', text: '\nline3' });
        });

        it('handles tabs correctly', () => {
            const result = calculateCharDiff('a\tb', 'a\t\tb');
            const hasTabChange = result.some(op => op.text.includes('\t'));
            expect(hasTabChange).toBe(true);
        });
    });

    describe('edge cases', () => {
        it('handles complete text replacement', () => {
            const result = calculateCharDiff('abc', 'xyz');
            expect(result).toEqual([
                { type: 'delete', text: 'abc' },
                { type: 'add', text: 'xyz' }
            ]);
        });

        it('handles single character strings', () => {
            const result = calculateCharDiff('a', 'b');
            expect(result).toEqual([
                { type: 'delete', text: 'a' },
                { type: 'add', text: 'b' }
            ]);
        });

        it('handles unicode characters', () => {
            const result = calculateCharDiff('hello 世界', 'hello 世界!');
            // Note: '世界!' is treated as a single token (no space separator)
            // So the diff sees it as replacing '世界' with '世界!'
            expect(result).toContainEqual({ type: 'equal', text: 'hello ' });
            expect(result).toContainEqual({ type: 'delete', text: '世界' });
            expect(result).toContainEqual({ type: 'add', text: '世界!' });
        });

        it('handles emoji', () => {
            const result = calculateCharDiff('hello 👋', 'hello 👋🌍');
            expect(result.some(op => op.type === 'add' && op.text.includes('🌍'))).toBe(true);
        });
    });

    describe('merging consecutive operations', () => {
        it('merges consecutive additions', () => {
            const result = calculateCharDiff('a c', 'a b b c');
            // Should not have consecutive 'add' operations of the same type
            for (let i = 1; i < result.length; i++) {
                if (result[i].type === result[i-1].type) {
                    // This would indicate a bug - consecutive same-type ops should be merged
                    expect(result[i].type).not.toBe(result[i-1].type);
                }
            }
        });

        it('merges consecutive deletions', () => {
            const result = calculateCharDiff('a b b c', 'a c');
            for (let i = 1; i < result.length; i++) {
                expect(result[i].type === result[i-1].type).toBe(false);
            }
        });
    });

    describe('large input handling', () => {
        it('handles inputs that trigger lcsLarge (>10000 token pairs)', () => {
            // Create strings with many tokens to trigger the large input path
            const words = Array(150).fill('word').join(' ');
            const wordsModified = words.replace('word', 'changed');

            const result = calculateCharDiff(words, wordsModified);
            expect(result.length).toBeGreaterThan(0);
            expect(result.some(op => op.type === 'delete' && op.text === 'word')).toBe(true);
            expect(result.some(op => op.type === 'add' && op.text === 'changed')).toBe(true);
        });
    });
});

describe('diffToRanges', () => {
    it('returns empty arrays for empty diff', () => {
        const result = diffToRanges([]);
        expect(result).toEqual({ additions: [], deletions: [] });
    });

    it('returns empty arrays for equal-only diff', () => {
        const diff = [{ type: 'equal', text: 'hello world' }];
        const result = diffToRanges(diff);
        expect(result.additions).toEqual([]);
        expect(result.deletions).toEqual([]);
    });

    it('calculates correct ranges for addition', () => {
        const diff = [
            { type: 'equal', text: 'hello ' },
            { type: 'add', text: 'beautiful ' },
            { type: 'equal', text: 'world' }
        ];
        const result = diffToRanges(diff);
        expect(result.additions).toEqual([{ from: 6, to: 16 }]);
        expect(result.deletions).toEqual([]);
    });

    it('calculates correct position for deletion', () => {
        const diff = [
            { type: 'equal', text: 'hello ' },
            { type: 'delete', text: 'cruel ' },
            { type: 'equal', text: 'world' }
        ];
        const result = diffToRanges(diff);
        expect(result.additions).toEqual([]);
        expect(result.deletions).toEqual([{ text: 'cruel ', pos: 6 }]);
    });

    it('handles mixed additions and deletions', () => {
        const diff = [
            { type: 'equal', text: 'a ' },
            { type: 'delete', text: 'b' },
            { type: 'add', text: 'c' },
            { type: 'equal', text: ' d' }
        ];
        const result = diffToRanges(diff);
        expect(result.deletions).toEqual([{ text: 'b', pos: 2 }]);
        expect(result.additions).toEqual([{ from: 2, to: 3 }]);
    });
});

describe('buildInlineDiffText', () => {
    it('returns empty string for empty diff', () => {
        expect(buildInlineDiffText([])).toBe('');
    });

    it('returns full text for equal-only diff', () => {
        const diff = [{ type: 'equal', text: 'hello world' }];
        expect(buildInlineDiffText(diff)).toBe('hello world');
    });

    it('includes additions in output', () => {
        const diff = [
            { type: 'equal', text: 'hello ' },
            { type: 'add', text: 'beautiful ' },
            { type: 'equal', text: 'world' }
        ];
        expect(buildInlineDiffText(diff)).toBe('hello beautiful world');
    });

    it('includes deletions in output', () => {
        const diff = [
            { type: 'equal', text: 'hello ' },
            { type: 'delete', text: 'cruel ' },
            { type: 'equal', text: 'world' }
        ];
        expect(buildInlineDiffText(diff)).toBe('hello cruel world');
    });
});
