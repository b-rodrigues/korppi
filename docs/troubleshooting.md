# Troubleshooting

Solutions to common problems.

---

## Installation Issues

### Linux: AppImage Won't Run

**Problem:** Double-clicking the AppImage does nothing.

**Solution:**
```bash
# Make it executable
chmod +x korppi_*.AppImage

# Run from terminal to see errors
./korppi_*.AppImage
```

### macOS: "App is damaged"

**Problem:** macOS says the app is damaged and can't be opened. 
This is because Apple extorts open source software developers by
making them pay 99$ per year to distribute their software,
otherwise that message pops up. It is however trivial and completely
safe to ignore it.

**Solution:**
```bash
# Remove quarantine attribute
xattr -cr /Applications/Korppi.app

# Or right-click → Open (bypasses Gatekeeper)
```

### Windows: SmartScreen Warning

**Problem:** Windows Defender SmartScreen blocks the installer.

**Solution:**
1. Click "More info"
2. Click "Run anyway"
3. This is normal for new/unsigned apps

---

## Startup Issues

### Blank Window

**Problem:** Korppi opens but shows a blank white screen.

**Solutions:**
1. Wait a few seconds (initial load can be slow)
2. Try `Ctrl+Shift+R` to force reload
3. Check if running from a network drive (try local)
4. Disable hardware acceleration in system settings

### Crashes on Launch

**Problem:** Korppi crashes immediately.

**Solutions:**
1. Check system requirements
2. Update graphics drivers
3. Try launching from terminal for error messages:
   ```bash
   # Linux
   ./korppi_*.AppImage

   # macOS
   /Applications/Korppi.app/Contents/MacOS/Korppi
   ```
4. Check for conflicting antivirus software

Launch Korppi from the terminal to see error messages:

```bash
# Open a specific file
korppi /path/to/document.kmd
```

See the error messages for more information.

---

## Document Issues

### Can't Open Document

**Problem:** Error when opening a `.kmd` file.

**Solutions:**
1. Check file permissions
2. Verify the file isn't corrupted:
   ```bash
   unzip -t document.kmd
   ```
3. Try extracting content manually:
   ```bash
   unzip -p document.kmd content.md > recovered.md
   ```

### Document Won't Save

**Problem:** Saving fails with an error.

**Solutions:**
1. Check disk space
2. Verify write permissions for the folder
3. Try "Save As" to a different location
4. Check if another program has the file locked

### Lost Changes

**Problem:** Recent edits are missing.

**Solutions:**
1. Check tab indicator—red dot means unsaved
2. Look for autosave backup (if enabled)
3. Check the timeline for recent patches
4. Look in system temp directory for recovery files

---

## Editor Issues

### Can't Type in Editor

**Problem:** Clicking in editor does nothing.

**Solutions:**
1. Click directly on the white page area
2. Check if a modal dialog is covering the editor
3. Try `Ctrl+Shift+R` to reload
4. Check if browser zoom is extreme (reset to 100%)

### Formatting Not Working

**Problem:** Bold/italic shortcuts do nothing.

**Solutions:**
1. Make sure text is selected
2. Try the toolbar buttons instead
3. Check for conflicting browser extensions
4. Reload with `Ctrl+Shift+R`

### Slow Performance

**Problem:** Editor lags when typing.

**Solutions:**
1. Large documents (50K+ words) can be slow
2. Try splitting into multiple documents
3. Close other resource-heavy applications
4. Check if timeline has many patches

---

## Export Issues

### DOCX Export Fails

**Problem:** Word export produces an error or empty file.

**Solutions:**
1. Check available disk space
2. Make sure document isn't empty
3. Try exporting a simple test document first
4. Report the issue with error details

### Markdown Export Loses Formatting

**Problem:** Exported `.md` file looks wrong.

**Solutions:**
1. This is expected—some Korppi features don't translate
2. Comments are stripped (expected behavior)
3. Check if the issue is in the viewer, not the file
4. Open the `.md` in a text editor to verify content

---

## Timeline Issues

### No Patches Appear

**Problem:** Timeline is empty despite editing.

**Solutions:**
1. Patches appear after saving
2. Try making a larger edit
3. Check if you're viewing a new document
4. Reload the document

### Can't Restore Version

**Problem:** Restore button doesn't work.

**Solutions:**
1. Make sure a patch is selected
2. Check for error messages
3. Try preview first
4. Save current doc, reload, try again

---

## Comments Issues

### Comments Don't Appear

**Problem:** Added comment but can't see it.

**Solutions:**
1. Check the Comments panel (right sidebar)
2. Click the comments counter in the bottom left to bring up the right sidebar.
3. Look for highlight on the text
4. Check comment filter (show "All")
5. Reload document

---

## Getting More Help

### Collect Debug Info

When reporting issues, include:

1. **Korppi version:** (About menu or package.json)
2. **Operating system:** (Linux distro/version, macOS version, Windows version)
3. **Error messages:** (from terminal if available)
4. **Steps to reproduce:** (what exactly you did)

### Report an Issue

1. Go to [GitHub Issues](https://github.com/b-rodrigues/korppi/issues)
2. Check if issue already exists
3. Create new issue with template
4. Include debug info above

### Developer Console

For JavaScript errors:

```
Ctrl+Right-Click anywhere → Inspect Element
```

This opens the browser dev tools where you can see console errors.

---

## Related

- [FAQ](faq.html) - General questions
- [Installation](installation.html) - Setup instructions
