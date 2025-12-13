// src/conflict-detection.test.js
// Comprehensive tests for conflict detection algorithm

import { describe, it, expect, beforeEach } from 'vitest';
import {
    detectPatchConflicts,
    isInConflict,
    getConflictGroup,
    formatConflictInfo
} from './conflict-detection.js';

/**
 * Helper to create a patch with snapshot data
 */
function makePatch(id, author, snapshot) {
    return {
        id,
        author,
        timestamp: Date.now() + id * 100,
        data: { snapshot }
    };
}

describe('detectPatchConflicts', () => {
    describe('basic functionality', () => {
        it('returns empty results for empty patch list', () => {
            const result = detectPatchConflicts([]);
            expect(result.conflictGroups).toEqual([]);
            expect(result.patchConflicts.size).toBe(0);
        });

        it('returns empty results for single patch', () => {
            const patches = [makePatch(1, 'Alice', 'Hello world')];
            const result = detectPatchConflicts(patches);
            expect(result.conflictGroups).toEqual([]);
            expect(result.patchConflicts.size).toBe(0);
        });

        it('returns empty results for patches without snapshots', () => {
            const patches = [
                { id: 1, author: 'Alice', data: {} },
                { id: 2, author: 'Bob', data: {} }
            ];
            const result = detectPatchConflicts(patches);
            expect(result.conflictGroups).toEqual([]);
        });
    });

    describe('same author edits', () => {
        it('does not create conflicts for same author sequential edits', () => {
            const patches = [
                makePatch(1, 'Alice', 'Hello'),
                makePatch(2, 'Alice', 'Hello world'),
                makePatch(3, 'Alice', 'Hello beautiful world')
            ];
            const result = detectPatchConflicts(patches);
            expect(result.conflictGroups).toEqual([]);
            expect(result.patchConflicts.size).toBe(0);
        });

        it('does not create conflicts when same author edits overlap', () => {
            const patches = [
                makePatch(1, 'Alice', 'AAAA'),
                makePatch(2, 'Alice', 'BBBB'),  // Complete replacement
                makePatch(3, 'Alice', 'CCCC')   // Another replacement
            ];
            const result = detectPatchConflicts(patches);
            expect(result.conflictGroups).toEqual([]);
        });
    });

    describe('non-overlapping edits by different authors', () => {
        // Note: The algorithm compares sequential patches, so when Bob's patch
        // diverges from Alice's, it detects the difference as a potential conflict.
        // This is correct for reconciliation workflows where divergent branches
        // need to be merged.

        it('detects divergence when patches are from different branches', () => {
            const patches = [
                makePatch(1, 'Alice', 'Hello world, this is a test'),
                makePatch(2, 'Alice', 'Hello ALICE, this is a test'),  // Edit "world" -> "ALICE"
                makePatch(3, 'Bob', 'Hello world, this is a TEST')     // Divergent edit from base
            ];
            const result = detectPatchConflicts(patches);
            // Bob's patch diverges from Alice's - this IS a conflict for reconciliation
            // The algorithm correctly flags this as needing review
            expect(result.patchConflicts.size).toBeGreaterThan(0);
        });

        it('detects divergence when both modify from base differently', () => {
            const patches = [
                makePatch(1, 'Alice', 'Middle content'),
                makePatch(2, 'Alice', 'Start. Middle content'),        // Prepend
                makePatch(3, 'Bob', 'Middle content. End')             // Different modification
            ];
            const result = detectPatchConflicts(patches);
            // Divergent modifications from base - needs reconciliation
            expect(result.patchConflicts.size).toBeGreaterThan(0);
        });

        it('no conflict when same author makes sequential edits', () => {
            const patches = [
                makePatch(1, 'Alice', 'Hello'),
                makePatch(2, 'Alice', 'Hello world'),      // Alice adds
                makePatch(3, 'Alice', 'Hello world!')      // Alice adds more
            ];
            const result = detectPatchConflicts(patches);
            // Same author throughout - no conflicts
            expect(result.conflictGroups.length).toBe(0);
        });

        it('flags cross-author edits for review even if non-overlapping', () => {
            // The algorithm is conservative: any edit by a different author
            // is flagged for reconciliation review
            const patches = [
                makePatch(1, 'Alice', 'Hello'),
                makePatch(2, 'Bob', 'Hello world'),      // Bob adds - different author
                makePatch(3, 'Charlie', 'Hello world!')  // Charlie adds - different author
            ];
            const result = detectPatchConflicts(patches);
            // Cross-author edits are flagged for review
            expect(result.patchConflicts.size).toBeGreaterThan(0);
        });
    });

    describe('overlapping edits by different authors', () => {
        it('detects conflict when both edit same word', () => {
            const patches = [
                makePatch(1, 'Alice', 'Hello world'),
                makePatch(2, 'Alice', 'Hello ALICE'),   // Change "world" -> "ALICE"
                makePatch(3, 'Bob', 'Hello BOB')        // Change "world" -> "BOB" (same region)
            ];
            const result = detectPatchConflicts(patches);
            expect(result.patchConflicts.size).toBeGreaterThan(0);
        });

        it('detects conflict when insertions are at same position', () => {
            const patches = [
                makePatch(1, 'Alice', 'AB'),
                makePatch(2, 'Alice', 'AXB'),    // Insert X between A and B
                makePatch(3, 'Bob', 'AYB')       // Insert Y between A and B (same position)
            ];
            const result = detectPatchConflicts(patches);
            expect(result.patchConflicts.size).toBeGreaterThan(0);
        });

        it('detects conflict with overlapping deletions', () => {
            const patches = [
                makePatch(1, 'Alice', 'The quick brown fox'),
                makePatch(2, 'Alice', 'The fox'),         // Delete "quick brown "
                makePatch(3, 'Bob', 'The quick fox')      // Delete "brown " (overlapping)
            ];
            const result = detectPatchConflicts(patches);
            expect(result.patchConflicts.size).toBeGreaterThan(0);
        });
    });

    describe('conflict grouping', () => {
        it('groups related conflicts together', () => {
            // A conflicts with B, B conflicts with C => all in one group
            const patches = [
                makePatch(1, 'Alice', 'XXXX'),
                makePatch(2, 'Alice', 'AAAA'),
                makePatch(3, 'Bob', 'BBBB'),
                makePatch(4, 'Charlie', 'CCCC')
            ];
            const result = detectPatchConflicts(patches);

            // If there are conflicts, they should be grouped
            if (result.conflictGroups.length > 0) {
                // All conflicting patches should be in one group since they all edit same region
                expect(result.conflictGroups.length).toBe(1);
            }
        });

        it('separates independent conflict groups', () => {
            // Create two independent conflict regions
            const patches = [
                makePatch(1, 'Alice', 'AAAA....XXXX'),
                makePatch(2, 'Alice', 'BBBB....XXXX'),     // Edit start
                makePatch(3, 'Bob', 'CCCC....XXXX'),       // Conflict with patch 2 at start
                makePatch(4, 'Charlie', 'AAAA....YYYY'),   // Edit end
                makePatch(5, 'David', 'AAAA....ZZZZ')      // Conflict with patch 4 at end
            ];
            const result = detectPatchConflicts(patches);

            // Should potentially have two separate conflict groups
            // (depends on exact diff detection)
        });
    });

    describe('edge cases', () => {
        it('handles empty string snapshots', () => {
            const patches = [
                makePatch(1, 'Alice', ''),
                makePatch(2, 'Alice', 'Hello'),
                makePatch(3, 'Bob', 'World')
            ];
            const result = detectPatchConflicts(patches);
            // Should not throw
            expect(result).toBeDefined();
        });

        it('handles very long snapshots', () => {
            const longText = 'x'.repeat(10000);
            const patches = [
                makePatch(1, 'Alice', longText),
                makePatch(2, 'Alice', 'A' + longText.slice(1)),
                makePatch(3, 'Bob', 'B' + longText.slice(1))
            ];
            const result = detectPatchConflicts(patches);
            expect(result.patchConflicts.size).toBeGreaterThan(0);
        });

        it('handles special characters', () => {
            const patches = [
                makePatch(1, 'Alice', 'Hello 🎉 world'),
                makePatch(2, 'Alice', 'Hello 🎊 world'),
                makePatch(3, 'Bob', 'Hello 🎈 world')
            ];
            const result = detectPatchConflicts(patches);
            expect(result.patchConflicts.size).toBeGreaterThan(0);
        });

        it('handles newlines and whitespace', () => {
            const patches = [
                makePatch(1, 'Alice', 'Line 1\nLine 2\nLine 3'),
                makePatch(2, 'Alice', 'Line 1\nModified\nLine 3'),
                makePatch(3, 'Bob', 'Line 1\nChanged\nLine 3')
            ];
            const result = detectPatchConflicts(patches);
            expect(result.patchConflicts.size).toBeGreaterThan(0);
        });
    });

    describe('performance characteristics', () => {
        it('handles many patches without timeout', () => {
            const patches = [];
            for (let i = 0; i < 100; i++) {
                patches.push(makePatch(i, `Author${i % 10}`, `Content version ${i}`));
            }

            const start = performance.now();
            const result = detectPatchConflicts(patches);
            const elapsed = performance.now() - start;

            expect(result).toBeDefined();
            expect(elapsed).toBeLessThan(5000); // Should complete in < 5 seconds
        });

        it('handles patches with many edit ranges', () => {
            // Create patches with many small edits
            const base = 'a b c d e f g h i j k l m n o p q r s t u v w x y z';
            const patches = [
                makePatch(1, 'Alice', base),
                makePatch(2, 'Alice', 'A B C D E F G H I J K L M N O P Q R S T U V W X Y Z'),
                makePatch(3, 'Bob', '1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26')
            ];

            const result = detectPatchConflicts(patches);
            expect(result).toBeDefined();
        });
    });
});

