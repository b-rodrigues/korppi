# Installation

## Download Korppi

<a href="https://github.com/b-rodrigues/korppi/releases" class="download-btn">⬇️ Download Latest Release</a>

---

## Installing on Linux

### Option 1: AppImage (Recommended)

1. Download the `.AppImage` file from the releases page
2. Make it executable:

```bash
chmod +x korppi_*.AppImage
```

3. Run it:

```bash
./korppi_*.AppImage
```

### Option 2: Building from Source

Requirements:

- Nix

```bash
# Clone the repository
git clone https://github.com/b-rodrigues/korppi.git
cd korppi

# Drop into the development shell
nix develop

# Install Node.js dependencies
npm install

# Build an appimage
npm run tauri build -- --bundles appimage

# Build a deb (untested)
npm run tauri build -- --bundles deb

# Build an rpm (untested)
# Note: On Debian/Ubuntu, you may need to install 'rpm' first: sudo apt install rpm
npm run tauri build -- --bundles rpm
```

---

## Installing on macOS

1. Download the `.dmg` file from the releases page
2. Open the DMG file
3. Drag Korppi to your Applications folder
4. Because the app is not signed or notarized, macOS will block it the first time.
   Open a terminal and run this command:
   ```
   xattr -cr /Applications/Korppi.app
   ```

---

## Installing on Windows

1. Download the `.exe` installer from the releases page 
   (unless you have an ARM device, download the `x86-setup.exe`)
2. Run the installer
3. Follow the installation wizard (admin rights are **not required**)
4. Launch Korppi from the Start menu

---

## Verifying Your Installation

After installation, launch Korppi. You should see:

- The main editor window
- Left sidebar with formatting tools
- Right sidebar with timeline panel

If you encounter any issues, check the [Troubleshooting](troubleshooting.html) page.

---

## Next Steps

Ready to start writing? Check out the [Quick Start Guide](quick-start.html)!
