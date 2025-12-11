# Text Formatting

Korppi supports full Markdown formatting with a visual toolbar.

---

## Inline Formatting

### Bold

- **Toolbar:** Click **B**
- **Shortcut:** `Ctrl+B`
- **Markdown:** `**bold text**`

### Italic

- **Toolbar:** Click *I*
- **Shortcut:** `Ctrl+I`
- **Markdown:** `*italic text*`

### Strikethrough

- **Toolbar:** Click ~~S~~
- **Markdown:** `~~strikethrough~~`

### Underline

- **Toolbar:** Click **U**
- **Shortcut:** `Ctrl+U`
- **Markdown:** `<u>underlined text</u>` (HTML tag)

### Inline Code

- **Toolbar:** Click `` ` ``
- **Markdown:** `` `code` ``

---

## Headings

Use headings to structure your document:

```markdown
# Heading 1 (largest)
## Heading 2
### Heading 3
```

Use the toolbar buttons **H1**, **H2**, **H3**, or type the `#` symbols directly.

---

## Links

### Adding a Link

1. Select text
2. Right-click → **Add Link**
3. Enter the URL
4. Click OK

Or use Markdown: `[link text](https://example.com)`

---

## Lists

### Bullet Lists

```markdown
- First item
- Second item
- Third item
```

Click the **•** button in the toolbar.

### Numbered Lists

```markdown
1. First item
2. Second item
3. Third item
```

Click the **1.** button in the toolbar.

---

## Blockquotes

Use blockquotes for citations or callouts:

```markdown
> This is a quote.
> It can span multiple lines.
```

Click the **"** button in the toolbar.

---

## Code Blocks

For multi-line code, use fenced code blocks:

````markdown
```javascript
function hello() {
    console.log("Hello, world!");
}
```
````

Specify the language after the opening fence for syntax highlighting.

---

## Tables

Create tables using the toolbar or markdown:

```markdown
| Column 1 | Column 2 | Column 3 |
|----------|----------|----------|
| Cell 1   | Cell 2   | Cell 3   |
| Cell 4   | Cell 5   | Cell 6   |
```

**Insert via Context Menu:**
1. Right-click in the editor (no selection)
2. Click **Insert Table**
3. Choose rows and columns

---

## Horizontal Rules

Insert a divider line:

- **Toolbar:** Click **—**
- **Markdown:** `---` on its own line

---

## Images

To insert an image:

1. Right-click → **Insert Image**
2. Select an image file
3. The image is embedded in your document

---

## Hard Break

To insert a line break without starting a new paragraph:

- **Toolbar:** Click **↵**
- **Markdown:** Two spaces at the end of the line, or a backslash `\`

---

## Clearing Formatting

To remove all formatting from selected text:

1. Select the text
2. Click the **⌀** button in the toolbar

---

## Context Menu

**Right-click on selected text** for quick formatting:

- Bold, Italic, Strikethrough
- Inline Code
- Add Link
- Copy
- Search in Document
- Add Comment

**Right-click without selection** for:

- Paste
- Paste as Plain Text
- Horizontal Rule
- Insert Table
- Insert Image
- Code Block
- Select All

---

## Keyboard Shortcuts Summary

| Formatting | Shortcut |
|------------|----------|
| Bold | `Ctrl+B` |
| Italic | `Ctrl+I` |
| Underline | `Ctrl+U` |
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Y` |
| New Document | `Ctrl+N` |
| Open Document | `Ctrl+O` |
| Save Document | `Ctrl+S` |
| Close Document | `Ctrl+W` |
| Next Tab | `Ctrl+Tab` |
| Previous Tab | `Shift+Ctrl+Tab` |

See [Keyboard Shortcuts](keyboard-shortcuts.html) for the complete list.
