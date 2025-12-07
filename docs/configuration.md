# Configuration

Customize Korppi to fit your workflow.

---

## Preferences Section

The **Preferences** section is at the top of the left sidebar:

- Profile settings
- Theme toggle
- Autosave configuration

---

## Profile Settings

### Setting Your Name

1. Click your **profile avatar** (top left)
2. Enter your name
3. Your name appears on:
   - Comments you create
   - Document metadata
   - Timeline patches

### Choosing a Color

1. Click your profile avatar
2. Select a color
3. This color is used for:
   - Comment highlights
   - Author identification

---

## Theme

Toggle between light and dark themes:

1. Click the **Theme** button in Preferences
2. Switch between:
   - ☀️ **Light** - Classic bright theme
   - 🌙 **Dark** - Easy on the eyes

Theme preference is saved automatically.

---

## Autosave

Never lose work with automatic saving:

### Enable Autosave

1. Find the **Autosave** checkbox in Preferences
2. Check it to enable

### Set Interval

Choose how often to autosave:

| Interval | Best For |
|----------|----------|
| 1 min | Frequent savers |
| 2 min | Active editing |
| 5 min | Standard use (default) |
| 10 min | Light editing |
| 15 min | Reading/reviewing |

### How It Works

- Autosave only triggers if there are unsaved changes
- A brief "✓ Autosaved" notification appears
- Document is saved to its current path

⚠️ **Note:** New unsaved documents must be saved manually first.

---

## Sidebar Widths

Resize sidebars to your preference:

1. **Hover** on the border between sidebar and editor
2. **Drag** left or right
3. Release to set the new width

Your sidebar widths are remembered between sessions.

---

## Recent Documents

Korppi remembers your recently opened documents:

- Shown in the welcome panel
- Click to quickly reopen
- Click **Clear** to remove history

---

## Settings Storage

Preferences are stored locally:

- **Browser storage:** Theme, sidebar widths
- **Document file:** Per-document settings

---

## Command Line Options

When launching Korppi from terminal:

```bash
# Open a specific file
korppi /path/to/document.kmd

# Open in current directory
korppi .
```

---

## Environment Variables

*Advanced configuration via environment variables is planned for future releases.*

---

## Configuration File

*A global configuration file is planned for future releases.*

Planned options:
- Default theme
- Default autosave interval
- Custom keyboard shortcuts
- Editor preferences

---

## Related

- [Quick Start](quick-start.html) - Initial setup
- [First Document](first-document.html) - Document settings
