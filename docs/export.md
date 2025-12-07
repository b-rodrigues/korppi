# Export Options

Share your documents in different formats.

---

## Available Formats

| Format | Extension | Use Case |
|--------|-----------|----------|
| Markdown | `.md` | Technical docs, GitHub, static sites |
| Word | `.docx` | Business docs, printing, sharing |
| Korppi | `.kmd` | Native format with full history |

---

## Export to Markdown

1. Click **Export MD** in the sidebar
2. Choose a location
3. Enter a filename
4. Click Save

### What's Exported

- Full markdown content
- Formatting preserved
- Code blocks with language hints

### What's NOT Exported

- Comments (stripped)
- Timeline history
- Document metadata

---

## Export to Word (DOCX)

1. Click **Export DOCX** in the sidebar
2. Choose a location
3. Enter a filename
4. Click Save

### Formatting Support

✅ Supported:
- Headings (H1-H6)
- Bold, italic, strikethrough
- Lists (bullet and numbered)
- Blockquotes
- Tables
- Code blocks
- Horizontal rules
- Links

⚠️ Partial/Coming:
- Images (embedded)
- Comments (as Word comments)

### Use Cases

- Sharing with non-technical colleagues
- Printing documents
- Submitting to publishers
- Business reports

---

## Export Warnings

Before exporting, Korppi may warn you about:

### Pending Patches

```
You have 3 pending patches.
Export anyway?
```

Pending patches mean unreviewed changes from reconciliation.

### Unresolved Comments

```
You have 5 unresolved comments.
Export anyway?
```

Comments won't appear in exported files.

---

## Tips for Clean Exports

### Before Exporting

1. Review and resolve pending patches
2. Address or resolve comments
3. Preview your document
4. Check formatting looks correct

### Markdown Best Practices

- Use consistent heading hierarchy
- Add blank lines between sections
- Preview in a markdown viewer

### Word Best Practices

- Test complex tables
- Check code block formatting
- Verify images appear correctly

---

## The .kmd Format

When you save normally (Ctrl+S), Korppi uses its native `.kmd` format:

### What's Included

- Complete markdown content
- Full timeline history
- All comments and threads
- Author metadata
- Yjs document state

### File Structure

A `.kmd` file is actually a ZIP archive:

```
document.kmd/
├── content.md      # Your markdown
├── patches.json    # Timeline data
├── comments.json   # Comments
├── meta.json       # Document metadata
└── ystate.bin      # Yjs sync state
```

### Benefits

- Version history travels with the file
- Comments survive transfer
- No external database needed

---

## Related

- [File Format](file-format.html) - Deep dive into .kmd
- [Timeline](timeline.html) - Understanding history
