# Frequently Asked Questions

Common questions about Korppi.

---

## General

### What is Korppi?

Korppi is a markdown editor with integrated version history and conflict-free
merging. It lets you write, track changes, and collaborate asynchronously, all
locally, with no dependence on third-party servers.

### Why "Korppi"?

Korppi means "raven" in Finnish. Ravens are known for their intelligence and
memory—fitting for an editor that remembers everything!

### Is Korppi free?

Yes! Korppi is free and open source software, released under the GPLv3 license.

### What platforms does Korppi support?

- **Linux** (AppImage)
- **macOS** (DMG)
- **Windows** (EXE and MSI installer)

### Did you write Korppi?

No, I designed Korppi, but Korppi was written 100% by LLMs!

---

## Documents

### What's a .kmd file?

A `.kmd` (Korppi Markdown Document) file is Korppi's native format. It's a ZIP
archive containing your markdown content, version history, comments, and
metadata. See [File Format](file-format.html) for details.

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

If you didn't have autosave on, and if you ignored the prompt telling you that
you had unsaved changes, too bad!

---

## Features

### How is this different from Git?

Git manages code. Korppi manages writing. It provides non-technical
collaborators with intuitive version history and automatic reconciliation so
parallel edits can be merged into a clean, unified document.

### Can multiple people edit at once?

No. Korppi is not a live collaborative editor. Instead, it’s designed for
asynchronous collaboration: the workflow where people exchange revised versions
of a document, add comments, and make tracked changes independently. Korppi
streamlines this process by providing built-in reconciliation, making it easy to
merge these parallel edits into a single, coherent document.

### Do comments appear in exported files?

No. Korppi keeps comments and discussion inside the editor. The goal is to use
Korppi for drafting, review, and revision. Once the content is finalized, you
can export to Word and focus on formatting and layout there.

### Can I customize keyboard shortcuts?

No. Korppi is designed for business users who generally prefer consistent,
preset shortcuts rather than custom configurations.

---

## Timeline & History

### How far back does the history go?

Korppi saves your complete edit history within each `.kmd` file. There's no
limit, all patches are preserved.

### Can I delete history?

Currently, no. History is considered valuable data. A future release may add the
option to compact history.

### What's a "pending" patch?

Pending patches are changes imported via reconciliation that haven't been
reviewed yet. You can approve or reject them.

### I restored an old version. Can I undo that?

Use `Ctrl+Z` (Undo) immediately after restore, or reconcile with a backup of
your newer version.

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
