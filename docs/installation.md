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
- Node.js 18+ and npm
- Rust 1.70+
- System dependencies (see below)

```bash
# Clone the repository
git clone https://github.com/b-rodrigues/korppi.git
cd korppi

# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Or build for production
npm run tauri build
```

#### Linux Dependencies

On Ubuntu/Debian:
```bash
sudo apt install libwebkit2gtk-4.1-dev \
    build-essential \
    curl \
    wget \
    file \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev
```

On Fedora:
```bash
sudo dnf install webkit2gtk4.1-devel \
    openssl-devel \
    curl \
    wget \
    file \
    librsvg2-devel
```

---

## Installing on macOS

1. Download the `.dmg` file from the releases page
2. Open the DMG file
3. Drag Korppi to your Applications folder
4. Right-click and select "Open" (first time only, to bypass Gatekeeper)

---

## Installing on Windows

1. Download the `.msi` installer from the releases page
2. Run the installer
3. Follow the installation wizard
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
