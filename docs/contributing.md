# Contributing to Korppi

Thank you for your interest in contributing!

---

## Ways to Contribute

### Report Bugs

Found a bug? [Open an issue](https://github.com/b-rodrigues/korppi/issues) with:

- Clear description of the problem
- Steps to reproduce
- Expected vs actual behavior
- System information

### Suggest Features

Have an idea? Open a feature request issue!

- Describe the use case
- Explain why it would be valuable
- Include mockups if relevant

### Improve Documentation

Documentation lives in `docs/`:

- Fix typos
- Clarify confusing sections
- Add missing information
- Translate to other languages

### Write Code

Ready to code? Start with issues labeled `good first issue`.

---

## Development Setup

### Prerequisites

- **Node.js 18+** and npm
- **Rust 1.70+** (install via [rustup](https://rustup.rs))
- System dependencies (see [Installation](installation.html))

### Clone & Install

```bash
# Clone the repository
git clone https://github.com/b-rodrigues/korppi.git
cd korppi

# Install npm dependencies
npm install
```

### Run in Development

```bash
# Start development server with hot reload
npm run tauri dev
```

### Build for Production

```bash
# Create production build
npm run tauri build
```

---

## Project Structure

```
korppi/
├── src/                 # Frontend code (JS/CSS/HTML)
│   ├── components/      # UI components
│   ├── styles/          # CSS files
│   ├── editor.js        # Milkdown editor setup
│   ├── main.js          # Application entry point
│   └── ...
├── src-tauri/           # Rust backend
│   ├── src/             # Rust source
│   └── tauri.conf.json  # Tauri configuration
├── docs/                # Documentation (you are here!)
└── package.json         # Node.js dependencies
```

---

## Code Style

### JavaScript

- Use ES modules (`import`/`export`)
- 4-space indentation
- Meaningful variable names
- JSDoc comments for public functions

### Rust

- Follow standard Rust conventions
- Run `cargo fmt` before committing
- Run `cargo clippy` to check for issues

### CSS

- Use CSS custom properties (variables)
- Follow existing naming conventions
- Document complex selectors

---

## Pull Request Process

1. **Fork** the repository
2. **Create a branch** for your feature
   ```bash
   git checkout -b feature/my-feature
   ```
3. **Make changes** and test thoroughly
4. **Commit** with clear messages
   ```bash
   git commit -m "Add: brief description of change"
   ```
5. **Push** to your fork
   ```bash
   git push origin feature/my-feature
   ```
6. **Open a Pull Request** against `main`

### PR Guidelines

- Keep changes focused (one feature per PR)
- Update documentation if needed
- Add tests for new features
- Respond to review feedback

---

## Testing

### Manual Testing

Test these areas before submitting:

- [ ] Document creation/opening/saving
- [ ] Text formatting
- [ ] Timeline functionality
- [ ] Comments system
- [ ] Export to MD/DOCX
- [ ] Find & Replace
- [ ] Keyboard shortcuts

### Running Tests

```bash
# JavaScript tests (if any)
npm test

# Rust tests
cd src-tauri && cargo test
```

---

## Documentation

### Building Docs Locally

```bash
cd docs
chmod +x build.sh
./build.sh

# View locally
open _site/index.html
```

### Documentation Style

- Use simple language
- Include code examples
- Add screenshots for UI features
- Keep pages focused

---

## Release Process

Releases are managed by maintainers:

1. Version bump in `package.json` and `tauri.conf.json`
2. Update CHANGELOG
3. Tag release in Git
4. GitHub Actions builds binaries
5. Publish GitHub Release

---

## Community Guidelines

- Be respectful and welcoming
- Assume good intentions
- Focus on constructive feedback
- Help others learn

---

## Contact

- **GitHub Issues:** Bug reports and feature requests
- **GitHub Discussions:** General questions
- **Pull Requests:** Code contributions

---

Thank you for helping make Korppi better! 🐦
