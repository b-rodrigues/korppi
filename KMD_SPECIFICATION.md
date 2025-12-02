# KMD (Korppi Markdown Document) Specification

**Version:** 1.0.0-draft  
**Status:** Draft  
**Last Updated:** December 2024

## Overview

KMD (Korppi Markdown Document) is a portable, self-contained document format designed for collaborative Markdown editing. It encapsulates document content, change history, author information, and metadata in a single file that can be easily shared via email or file transfer without requiring a central server.

### Design Principles

1. **Self-contained**: All information needed to reconstruct the document and its history is stored within the file
2. **Conflict-free**: Built on Yjs CRDT for automatic merge of concurrent edits
3. **Portable**: Standard formats (ZIP, SQLite, JSON) for maximum compatibility
4. **Offline-first**: Works without network connectivity
5. **Future-proof**: Versioned format with backward compatibility guarantees

### Key Design Decision

**No `content.md` file is stored.** The `state.yjs` binary IS the content. Plain Markdown can be reconstructed on-the-fly from the Yjs CRDT state at any time. This approach:

- Avoids redundancy between stored Markdown and Yjs state
- Prevents synchronization issues
- Ensures the Yjs state is always the single source of truth
- Simplifies the format and reduces file size

## File Structure

A KMD file is a ZIP archive with the extension `.kmd` containing the following structure:

```
document.kmd (ZIP archive)
├── format.json          # Format version and compatibility info
├── state.yjs            # Yjs CRDT document state (binary)
├── history.sqlite       # Semantic patch history (SQLite3)
├── meta.json            # Document metadata
├── authors/             # Author information cache
│   └── {uuid}.json      # Per-author profile snapshots
└── assets/              # Embedded images/attachments (future)
```

## File Specifications

### `format.json`

Contains version and compatibility information for the KMD format.

```json
{
  "kmd_version": "1.0.0",
  "min_reader_version": "1.0.0",
  "created_by": {
    "app": "korppi",
    "version": "0.1.0"
  },
  "compression": "deflate"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `kmd_version` | string | Yes | Semantic version of the KMD format used |
| `min_reader_version` | string | Yes | Minimum KMD reader version required to open this file |
| `created_by.app` | string | Yes | Name of the application that created the file |
| `created_by.version` | string | Yes | Version of the creating application |
| `compression` | string | Yes | Compression algorithm used within ZIP ("deflate" or "store") |

### `state.yjs`

Binary file containing the complete Yjs CRDT document state. This is the **single source of truth** for document content.

- **Format**: Binary Yjs update encoding (via `Y.encodeStateAsUpdate()`)
- **Content**: Full document state including all merged changes
- **Reconstruction**: Markdown text can be extracted using the Yjs API

The state includes:
- Document structure (paragraphs, headings, lists, etc.)
- Current content of all elements
- Deleted tombstones for CRDT consistency
- State vector for merge detection

### `history.sqlite`

SQLite3 database storing the semantic patch history for time travel and audit purposes.

#### Schema

```sql
-- Patch records grouped by semantic operations
CREATE TABLE patches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,           -- Unix timestamp in milliseconds
    author_id TEXT NOT NULL,              -- UUID of the author
    kind TEXT NOT NULL,                   -- Patch type (e.g., 'semantic_group')
    data TEXT NOT NULL                    -- JSON-encoded patch data
);

-- Periodic snapshots for efficient time travel
CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,           -- Unix timestamp in milliseconds
    patch_id INTEGER NOT NULL,            -- Last patch ID included in this snapshot
    state BLOB NOT NULL,                  -- Yjs state at this point
    FOREIGN KEY (patch_id) REFERENCES patches(id)
);