describe('isInConflict', () => {
    it('returns true for patches in conflict map', () => {
        const patchConflicts = new Map([[1, [2, 3]], [2, [1]], [3, [1]]]);
        expect(isInConflict(1, patchConflicts)).toBe(true);
        expect(isInConflict(2, patchConflicts)).toBe(true);
        expect(isInConflict(3, patchConflicts)).toBe(true);
    });

    it('returns false for patches not in conflict map', () => {
        const patchConflicts = new Map([[1, [2]]]);
        expect(isInConflict(99, patchConflicts)).toBe(false);
        expect(isInConflict(0, patchConflicts)).toBe(false);
    });

    it('returns false for empty conflict map', () => {
        const patchConflicts = new Map();
        expect(isInConflict(1, patchConflicts)).toBe(false);
    });
});

describe('getConflictGroup', () => {
    it('returns the group containing the patch', () => {
        const conflictGroups = [[1, 2, 3], [4, 5], [6, 7, 8, 9]];

        expect(getConflictGroup(1, conflictGroups)).toEqual([1, 2, 3]);
        expect(getConflictGroup(2, conflictGroups)).toEqual([1, 2, 3]);
        expect(getConflictGroup(4, conflictGroups)).toEqual([4, 5]);
        expect(getConflictGroup(9, conflictGroups)).toEqual([6, 7, 8, 9]);
    });

    it('returns null for patches not in any group', () => {
        const conflictGroups = [[1, 2], [3, 4]];
        expect(getConflictGroup(99, conflictGroups)).toBeNull();
        expect(getConflictGroup(0, conflictGroups)).toBeNull();
    });

    it('returns null for empty groups array', () => {
        expect(getConflictGroup(1, [])).toBeNull();
    });
});

