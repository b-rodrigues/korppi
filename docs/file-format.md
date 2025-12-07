# The .kmd File Format

Technical details about Korppi's native document format.

---

## Overview

The `.kmd` (Korppi Markdown Document) format is a ZIP-based container that stores:

- Markdown content
- Version history (timeline)
- Comments and annotations
- Document metadata
- Collaborative editing state

---

## File Structure

A `.kmd` file is a ZIP archive with this structure:

```
document.kmd (ZIP archive)
├── content.md           # Main markdown content
├── meta.json            # Document metadata
├── patches/             # Timeline patches
│   ├── index.json       # Patch list
│   └── *.json           # Individual patches
├── comments.json        # Comments and threads
└── ystate.bin           # Yjs CRDT state (binary)
```

---

## content.md

The main document content in plain Markdown format.

```markdown
# My Document

This is the actual markdown content of your document.
```

---

## meta.json

Document metadata:

```json
{
    "id": "uuid-here",
    "title": "My Document",
    "created_at": "2024-12-07T12:00:00Z",
    "modified_at": "2024-12-07T15:30:00Z",
    "author": {
        "name": "Jane Doe",
        "color": "#ff5733"
    },
    "version": "0.1.0"
}
```

---

## patches/

The timeline patches directory contains:

### index.json

List of all patches:

```json
{
    "patches": [
        "patch-001.json",
        "patch-002.json"
    ]
}
```

### patch-*.json

Individual patch files:

```json
{
    "id": "patch-001",
    "timestamp": "2024-12-07T12:00:00Z",
    "author": "Jane Doe",
    "description": "Added introduction section",
    "status": "approved",
    "lines": {
        "start": 1,
        "end": 15
    },
    "diff": {
        "added": 10,
        "removed": 0,
        "modified": 5
    }
}
```

---

## comments.json

All comments and threads:

```json
{
    "comments": [
        {
            "id": "comment-001",
            "author": {
                "name": "Jane Doe",
                "color": "#ff5733"
            },
            "content": "This needs clarification",
            "created_at": "2024-12-07T12:00:00Z",
            "status": "unresolved",
            "anchor": {
                "start": 100,
                "end": 150
            },
            "replies": []
        }
    ]
}
```

---

## ystate.bin

Binary Yjs CRDT state for real-time sync.

This file enables:

- Conflict-free editing
- State synchronization
- Undo/redo history
- Collaborative editing

⚠️ This file is binary and not human-readable.

---

## Working with .kmd Files

### Extracting Content

To extract just the markdown:

```bash
unzip -p document.kmd content.md > output.md
```

### Inspecting Metadata

```bash
unzip -p document.kmd meta.json | jq .
```

### Full Extraction

```bash
unzip document.kmd -d extracted/
```

---

## Compatibility

### Version Compatibility

- `.kmd` files note their version in `meta.json`
- Newer Korppi versions read older formats
- Format upgrades happen automatically on save

### Markdown Compatibility

The `content.md` file is standard GitHub Flavored Markdown and can be:

- Opened in any text editor
- Rendered by GitHub, GitLab, etc.
- Processed by pandoc, mkdocs, etc.

---

## Creating .kmd Programmatically

You can create a `.kmd` file with minimal structure:

```bash
# Create minimal structure
mkdir mydoc
echo "# Hello" > mydoc/content.md
echo '{"id":"123","title":"Hello","version":"0.1.0"}' > mydoc/meta.json

# Package as .kmd
cd mydoc && zip -r ../hello.kmd . && cd ..
```

---

## Related

- [Export Options](export.html) - Exporting to other formats
- [Timeline](timeline.html) - Understanding patches
