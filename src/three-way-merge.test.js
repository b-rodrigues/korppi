// src/three-way-merge.test.js
// Unit tests for three-way merge algorithm

import { describe, it, expect } from 'vitest';
import { mergeText } from './three-way-merge.js';

describe('mergeText', () => {
    describe('fast paths', () => {
        it('returns base when all three are identical', () => {
            const result = mergeText('hello', 'hello', 'hello');
            expect(result).toBe('hello');
        });

        it('returns canonical when local equals base', () => {
            const result = mergeText('hello', 'hello', 'hello world');
            expect(result).toBe('hello world');
        });

        it('returns local when canonical equals base', () => {
            const result = mergeText('hello', 'hello world', 'hello');
            expect(result).toBe('hello world');
        });

        it('returns local when local equals canonical (both diverged identically)', () => {
            const result = mergeText('hello', 'hello world', 'hello world');
            expect(result).toBe('hello world');
        });

        it('handles empty base', () => {
            const result = mergeText('', 'local', 'canonical');
            expect(result).toContain('local');
            expect(result).toContain('canonical');
        });

        it('handles empty local', () => {
            const result = mergeText('base', '', 'canonical');
            expect(result).toBe('canonical');
        });

        it('handles empty canonical', () => {
            const result = mergeText('base', 'local', '');
            expect(result).toBe('local');
        });

        it('handles all empty', () => {
            const result = mergeText('', '', '');
            expect(result).toBe('');
        });
    });

    describe('non-overlapping edits', () => {
        it('merges additions at different positions', () => {
            const base = 'hello world';
            const local = 'hello beautiful world';
            const canonical = 'hello world today';

            const result = mergeText(base, local, canonical);
            expect(result).toContain('beautiful');
            expect(result).toContain('today');
        });

        it('merges deletions at different positions', () => {
            const base = 'one two three four';
            const local = 'one three four';  // removed 'two'
            const canonical = 'one two three'; // removed 'four'

            const result = mergeText(base, local, canonical);
            expect(result).not.toContain('two');
            expect(result).not.toContain('four');
            expect(result).toContain('one');
            expect(result).toContain('three');
        });

        it('merges one addition and one deletion', () => {
            const base = 'hello world';
            const local = 'hello there world';  // added 'there'
            const canonical = 'hello';           // removed 'world'

            const result = mergeText(base, local, canonical);
            expect(result).toContain('hello');
            expect(result).toContain('there');
            expect(result).not.toContain('world');
        });
    });

    describe('overlapping edits', () => {
        it('handles both editing the same word differently', () => {
            const base = 'hello world';
            const local = 'hello there';
            const canonical = 'hello everyone';

            const result = mergeText(base, local, canonical);
            // Both removed 'world' and added different words
            // Algorithm should include both additions
            expect(result).toContain('hello');
        });

        it('handles one adding and one removing at same position', () => {
            const base = 'a b c';
            const local = 'a x b c';   // added 'x' after 'a'
            const canonical = 'a c';    // removed 'b'

            const result = mergeText(base, local, canonical);
            expect(result).toContain('a');
            expect(result).toContain('x');
            expect(result).toContain('c');
        });
    });

    describe('word-level merging', () => {
        it('preserves whitespace between words', () => {
            const base = 'word1 word2';
            const local = 'word1 word2 word3';
            const canonical = 'word1 word2';

            const result = mergeText(base, local, canonical);
            expect(result).toBe('word1 word2 word3');
        });

        it('handles multiple spaces', () => {
            const base = 'a  b';  // two spaces
            const local = 'a  b  c';
            const canonical = 'a  b';

            const result = mergeText(base, local, canonical);
            expect(result).toContain('a');
            expect(result).toContain('b');
            expect(result).toContain('c');
        });

        it('handles newlines', () => {
            const base = 'line1\nline2';
            const local = 'line1\nline2\nline3';
            const canonical = 'line1\nline2';

            const result = mergeText(base, local, canonical);
            expect(result).toContain('line1');
            expect(result).toContain('line2');
            expect(result).toContain('line3');
        });

        it('handles tabs', () => {
            const base = 'col1\tcol2';
            const local = 'col1\tcol2\tcol3';
            const canonical = 'col1\tcol2';

            const result = mergeText(base, local, canonical);
            expect(result).toContain('col1');
            expect(result).toContain('col2');
            expect(result).toContain('col3');
        });
    });

    describe('real-world scenarios', () => {
        it('merges markdown document edits', () => {
            const base = '# Title\n\nParagraph one.\n\nParagraph two.';
            const local = '# Title\n\nParagraph one.\n\nParagraph two.\n\nNew paragraph.';
            const canonical = '# New Title\n\nParagraph one.\n\nParagraph two.';

            const result = mergeText(base, local, canonical);
            expect(result).toContain('New Title');
            expect(result).toContain('New paragraph');
        });

        it('merges code edits', () => {
            const base = 'function foo() {\n  return 1;\n}';
            const local = 'function foo() {\n  return 1;\n}\n\nfunction bar() {}';
            const canonical = 'function foo() {\n  return 2;\n}';

            const result = mergeText(base, local, canonical);
            expect(result).toContain('function bar');
        });

        it('handles sentence-level edits in prose', () => {
            const base = 'The quick brown fox jumps.';
            const local = 'The quick brown fox leaps.';  // changed 'jumps' to 'leaps'
            const canonical = 'A quick brown fox jumps.';  // changed 'The' to 'A'

            const result = mergeText(base, local, canonical);
            // Both changes should be applied
            expect(result).toContain('A');
            expect(result).toContain('leaps');
        });
    });

    describe('edge cases', () => {
        it('handles single character strings', () => {
            const result = mergeText('a', 'b', 'c');
            // All three different single chars
            expect(typeof result).toBe('string');
        });

        it('handles unicode characters', () => {
            const base = 'hello 世界';
            const local = 'hello 世界!';
            const canonical = 'hi 世界';

            const result = mergeText(base, local, canonical);
            expect(result).toContain('世界');
        });

        it('handles emoji', () => {
            const base = 'hello 👋';
            const local = 'hello 👋 world';
            const canonical = 'hello 👋';

            const result = mergeText(base, local, canonical);
            expect(result).toContain('👋');
            expect(result).toContain('world');
        });

        it('handles complete replacement by one side', () => {
            const base = 'original content';
            const local = 'completely different';
            const canonical = 'original content';

            const result = mergeText(base, local, canonical);
            expect(result).toBe('completely different');
        });

        it('handles both sides making complete replacement', () => {
            const base = 'original';
            const local = 'local version';
            const canonical = 'canonical version';

            const result = mergeText(base, local, canonical);
            // Both removed 'original' and added different content
            expect(result).not.toBe('original');
        });
    });

    describe('large input handling', () => {
        it('handles inputs that trigger lcsPairsLarge (>10000 token pairs)', () => {
            // Create large texts with many tokens
            const words = Array(150).fill('word').join(' ');
            const base = words;
            const local = words + ' extra';
            const canonical = words;

            const result = mergeText(base, local, canonical);
            expect(result).toContain('extra');
        });
    });

    describe('idempotency and commutativity', () => {
        it('merging same change from both sides produces that change', () => {
            const base = 'hello world';
            const change = 'hello there';

            const result = mergeText(base, change, change);
            expect(result).toBe('hello there');
        });

        it('self-merge returns same content', () => {
            const text = 'some content here';
            const result = mergeText(text, text, text);
            expect(result).toBe(text);
        });
    });
});
