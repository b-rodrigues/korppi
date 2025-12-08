# Reconciliation

Import and merge changes from other versions of your document.

---

## What is Reconciliation?

**Reconciliation** lets you:

- Import changes and comments from another `.kmd` file
- See what's different between versions
- Selectively accept or reject changes

It's perfect for:

- Merging feedback from reviewers
- Combining work from multiple authors
- Recovering changes from an old version

---

## Starting Reconciliation

1. Open your main document
2. Click **Reconcile** in the left sidebar
3. Select the other `.kmd` file to import from
4. Korppi analyzes differences

---

## The Reconciliation Process

### Step 1: Analysis

Korppi compares:

- Your current document (target)
- The imported document (source)

It finds all differences and creates patches.

### Step 2: Review

New patches appear in the timeline as **pending**.

### Step 3: Decision

For each patch, you can:

- **Approve** - Apply the change
- **Reject** - Discard the change
- **Skip** - Decide later

---

## Types of Changes

### Additions

New content added in the source document.

- Shown as green in diff view
- Approving adds the content to your document

### Deletions

Content that was removed in the source.

- Shown as red in diff view
- Approving removes it from your document

### Modifications

Content that was changed.

- Shows both old and new versions
- Approving replaces old with new

---

## The Diff Preview

When reviewing a patch:

1. Click the patch in the timeline
2. View the **Details** panel
3. See exactly what changed

```diff
- The old text was here
+ The new text replaces it
```

---

## Conflict Resolution

When the same line changed in both documents:

1. Korppi detects the conflict
2. All versions are shown
3. You choose which to keep (or edit manually)

---

## Line-Based Review

Filter patches by the lines they affect:

1. In the timeline, click the line filter
2. Enter a range (e.g., 1-50)
3. Only patches affecting those lines appear

Great for reviewing changes to specific sections!

---

## Best Practices

### Before Reconciling

- Save your current document
- Make a backup if the changes are significant

### During Review

- Preview each patch before deciding
- Consider the context of changes
- Take your time with complex edits

### After Reconciling

- Review your document holistically
- Save when satisfied

---

## Common Workflows

### Reviewer Feedback

1. Send `.kmd` to reviewer
2. They make edits and return it
3. Reconcile to import their changes
4. Accept/reject each suggestion

### Multiple Authors

1. Each author works on their copy
2. One author imports the other's changes
3. Resolve any conflicts
4. Share the merged version

### Version Recovery

1. Open your current document
2. Reconcile from an old backup
3. Cherry-pick the content you need

---

## Related

- [Timeline & History](timeline.html) - Understanding patches
- [File Format](file-format.html) - About .kmd files