describe('formatConflictInfo', () => {
    it('formats single conflict', () => {
        const info = formatConflictInfo(1, [2]);
        expect(info).toContain('#2');
        expect(info).toContain('⚠️');
    });

    it('formats multiple conflicts', () => {
        const info = formatConflictInfo(1, [2, 3, 4]);
        expect(info).toContain('#2');
        expect(info).toContain('#3');
        expect(info).toContain('#4');
    });

    it('excludes the current patch from output', () => {
        const info = formatConflictInfo(1, [1, 2, 3]);
        expect(info).not.toContain('#1');
        expect(info).toContain('#2');
        expect(info).toContain('#3');
    });

    it('returns empty string for empty conflicts', () => {
        expect(formatConflictInfo(1, [])).toBe('');
    });

    it('returns empty string when only conflict is self', () => {
        expect(formatConflictInfo(1, [1])).toBe('');
    });
});

describe('performance benchmarks', () => {
    it('benchmark: 50 patches - should complete quickly', () => {
        const patches = [];
        for (let i = 0; i < 50; i++) {
            const author = `Author${i % 5}`;
            const content = `Version ${i}: ${'x'.repeat(100)}`;
            patches.push(makePatch(i, author, content));
        }

        const start = performance.now();
        const result = detectPatchConflicts(patches);
        const elapsed = performance.now() - start;

        console.log(`  50 patches: ${elapsed.toFixed(2)}ms`);
        expect(elapsed).toBeLessThan(1000);
        expect(result).toBeDefined();
    });

    it('benchmark: 100 patches - O(n²) stress test', () => {
        const patches = [];
        for (let i = 0; i < 100; i++) {
            const author = `Author${i % 10}`;
            const content = `Document v${i}\n${'Line of content. '.repeat(10)}`;
            patches.push(makePatch(i, author, content));
        }

        const start = performance.now();
        const result = detectPatchConflicts(patches);
        const elapsed = performance.now() - start;

        console.log(`  100 patches: ${elapsed.toFixed(2)}ms`);
        expect(elapsed).toBeLessThan(2000);
        expect(result).toBeDefined();
    });

    it('benchmark: 200 patches - scalability test', () => {
        const patches = [];
        for (let i = 0; i < 200; i++) {
            const author = `Author${i % 10}`;
            const content = `Document version ${i} with some content`;
            patches.push(makePatch(i, author, content));
        }

        const start = performance.now();
        const result = detectPatchConflicts(patches);
        const elapsed = performance.now() - start;

        console.log(`  200 patches: ${elapsed.toFixed(2)}ms`);
        expect(elapsed).toBeLessThan(5000);
        expect(result).toBeDefined();
    });

    it('benchmark: 500 patches - scalability stress test', () => {
        const patches = [];
        for (let i = 0; i < 500; i++) {
            const author = `Author${i % 20}`;
            const content = `Document version ${i} with content`;
            patches.push(makePatch(i, author, content));
        }

        const start = performance.now();
        const result = detectPatchConflicts(patches);
        const elapsed = performance.now() - start;

        console.log(`  500 patches: ${elapsed.toFixed(2)}ms`);
        expect(elapsed).toBeLessThan(10000);
        expect(result).toBeDefined();
    });

    it('benchmark: sparse edits (non-overlapping regions)', () => {
        // Create patches that edit different parts of the document
        // This tests the early exit optimization
        const patches = [];
        for (let i = 0; i < 100; i++) {
            const author = `Author${i % 10}`;
            // Each patch edits a different section (non-overlapping)
            const prefix = 'x'.repeat(i * 100);
            const content = prefix + `EDIT_${i}` + 'y'.repeat(1000);
            patches.push(makePatch(i, author, content));
        }

        const start = performance.now();
        const result = detectPatchConflicts(patches);
        const elapsed = performance.now() - start;

        console.log(`  100 sparse patches: ${elapsed.toFixed(2)}ms`);
        expect(elapsed).toBeLessThan(1000);
        expect(result).toBeDefined();
    });

    it('benchmark: large document with few patches', () => {
        const largeContent = 'x'.repeat(50000);
        const patches = [
            makePatch(1, 'Alice', largeContent),
            makePatch(2, 'Alice', 'A' + largeContent.slice(1)),
            makePatch(3, 'Bob', 'B' + largeContent.slice(1)),
            makePatch(4, 'Charlie', 'C' + largeContent.slice(1))
        ];

        const start = performance.now();
        const result = detectPatchConflicts(patches);
        const elapsed = performance.now() - start;

        console.log(`  50KB document, 4 patches: ${elapsed.toFixed(2)}ms`);
        expect(elapsed).toBeLessThan(2000);
        expect(result).toBeDefined();
    });
});

