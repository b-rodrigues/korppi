# Frequently Asked Questions

Common questions about Korppi.

---

## General

### What is Korppi?

Korppi is a markdown editor with built-in version history and reconciliation features. It's designed for writers who need to track changes, collaborate, and maintain document history.

### Why "Korppi"?

Korppi means "raven" in Finnish. Ravens are known for their intelligence and memory—fitting for an editor that remembers everything!

### Is Korppi free?

Yes! Korppi is free and open source software, released under the MIT license.

### What platforms does Korppi support?

- **Linux** (AppImage, Debian package)
- **macOS** (DMG)
- **Windows** (MSI installer)

---

## Documents

### What's a .kmd file?

A `.kmd` (Korppi Markdown Document) file is Korppi's native format. It's a ZIP archive containing your markdown content, version history, comments, and metadata. See [File Format](file-format.html) for details.

### Can I open regular .md files?

Currently, Korppi uses its own `.kmd` format. You can:
- Create a new document and paste markdown content
- Export to `.md` at any time

Direct `.md` import is planned for a future release.

### How do I share documents with non-Korppi users?

Export your document:
- **Export MD** for markdown files
- **Export DOCX** for Word documents

### I accidentally closed without saving. Can I recover my work?

If you had **Autosave** enabled, check the recent documents list—your last autosave should be there.

If not, check for temporary files in your system's temp directory.

---

## Features

### How is this different from Git?

Git is designed for code with line-based tracking. Korppi is designed for prose:

- **Semantic patches** - Understands document structure
- **Visual timeline** - No command line needed
- **Comments** - Built-in review system
- **Rich formatting** - Full markdown support

### Can multiple people edit at once?

Real-time collaboration is planned but not yet implemented. Currently, use the **Reconciliation** feature to merge changes from different authors.

### Do comments appear in exported files?

- **Markdown export:** Comments are stripped (pure content only)
- **DOCX export:** Comments as Word comments (coming soon)

### Can I customize keyboard shortcuts?

Not yet, but it's on the roadmap!

---

## Timeline & History

### How far back does the history go?

Korppi saves your complete edit history within each `.kmd` file. There's no limit—all patches are preserved.

### Can I delete history?

Currently, no. History is considered valuable data. A future release may add the option to compact history.

### What's a "pending" patch?

Pending patches are changes imported via reconciliation that haven't been reviewed yet. You can approve or reject them.

### I restored an old version. Can I undo that?

Use `Ctrl+Z` (Undo) immediately after restore, or reconcile with a backup of your newer version.

---

## Troubleshooting

### Korppi won't start

See [Troubleshooting](troubleshooting.html) for platform-specific solutions.

### My document looks corrupted

Try:
1. Check if the `.kmd` file opens (it's a ZIP file)
2. Extract `content.md` manually
3. Open in a new Korppi document

### Export isn't working

Check for:
- Disk space
- Write permissions in the target folder
- Special characters in filename

### The editor is slow

For very large documents (50,000+ words):
- Split into multiple documents
- Reduce timeline history (coming soon)
- Check available RAM

---

## Development

### How do I report bugs?

Open an issue on [GitHub](https://github.com/b-rodrigues/korppi/issues).

### Can I contribute?

Yes! See [Contributing](contributing.html) for guidelines.

### What's Korppi built with?

- **Frontend:** JavaScript, HTML, CSS
- **Editor:** Milkdown (ProseMirror)
- **Backend:** Rust (Tauri)
- **Sync:** Yjs (CRDT)

---

## Still Have Questions?

- Check [Troubleshooting](troubleshooting.html)
- Open a [GitHub Issue](https://github.com/b-rodrigues/korppi/issues)
- Read the source code!
