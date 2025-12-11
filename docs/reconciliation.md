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

When the same lines are modified in both documents, Korppi detects a **conflict**. You have two approaches to resolve them:

### Simple Approach: Accept or Reject

For straightforward conflicts:

1. Click the conflicting patch in the timeline
2. Review the diff preview
3. Click **Accept** or **Reject**

If you accept, the patch's content replaces what's in your document.

### Advanced Approach: Merge Wizard

For complex conflicts or when you want to combine changes from multiple patches:

1. Click the conflicting patch in the timeline
2. Go to the **Conflicts** tab in the preview
3. Click **Resolve Conflict** to open the Merge Wizard

The wizard guides you through:

1. **Zone Detection** - Korppi breaks down conflicts into independent zones (sections of the document that can be resolved separately)
2. **Zone Resolution** - For each zone, you see both versions and can:
   - Choose one version entirely
   - Manually edit to combine both
   - Use the conflict markers to pick line-by-line

### Understanding Conflict Markers

In the zone editor, conflicts appear as:

```
╔══════ Author A
Content from first patch
╠══════
Content from second patch
╚══════ Author B
```

You can:
- Delete everything except the version you want
- Edit the content to merge both manually
- Use the quick-resolve buttons to pick a version

### After Resolution

When you complete the merge:

- A new **Merge Patch** is created with your resolved content
- Source patches are marked as **accepted** (and move to the accepted filter)
- Your document is updated with the merged result

### When to Use the Merge Wizard

| Scenario | Recommended Approach |
|----------|---------------------|
| Simple text change | Accept/Reject |
| Multiple authors edited same section | Merge Wizard |
| Want to combine parts from both versions | Merge Wizard |
| Many overlapping patches | Merge Wizard |

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
