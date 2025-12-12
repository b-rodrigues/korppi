# The .kmd File Format

Technical details about Korppi's native document format.

---

## Overview

The `.kmd` (Korppi Markdown Document) format is a ZIP-based container that stores:

- Markdown content with cross-reference support
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
├── format.json          # Format version info
├── meta.json            # Document metadata
├── patches/             # Timeline patches
│   ├── index.json       # Patch list
│   └── *.json           # Individual patches
├── comments.json        # Comments and threads
└── ystate.bin           # Yjs CRDT state (binary)
```

---

## format.json

Format version information for compatibility:

```json
{
    "kmd_version": "0.1.0",
    "min_reader_version": "0.1.0"
}
```

| Field | Description |
|-------|-------------|
| `kmd_version` | Version of Korppi that created this file |
| `min_reader_version` | Minimum version required to read this file |

---

## content.md

The main document content in Markdown format with support for cross-references.

### Basic Markdown

```markdown
# My Document

This is the actual markdown content of your document.
```

### Cross-References

Korppi supports Pandoc-compatible cross-reference syntax for figures, sections, and tables.

#### Section Labels

Add `{#sec:label}` at the end of any heading:

```markdown
# Introduction {#sec:intro}

## Methods {#sec:methods}

As described in @sec:intro, we use certain methods.
```

#### Figure Labels

Add `{#fig:label}` after an image to create a numbered figure:

```markdown
![Sales chart showing quarterly data](chart.png){#fig:sales}

As shown in @fig:sales, revenue increased.
```

#### Table Labels

Add `{#tbl:label}` on a new line after a table:

```markdown
| Quarter | Revenue |
|---------|---------|
| Q1      | $1.2M   |
| Q2      | $1.4M   |

{#tbl:quarterly}

See @tbl:quarterly for the data.
```

### Reference Syntax Summary

| Type | Label Syntax | Reference Syntax | Output |
|------|--------------|------------------|--------|
| Section | `{#sec:label}` | `@sec:label` | Section N |
| Figure | `{#fig:label}` | `@fig:label` | Figure N |
| Table | `{#tbl:label}` | `@tbl:label` | Table N |

---

## meta.json

Document metadata:

```json
{
    "uuid": "550e8400-e29b-41d4-a716-446655440000",
    "title": "My Document",
    "created_at": "2024-12-07T12:00:00Z",
    "modified_at": "2024-12-07T15:30:00Z",
    "authors": [
        {
            "id": "author-uuid",
            "name": "Jane Doe",
            "email": "jane@example.com",
            "joined_at": "2024-12-07T12:00:00Z",
            "role": "owner"
        }
    ],
    "settings": {
        "language": "en-US",
        "spell_check": true
    },
    "sync_state": {
        "last_export": "2024-12-07T14:00:00Z",
        "pending_patches": 0
    }
}
```

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `uuid` | string | Unique document identifier |
| `title` | string | Document title |
| `created_at` | string | ISO 8601 creation timestamp |
| `modified_at` | string | ISO 8601 last modified timestamp |
| `authors` | array | List of document authors |
| `settings` | object | Document settings |
| `sync_state` | object | Synchronization state |

### Author Object

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique author identifier |
| `name` | string | Display name |
| `email` | string? | Email address (optional) |
| `joined_at` | string? | When author joined (optional) |
| `role` | string? | Role: "owner", "editor", "viewer" (optional) |

### Settings Object

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `language` | string | "en-US" | Document language |
| `spell_check` | boolean | true | Enable spell checking |

### Sync State Object

| Field | Type | Description |
|-------|------|-------------|
| `last_export` | string? | Last export timestamp (optional) |
| `pending_patches` | number | Number of unsynced patches |

---

## patches/

The timeline patches directory contains version history:

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

## Export Formats

Korppi can export to several formats:

### DOCX Export

Export to Microsoft Word format with:

- Headings preserved with proper styles
- Bold, italic, and strikethrough formatting
- Ordered and unordered lists
- Tables with headers
- Code blocks with monospace font
- Block quotes
- **Cross-references resolved** (e.g., `@fig:sales` → "Figure 1")
- **Figure labels stripped** from output

### Markdown Export

Plain markdown with all cross-reference syntax preserved.

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

- `.kmd` files note their version in `format.json`
- Newer Korppi versions read older formats
- Format upgrades happen automatically on save
- Version checks prevent data loss from incompatible readers

### Markdown Compatibility

The `content.md` file is extended GitHub Flavored Markdown:

- **Standard GFM** features work in any markdown renderer
- **Cross-references** (`@type:label`) are Korppi/Pandoc-specific
- **Labels** (`{#type:label}`) are stripped on export to other formats

---

## Creating .kmd Programmatically

You can create a `.kmd` file with minimal structure:

```bash
# Create minimal structure
mkdir mydoc
echo "# Hello" > mydoc/content.md
echo '{"kmd_version":"0.1.0","min_reader_version":"0.1.0"}' > mydoc/format.json
echo '{"uuid":"123","title":"Hello","created_at":"2024-01-01T00:00:00Z","modified_at":"2024-01-01T00:00:00Z","authors":[]}' > mydoc/meta.json

# Package as .kmd
cd mydoc && zip -r ../hello.kmd . && cd ..
```

---

## Related

- [Export Options](export.html) - Exporting to other formats
- [Timeline](timeline.html) - Understanding patches
- [Cross-References](cross-references.html) - Using figures, sections, and tables
