import { describe, it, expect } from 'vitest';
import { computeBlockMapping } from './mapping-logic.js';

// Mock ProseMirror Node
class MockNode {
    constructor(nodeSize, contentText, type = 'paragraph') {
        this.nodeSize = nodeSize;
        this.contentText = contentText;
        this.type = type;
    }
}

// Mock Document
class MockDoc {
    constructor(children) {
        this.children = children;
        this.content = {
            size: children.reduce((acc, c) => acc + c.nodeSize, 0)
        };
    }

    forEach(callback) {
        let offset = 0;
        this.children.forEach((child, index) => {
            callback(child, offset, index);
            offset += child.nodeSize;
        });
    }
}

describe('computeBlockMapping', () => {
    /*
     * Scenario: Header followed by Paragraph
     * MD: "# Header\n\nText"
     * 
     * Header Node: size 8 (<h1> + Header + </h1>)
     * Serializer: "# Header" (Length 8)
     * 
     * Paragraph Node: size 6 (<p> + Text + </p>)
     * Serializer: "Text"
     */
    it('correctly maps end of header to end of header content', () => {
        const headerNode = new MockNode(8, "Header", 'heading');
        const paraNode = new MockNode(6, "Text", 'paragraph');
        const doc = new MockDoc([headerNode, paraNode]);

        // Mock serializer
        // Full markdown will include separators
        const serializer = (node) => {
            if (node === doc) return "# Header\n\nText";
            if (node === headerNode) return "# Header";
            if (node === paraNode) return "Text";
            return "";
        };

        const result = computeBlockMapping(doc, serializer);

        // Verify block map
        expect(result.blockMap.length).toBe(2);

        // Header: MD [0, 8), PM [0, 8)
        expect(result.blockMap[0].mdStart).toBe(0);
        expect(result.blockMap[0].mdEnd).toBe(8);
        expect(result.blockMap[0].pmStart).toBe(0);
        expect(result.blockMap[0].pmEnd).toBe(8);

        // Para: MD [10, 14), PM [8, 14)  (offset by 2 chars for \n\n)
        expect(result.blockMap[1].mdStart).toBe(10);
        expect(result.blockMap[1].mdEnd).toBe(14);
        expect(result.blockMap[1].pmStart).toBe(8);

        // TEST THE BUG (Refined):
        // User inserts at end of header line (Offset 8) OR in the newline gap (Offset 9, 10).
        // It must map to the END OF HEADER CONTENT (7), not start of paragraph (8/9).

        expect(result.charToPm(8)).toBe(7); // End of Header content
        expect(result.charToPm(9)).toBe(7); // First newline -> End of Header content
        // expect(result.charToPm(10)).toBe(7); // WRONG. 10 is 'T' (start of next block).

        // 10 is the start of "Text". PM Block 1 starts at 8. Content starts at 9.
        expect(result.charToPm(10)).toBe(9);
        expect(result.charToPm(11)).toBe(10); // 'e' -> 10
    });
});