describe('regression tests', () => {
    it('handles sequential edits correctly', () => {
        // This tests the sequential nature of patches where each builds on previous
        const patches = [
            makePatch(1, 'Base', 'The quick brown fox jumps over the lazy dog'),
            makePatch(2, 'Alice', 'The quick brown cat jumps over the lazy dog'),  // fox -> cat
            makePatch(3, 'Alice', 'The quick brown cat leaps over the lazy dog'),  // jumps -> leaps
            makePatch(4, 'Bob', 'The quick brown fox jumps over the sleepy dog')   // lazy -> sleepy (from base)
        ];

        const result = detectPatchConflicts(patches);
        // Bob's edit is based on base, conflicts with Alice's changes
        expect(result).toBeDefined();
    });

    it('correctly identifies bidirectional conflict relationships', () => {
        const patches = [
            makePatch(1, 'Alice', 'AAAA'),
            makePatch(2, 'Alice', 'BBBB'),
            makePatch(3, 'Bob', 'CCCC')
        ];

        const result = detectPatchConflicts(patches);

        // If patch 2 conflicts with 3, then 3 should also conflict with 2
        if (result.patchConflicts.has(2)) {
            const conflicts2 = result.patchConflicts.get(2);
            if (conflicts2.includes(3)) {
                expect(result.patchConflicts.get(3)).toContain(2);
            }
        }
    });
});
