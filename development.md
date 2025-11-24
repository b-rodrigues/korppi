# Korppi Development Guide

This guide will get you set up for developing Korppi using Nix for reproducible builds.

## Prerequisites

### Required
- **Nix** with flakes enabled
- **Git**

### Recommended (but optional with Nix)
- **direnv** - Automatically loads the development environment when you `cd` into the project

## Quick Start

### 1. Install Nix (if not already installed)

```bash
# Install Nix (multi-user installation)
curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install

# Enable flakes (if using older Nix)
mkdir -p ~/.config/nix
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf
```

### 2. Clone the Repository

```bash
git clone <your-repo-url>
cd korppi-prototype
```

### 3. Enter Development Environment

#### Option A: With direnv (recommended)

```bash
# Install direnv (if not already installed)
# macOS: brew install direnv
# Linux: nix profile install nixpkgs#direnv

# Hook direnv into your shell
# Add to ~/.bashrc or ~/.zshrc:
eval "$(direnv hook bash)"  # or zsh, fish, etc.

# Allow direnv for this project
direnv allow

# The environment will load automatically!
```

#### Option B: Manual (without direnv)

```bash
# Enter the development shell
nix develop

# You'll see the welcome message with available commands
```

### 4. Initial Setup

```bash
# Install Node.js dependencies
npm install

# Verify everything works
just check
```

### 5. Start Development

```bash
# Start the development server
just dev

# Or use the helper script
korppi-dev
```

## Available Commands

The flake provides several convenience commands:

### Via `just` (recommended)

```bash
just setup          # First-time setup
just dev            # Start development server
just build          # Build for production
just test           # Run all tests
just check          # Run format/lint/test
just clean          # Clean build artifacts
just validate       # Run 3-day validation suite

# Day-by-day validation
just day1           # Test Pijul initialization
just day2           # Test change recording
just day3           # Test conflict detection
```

### Via helper scripts

```bash
korppi-dev          # Start development
korppi-build        # Build for production
korppi-test         # Run tests
korppi-check        # Code quality checks
korppi-validate     # Run validation suite
korppi-clean        # Clean artifacts
korppi-update       # Update dependencies
```

### Via npm/cargo directly

```bash
# Tauri commands
npm run tauri dev
npm run tauri build

# Rust commands
cd src-tauri
cargo test
cargo run
cargo clippy
```

## Project Structure

```
korppi-prototype/
├── flake.nix              # Nix flake for dev environment
├── flake.lock             # Locked dependency versions
├── .envrc                 # direnv configuration
├── justfile               # Command runner recipes
├── package.json           # Node.js dependencies
├── src/                   # Frontend (HTML/CSS/JS)
│   ├── index.html
│   ├── main.js
│   └── styles.css
└── src-tauri/             # Rust backend
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    └── src/
        ├── main.rs
        ├── commands.rs
        ├── pijul_ops.rs
        └── models.rs
```

## Development Workflow

### Day 1: Initialization Test

Goal: Verify Pijul can create a repository in Tauri.

```bash
just day1
# or
cd src-tauri && cargo run
```

**Success criteria:** App launches, creates `.pijul` directory without errors.

### Day 2: Change Recording

Goal: Record and retrieve document changes.

```bash
just day2
# or
just dev  # Then use the UI buttons
```

**Success criteria:** Multiple edits show as separate patches in history.

### Day 3: Conflict Detection

Goal: Detect and represent merge conflicts.

```bash
just day3
```

**Success criteria:** Conflicting edits are detected and returned in parseable format.

## Code Quality

### Before Committing

```bash
# Run all checks
just check

# This runs:
# - cargo fmt --check
# - cargo clippy
# - cargo test
# - prettier (for JS/CSS)
```

### Auto-formatting

```bash
# Format all code
just fmt
```

### Install Pre-commit Hook

```bash
just install-hooks
```

This will run `just check` before every commit.

## Troubleshooting

### "Pijul compilation errors"

The Pijul API is complex and underdocumented. If you hit compilation errors:

1. Check `libpijul` version matches in `Cargo.toml`
2. Look at Pijul CLI source code for examples
3. Consider simplifying to just test initialization first

### "Tauri won't start on Linux"

Make sure you have the required system libraries:

```bash
# The flake should handle this, but if needed:
nix develop
```

All dependencies are included in the Nix environment.

### "Node modules not found"

```bash
npm install
```

The Nix shell provides Node.js, but doesn't auto-install npm packages.

### "direnv not loading"

```bash
# Allow the directory
direnv allow

# Check direnv is hooked in your shell
echo $DIRENV_DIR  # Should show a path
```

## Platform-Specific Notes

### macOS

- Apple Silicon (M1/M2): Fully supported
- Intel Macs: Fully supported
- All required frameworks are included in the Nix environment

### Linux

- Ubuntu/Debian: Tested and working
- NixOS: Native support
- Other distros: Should work via Nix

### Windows

- WSL2: Use the Linux setup
- Native Windows: Not tested (Tauri supports it, but Nix doesn't run natively on Windows)

## Updating Dependencies

### Update Rust dependencies

```bash
just update
# or
cd src-tauri && cargo update
```

### Update Node dependencies

```bash
npm update
```

### Update Nix flake inputs

```bash
nix flake update
```

## Resources

- **Tauri Docs**: https://tauri.app/v1/guides/
- **Pijul Manual**: https://pijul.org/manual/introduction.html
- **libpijul API**: https://docs.rs/libpijul/latest/libpijul/
- **Nix Flakes**: https://nixos.wiki/wiki/Flakes

## Getting Help

1. Check the [implementation plan](./implementation.md)
2. Review the [code review notes](./REVIEW.md) for known issues
3. Look at Pijul's source code: https://nest.pijul.com/pijul/pijul
4. Ask in discussions/issues

## Next Steps

1. ✅ Get Day 1 (init) working
2. ⏳ Implement Day 2 (recording)
3. ⏳ Implement Day 3 (conflicts)
4. 🎯 Decide: Proceed with Pijul or pivot to alternative

Good luck! 🦀✨
