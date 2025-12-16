// src/utils.test.js
// Unit tests for utility functions

import { describe, it, expect } from 'vitest';
import { tokenize, stripMarkdown, isWhitespace, escapeHtml } from './utils.js';

describe('tokenize', () => {
    it('returns empty array for empty string', () => {
        expect(tokenize('')).toEqual([]);
    });

    it('returns empty array for null/undefined', () => {
        expect(tokenize(null)).toEqual([]);
        expect(tokenize(undefined)).toEqual([]);
    });

    it('splits on whitespace boundaries', () => {
        expect(tokenize('hello world')).toEqual(['hello', ' ', 'world']);
    });

    it('handles multiple spaces', () => {
        expect(tokenize('a  b')).toEqual(['a', '  ', 'b']);
    });

    it('handles newlines', () => {
        expect(tokenize('a\nb')).toEqual(['a', '\n', 'b']);
    });

    it('handles tabs', () => {
        expect(tokenize('a\tb')).toEqual(['a', '\t', 'b']);
    });
});

describe('stripMarkdown', () => {
    describe('empty and null inputs', () => {
        it('returns empty string for empty input', () => {
            expect(stripMarkdown('')).toBe('');
        });

        it('returns empty string for null', () => {
            expect(stripMarkdown(null)).toBe('');
        });

        it('returns empty string for undefined', () => {
            expect(stripMarkdown(undefined)).toBe('');
        });
    });

    describe('bold and italic', () => {
        it('strips **bold**', () => {
            expect(stripMarkdown('**bold**')).toBe('bold');
        });

        it('strips __bold__', () => {
            expect(stripMarkdown('__bold__')).toBe('bold');
        });

        it('strips *italic*', () => {
            expect(stripMarkdown('*italic*')).toBe('italic');
        });

        it('strips _italic_', () => {
            expect(stripMarkdown('_italic_')).toBe('italic');
        });

        it('handles bold in sentence', () => {
            expect(stripMarkdown('This is **important** text')).toBe('This is important text');
        });
    });

    describe('strikethrough', () => {
        it('strips ~~strikethrough~~', () => {
            expect(stripMarkdown('~~deleted~~')).toBe('deleted');
        });

        it('handles strikethrough in sentence', () => {
            expect(stripMarkdown('This is ~~wrong~~ correct')).toBe('This is wrong correct');
        });
    });

    describe('inline code', () => {
        it('strips `code`', () => {
            expect(stripMarkdown('`code`')).toBe('code');
        });

        it('handles code in sentence', () => {
            expect(stripMarkdown('Use `npm install` command')).toBe('Use npm install command');
        });
    });

    describe('headings', () => {
        it('strips # heading', () => {
            expect(stripMarkdown('# Title')).toBe('Title');
        });

        it('strips ## heading', () => {
            expect(stripMarkdown('## Subtitle')).toBe('Subtitle');
        });

        it('strips ### heading', () => {
            expect(stripMarkdown('### Section')).toBe('Section');
        });

        it('handles heading with trailing text', () => {
            expect(stripMarkdown('# Title\nParagraph')).toBe('Title\nParagraph');
        });
    });

    describe('links and images', () => {
        it('strips [text](url) link', () => {
            expect(stripMarkdown('[click here](https://example.com)')).toBe('click here');
        });

        it('strips ![alt](url) image', () => {
            expect(stripMarkdown('![logo](image.png)')).toBe('logo');
        });

        it('handles link in sentence', () => {
            expect(stripMarkdown('Check [this link](url) out')).toBe('Check this link out');
        });
    });

    describe('blockquotes', () => {
        it('strips > quote marker', () => {
            expect(stripMarkdown('> quoted text')).toBe('quoted text');
        });

        it('handles multi-line quotes', () => {
            expect(stripMarkdown('> line1\n> line2')).toBe('line1\nline2');
        });
    });

    describe('lists', () => {
        it('strips - list marker', () => {
            expect(stripMarkdown('- item')).toBe('item');
        });

        it('strips * list marker', () => {
            expect(stripMarkdown('* item')).toBe('item');
        });

        it('strips + list marker', () => {
            expect(stripMarkdown('+ item')).toBe('item');
        });

        it('strips numbered list marker', () => {
            expect(stripMarkdown('1. item')).toBe('item');
        });

        it('strips numbered list with larger number', () => {
            expect(stripMarkdown('10. item')).toBe('item');
        });
    });

    describe('horizontal rules', () => {
        it('removes ---', () => {
            expect(stripMarkdown('---')).toBe('');
        });

        it('removes ***', () => {
            expect(stripMarkdown('***')).toBe('');
        });

        it('removes ___', () => {
            expect(stripMarkdown('___')).toBe('');
        });
    });

    describe('complex documents', () => {
        it('handles typical markdown document', () => {
            const markdown = `# Title

This is **bold** and *italic* text.

## Section

- Item 1
- Item 2

Check [this link](url) for more.`;

            // Note: list markers are removed, which may cause lines to join
            const result = stripMarkdown(markdown);

            // Verify key transformations happened
            expect(result).toContain('Title');
            expect(result).not.toContain('#');
            expect(result).toContain('bold');
            expect(result).not.toContain('**');
            expect(result).toContain('italic');
            expect(result).not.toContain('*');
            expect(result).toContain('Item 1');
            expect(result).not.toContain('-');
            expect(result).toContain('this link');
            expect(result).not.toContain('[');
            expect(result).not.toContain(']');
            expect(result).not.toContain('(url)');
        });
    });

    describe('plain text passthrough', () => {
        it('returns plain text unchanged', () => {
            expect(stripMarkdown('Just plain text')).toBe('Just plain text');
        });

        it('preserves single newlines', () => {
            expect(stripMarkdown('line1\nline2')).toBe('line1\nline2');
        });

        it('collapses multiple newlines to single newline', () => {
            // This matches how ProseMirror represents block boundaries
            expect(stripMarkdown('line1\n\nline2')).toBe('line1\nline2');
            expect(stripMarkdown('line1\n\n\nline2')).toBe('line1\nline2');
        });
    });
});

describe('isWhitespace', () => {
    it('returns true for space', () => {
        expect(isWhitespace(32)).toBe(true);
    });

    it('returns true for tab', () => {
        expect(isWhitespace(9)).toBe(true);
    });

    it('returns true for newline', () => {
        expect(isWhitespace(10)).toBe(true);
    });

    it('returns true for carriage return', () => {
        expect(isWhitespace(13)).toBe(true);
    });

    it('returns false for letter', () => {
        expect(isWhitespace(65)).toBe(false);
    });
});

// Note: escapeHtml tests are skipped because they require browser DOM (document object)
describe.skip('escapeHtml', () => {
    it('escapes <', () => {
        expect(escapeHtml('<')).toBe('&lt;');
    });

    it('escapes >', () => {
        expect(escapeHtml('>')).toBe('&gt;');
    });

    it('escapes &', () => {
        expect(escapeHtml('&')).toBe('&amp;');
    });

    it('escapes mixed HTML', () => {
        expect(escapeHtml('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert("xss")&lt;/script&gt;');
    });
});