-- Indexes for common queries
CREATE INDEX idx_patches_timestamp ON patches(timestamp);
CREATE INDEX idx_patches_author ON patches(author_id);
CREATE INDEX idx_snapshots_timestamp ON snapshots(timestamp);
CREATE INDEX idx_snapshots_patch_id ON snapshots(patch_id);
```

#### Patch Kinds

| Kind | Description |
|------|-------------|
| `semantic_group` | Grouped character insertions/deletions within a time window |
| `format_change` | Formatting changes (bold, italic, etc.) |
| `structure_change` | Structural changes (heading level, list type) |
| `paste` | Content pasted from clipboard |
| `import` | Content imported from external source |

#### Patch Data Format

```json
{
  "patches": [
    {
      "type": "insert",
      "position": 42,
      "content": "Hello "
    },
    {
      "type": "delete",
      "position": 48,
      "length": 3
    }
  ]
}
```

### `meta.json`

Document metadata including identification, timestamps, and collaboration settings.

```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "title": "My Document",
  "created_at": "2024-01-15T10:30:00Z",
  "modified_at": "2024-01-20T14:22:33Z",
  "authors": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "name": "Alice",
      "role": "owner"
    },
    {
      "id": "b2c3d4e5-f6a7-8901-bcde-f12345678901",
      "name": "Bob",
      "role": "contributor"
    }
  ],
  "settings": {
    "default_font_size": 14,
    "theme": "light",
    "spellcheck_language": "en-US"
  },
  "sync_state": {
    "last_sync": "2024-01-20T14:00:00Z",
    "collaborators": {
      "b2c3d4e5-f6a7-8901-bcde-f12345678901": {
        "last_received": "2024-01-20T12:00:00Z",
        "state_vector": "base64-encoded-state-vector"
      }
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `uuid` | string | Yes | Unique document identifier (UUID v4) |
| `title` | string | Yes | Human-readable document title |
| `created_at` | string | Yes | ISO 8601 timestamp of creation |
| `modified_at` | string | Yes | ISO 8601 timestamp of last modification |
| `authors` | array | Yes | List of authors who have contributed |
| `authors[].id` | string | Yes | Author's UUID |
| `authors[].name` | string | Yes | Author's display name |
| `authors[].role` | string | No | Role: "owner", "contributor", or "viewer" |
| `settings` | object | No | Document-specific settings |
| `sync_state` | object | No | Collaboration synchronization state |

### `authors/{uuid}.json`

Cached author profile information, one file per author.

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "name": "Alice Smith",
  "email": "alice@example.com",
  "color": "#FF6B6B",
  "avatar_base64": "data:image/png;base64,iVBORw0KGgo...",
  "public_key": null
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Author's UUID (matches filename) |
| `name` | string | Yes | Display name |
| `email` | string | No | Email address (optional) |
| `color` | string | Yes | Hex color for author highlighting |
| `avatar_base64` | string | No | Base64-encoded avatar image |
| `public_key` | string | No | Future: public key for signature verification |

## Operations

### Opening a KMD File

1. Validate ZIP structure and extract to temporary location
2. Read `format.json` and check version compatibility
3. Read `meta.json` to get document metadata
4. Load `state.yjs` binary into Yjs document
5. Open `history.sqlite` for patch history access
6. Cache author profiles from `authors/` directory

```javascript
async function openKmd(path) {
  const zip = await JSZip.loadAsync(fs.readFile(path));
  
  // Check format version
  const format = JSON.parse(await zip.file('format.json').async('string'));
  if (!isVersionCompatible(format.min_reader_version)) {
    throw new Error('KMD version not supported');
  }
  
  // Load Yjs state
  const stateBytes = await zip.file('state.yjs').async('uint8array');
  Y.applyUpdate(ydoc, stateBytes);
  
  // Load metadata
  const meta = JSON.parse(await zip.file('meta.json').async('string'));
  
  return { ydoc, meta };
}
```

### Saving a KMD File

1. Create new ZIP archive
2. Write `format.json` with current version
3. Encode Yjs state to binary and write `state.yjs`
4. Export SQLite database to `history.sqlite`
5. Write `meta.json` with updated timestamps
6. Write author profiles to `authors/` directory
7. Compress and save ZIP file

```javascript
async function saveKmd(path, ydoc, meta, history) {
  const zip = new JSZip();
  
  // Format info
  zip.file('format.json', JSON.stringify({
    kmd_version: '1.0.0',
    min_reader_version: '1.0.0',
    created_by: { app: 'korppi', version: '0.1.0' },
    compression: 'deflate'
  }));
  
  // Yjs state
  const state = Y.encodeStateAsUpdate(ydoc);
  zip.file('state.yjs', state);
  
  // Metadata
  meta.modified_at = new Date().toISOString();
  zip.file('meta.json', JSON.stringify(meta, null, 2));
  
  // History database
  const historyBlob = await exportSqliteToBlob(history);
  zip.file('history.sqlite', historyBlob);
  
  // Authors
  const authorsFolder = zip.folder('authors');
  for (const author of meta.authors) {
    authorsFolder.file(`${author.id}.json`, JSON.stringify(author));
  }
  
  // Write ZIP
  const content = await zip.generateAsync({ type: 'blob' });
  await fs.writeFile(path, content);
}
```

### Exporting Plain Markdown

Extract Markdown text from the Yjs state for export or compatibility.

```javascript
function exportMarkdown(ydoc) {
  const xmlFragment = ydoc.getXmlFragment('prosemirror');
  // Convert ProseMirror XML to Markdown using serializer
  return prosemirrorToMarkdown(xmlFragment);
}
```

### Merging Two KMD Files

Merge changes from another KMD file using Yjs CRDT semantics.

```javascript
async function mergeKmd(localPath, remotePath) {
  const local = await openKmd(localPath);
  const remote = await openKmd(remotePath);
  
  // Merge Yjs states (CRDT handles conflicts automatically)
  const remoteState = Y.encodeStateAsUpdate(remote.ydoc);
  Y.applyUpdate(local.ydoc, remoteState);
  
  // Merge author lists
  const mergedAuthors = new Map();
  [...local.meta.authors, ...remote.meta.authors].forEach(a => {
    mergedAuthors.set(a.id, a);
  });
  local.meta.authors = Array.from(mergedAuthors.values());
  
  // Concatenate patch histories
  await mergePatchHistories(local.history, remote.history);
  
  // Save merged document
  await saveKmd(localPath, local.ydoc, local.meta, local.history);
}
```

## MIME Type and Extension

- **MIME Type**: `application/vnd.korppi.document+zip`
- **File Extension**: `.kmd`

### File Association

Applications should register the `.kmd` extension and MIME type with the operating system to enable:
- Double-click to open
- Drag-and-drop support
- Proper icons in file managers

## Compatibility

### Forward Compatibility

- Readers MUST check `min_reader_version` in `format.json`
- Readers SHOULD ignore unknown fields in JSON files
- Readers MUST NOT modify fields they don't understand

### Backward Compatibility

- Writers MUST set `min_reader_version` to the lowest version that can read the file
- Writers SHOULD avoid using features that require newer reader versions when possible
- Major version changes indicate breaking changes

### Version Migration

When opening a file with an older format version:
1. Read and parse using older format rules
2. Migrate internal structures to current version
3. Save with current format version (if modified)

## Security Considerations

### No Executable Content

KMD files MUST NOT contain:
- Executable scripts
- Macros
- Active content of any kind

Readers MUST NOT execute any code from KMD files.

### Path Traversal Protection

When extracting files from the ZIP archive:
- Validate all paths are relative
- Reject paths containing `..` components
- Reject absolute paths
- Sanitize filenames to prevent injection attacks

```javascript
const nodePath = require('path');

function isPathSafe(filePath) {
  const normalized = nodePath.normalize(filePath);
  return !normalized.startsWith('..') && 
         !nodePath.isAbsolute(normalized) &&
         !normalized.includes('../');
}
```

### SQLite Security

When opening `history.sqlite` from untrusted sources:
- Open in read-only mode
- Set query timeout limits
- Validate schema before querying
- Use parameterized queries

```javascript
const db = new Database(historyPath, { readonly: true });
db.pragma('query_only = ON');
```

### Signature Verification (Future)

Future versions will support:
- Author signatures on patches
- Document integrity verification
- Public key distribution via `authors/{uuid}.json`

## Future Extensions

### Assets Directory

The `assets/` directory is reserved for embedded files:
- Images referenced in the document
- Attachments
- Linked files

Each asset will have a unique identifier and metadata file.

### Comments and Annotations

Future support for:
- Inline comments on selections
- Margin annotations
- Resolved/unresolved comment tracking
- Threaded discussions

### Branches

Optional branching support for:
- Divergent editing paths
- Review workflows
- Experimental changes

### Digital Signatures

Cryptographic features for:
- Author verification
- Change attribution
- Tamper detection
- Non-repudiation

## Appendix A: Example Files

### Minimal `format.json`

```json
{
  "kmd_version": "1.0.0",
  "min_reader_version": "1.0.0",
  "created_by": {
    "app": "korppi",
    "version": "0.1.0"
  },
  "compression": "deflate"
}
```

### Minimal `meta.json`

```json
{
  "uuid": "550e8400-e29b-41d4-a716-446655440000",
  "title": "Untitled Document",
  "created_at": "2024-01-15T10:30:00Z",
  "modified_at": "2024-01-15T10:30:00Z",
  "authors": [
    {
      "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
      "name": "Local User",
      "role": "owner"
    }
  ]
}
```

## Appendix B: Changelog

### Version 1.0.0 (Draft)

- Initial specification
- Core file structure defined
- Basic operations documented
