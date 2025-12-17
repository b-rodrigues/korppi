/**
 * Pure function to compute the block mapping.
 * Exported for testing.
 * @param {Node} doc - ProseMirror document
 * @param {Function} serializer - Function (node) => string
 * @returns {Object} mapping object
 */
export function computeBlockMapping(doc, serializer) {
    // precise full markdown
    const fullMarkdown = serializer(doc);
    const blockMap = [];

    let currentMdOffset = 0;

    // Iterate top-level blocks
    doc.forEach((node, offset) => {
        const blockStartPm = offset;
        const blockEndPm = offset + node.nodeSize;

        // Serialize just this node
        let blockMd = "";
        try {
            blockMd = serializer(node);
        } catch (e) {
            console.warn("Block serialization failed", e);
            blockMd = node.textContent; // Fallback
        }

        // Skip separators (newlines) in fullMarkdown
        while (currentMdOffset < fullMarkdown.length &&
            (fullMarkdown[currentMdOffset] === '\n' || fullMarkdown[currentMdOffset] === ' ')) {
            currentMdOffset++;
        }

        const mdLength = blockMd.length;
        const mdStart = currentMdOffset;
        const mdEnd = mdStart + mdLength;

        blockMap.push({
            mdStart,
            mdEnd,
            pmStart: blockStartPm,
            pmEnd: blockEndPm,
        });

        // Advance
        currentMdOffset = mdEnd;
    });

    // Debug Block Map
    console.log("[BlockMap] Built Map:", blockMap);

    return {
        blockMap,
        charToPm: (mdOffset) => {
            console.log(`[BlockMap] Mapping Offset: ${mdOffset}`);

            // Find the block containing this offset
            // We use >= start and <= end to capture the trailing edge.
            const block = blockMap.find(b => mdOffset >= b.mdStart && mdOffset <= b.mdEnd);

            if (block) {
                console.log(`[BlockMap] Hit Block:`, block);
                // We are inside a block.
                const relativeMd = mdOffset - block.mdStart;

                const contentStart = block.pmStart + 1;
                const contentSize = block.pmEnd - block.pmStart - 2; // approximation (tags)
                // contentSize might be 0 for empty blocks
                if (contentSize <= 0) return block.pmStart + 1; // Start of empty block

                const relativeRatio = relativeMd / (block.mdEnd - block.mdStart);

                // Debug ratio
                // console.log(`[BlockMap] Ratio: ${relativeMd}/${block.mdEnd - block.mdStart} = ${relativeRatio}`);

                const result = Math.floor(contentStart + (relativeRatio * contentSize));
                console.log(`[BlockMap] Mapped to PM: ${result}`);
                return result;
            }

            // Gap logic
            const prevBlockIndex = blockMap.findIndex(b => mdOffset < b.mdStart);
            let prevBlock;
            if (prevBlockIndex === -1) {
                prevBlock = blockMap[blockMap.length - 1];
            } else if (prevBlockIndex > 0) {
                prevBlock = blockMap[prevBlockIndex - 1];
            }

            if (prevBlock) {
                if (mdOffset > prevBlock.mdEnd) {
                    console.log(`[BlockMap] Gap! Attaching to PrevBlock:`, prevBlock);
                    const result = Math.max(prevBlock.pmStart + 1, prevBlock.pmEnd - 1);
                    console.log(`[BlockMap] Gap Result: ${result}`);
                    return result;
                }
            }

            const nextBlock = blockMap.find(b => mdOffset < b.mdStart);
            if (nextBlock) {
                console.log(`[BlockMap] Fallback to Next Block:`, nextBlock);
                return nextBlock.pmStart;
            }

            return doc.content.size;
        }
    };
}
