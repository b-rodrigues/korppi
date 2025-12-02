{
  description = "Korppi - Local-first collaborative writing tool with Pijul version control";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay.url = "github:oxalica/rust-overlay";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, rust-overlay, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        overlays = [ (import rust-overlay) ];
        pkgs = import nixpkgs {
          inherit system overlays;
        };

        # Use stable Rust toolchain
        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          extensions = [
            "rust-src"
            "rust-analyzer"
            "clippy"
          ];
          targets = [
            "wasm32-unknown-unknown"  # In case we want to experiment with WASM later
          ];
        };

        # Platform-specific system libraries
        darwinDeps = with pkgs; lib.optionals stdenv.isDarwin [
          darwin.apple_sdk.frameworks.Security
          darwin.apple_sdk.frameworks.CoreServices
          darwin.apple_sdk.frameworks.CoreFoundation
          darwin.apple_sdk.frameworks.Foundation
          darwin.apple_sdk.frameworks.AppKit
          darwin.apple_sdk.frameworks.WebKit
          darwin.apple_sdk.frameworks.Cocoa
          darwin.apple_sdk.frameworks.IOKit
          darwin.apple_sdk.frameworks.QuartzCore
          darwin.apple_sdk.frameworks.Carbon
          libiconv
        ];

        linuxDeps = with pkgs; lib.optionals stdenv.isLinux [
          # Tauri dependencies
          webkitgtk_6_0
          gtk3
          cairo
          gdk-pixbuf
          glib
          dbus
          openssl
          librsvg

          # Additional UI libraries
          pango
          atk
          libsoup_3

          # Development tools
          pkg-config
        ];

        # Common dependencies across all platforms
        commonDeps = with pkgs; [
          # Rust toolchain
          rustToolchain

          # Cargo tools
          cargo-watch          # Auto-rebuild on file changes
          cargo-edit           # cargo add, cargo rm, cargo upgrade
          cargo-outdated       # Check for outdated dependencies
          cargo-audit          # Security vulnerability scanning
          cargo-flamegraph     # Performance profiling

          # Node.js ecosystem for frontend
          nodejs_20
          nodePackages.npm

          # System libraries
          openssl
          zlib

          # Build tools
          pkg-config
          cmake

          # Development utilities
          just                 # Command runner (Makefile alternative)
          watchexec            # File watcher

          # Git for version control
          git

          # Testing and debugging
          lldb                 # Debugger
        ];

        # Development scripts
        scripts = {
          dev = pkgs.writeShellScriptBin "korppi-dev" ''
            echo "🦀 Starting Korppi development server..."
            npm run tauri dev
          '';

          build = pkgs.writeShellScriptBin "korppi-build" ''
            echo "🏗️  Building Korppi for production..."
            npm run tauri build
          '';

          test = pkgs.writeShellScriptBin "korppi-test" ''
            echo "🧪 Running Rust tests..."
            cd src-tauri && cargo test --all-features
          '';

          check = pkgs.writeShellScriptBin "korppi-check" ''
            echo "🔍 Running code checks..."
            cd src-tauri
            cargo fmt --check
            cargo clippy -- -D warnings
            cargo test
          '';

          clean = pkgs.writeShellScriptBin "korppi-clean" ''
            echo "🧹 Cleaning build artifacts..."
            rm -rf target src-tauri/target node_modules
            echo "✨ Clean complete!"
          '';

          update = pkgs.writeShellScriptBin "korppi-update" ''
            echo "📦 Updating dependencies..."
            cd src-tauri && cargo update
            npm update
            echo "✅ Dependencies updated!"
          '';

          validate = pkgs.writeShellScriptBin "korppi-validate" ''
            echo "✅ Running 3-day validation suite..."
            echo ""
            echo "Day 1: Testing Pijul initialization..."
            cd src-tauri && cargo run --bin korppi-prototype -- init
            echo ""
            echo "Day 2: Testing change recording..."
            cd src-tauri && cargo run --bin korppi-prototype -- record
            echo ""
            echo "Day 3: Testing conflict detection..."
            cd src-tauri && cargo run --bin korppi-prototype -- conflict
          '';
        };

      in
      {
        devShells.default = pkgs.mkShell {
          buildInputs = commonDeps ++ darwinDeps ++ linuxDeps ++ [
            scripts.dev
            scripts.build
            scripts.test
            scripts.check
            scripts.clean
            scripts.update
            scripts.validate
          ];

          shellHook = ''
            # Set up environment
            export RUST_BACKTRACE=1
            export RUST_LOG=info

            # Ensure openssl can be found
            export PKG_CONFIG_PATH="${pkgs.openssl.dev}/lib/pkgconfig''${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
            export OPENSSL_DIR="${pkgs.openssl.dev}"
            export OPENSSL_LIB_DIR="${pkgs.openssl.out}/lib"
            export OPENSSL_INCLUDE_DIR="${pkgs.openssl.dev}/include"

            # Set up Tauri on Linux
            ${pkgs.lib.optionalString pkgs.stdenv.isLinux ''
              export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath linuxDeps}:$LD_LIBRARY_PATH"
              export XDG_DATA_DIRS="${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS"
            ''}

            # Pretty welcome message
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "🦀 Korppi Development Environment"
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""
            echo "📋 System Info:"
            echo "   Rust:       $(rustc --version)"
            echo "   Cargo:      $(cargo --version)"
            echo "   Node:       $(node --version)"
            echo "   NPM:        $(npm --version)"
            echo "   Platform:   ${system}"
            echo ""
            echo "🚀 Quick Commands:"
            echo "   korppi-dev       - Start development server"
            echo "   korppi-build     - Build for production"
            echo "   korppi-test      - Run Rust tests"
            echo "   korppi-check     - Run format/lint/test checks"
            echo "   korppi-validate  - Run 3-day validation suite"
            echo "   korppi-clean     - Clean all build artifacts"
            echo "   korppi-update    - Update all dependencies"
            echo ""
            echo "📚 Documentation:"
            echo "   Tauri:  https://tauri.app/v1/guides/"
            echo "   Pijul:  https://pijul.org/manual/introduction.html"
            echo ""
            echo "🔧 Setup (first time):"
            echo "   1. npm install                    # Install Node dependencies"
            echo "   2. korppi-dev                     # Start development"
            echo ""
            echo "🧪 For validation prototype:"
            echo "   cd src-tauri && cargo run         # Run CLI tests"
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""

            # Check if this is first run
            if [ ! -f "package.json" ]; then
              echo "⚠️  No package.json found. Run 'npm init' or copy from prototype."
              echo ""
            fi

            if [ ! -d "node_modules" ]; then
              echo "💡 Tip: Run 'npm install' to install JavaScript dependencies"
              echo ""
            fi
          '';

          # Environment variables for development
          RUST_SRC_PATH = "${rustToolchain}/lib/rustlib/src/rust/library";

          # Improve build times
          CARGO_BUILD_JOBS = "8";

          # Better error messages
          RUST_BACKTRACE = "1";

          # Enable incremental compilation
          CARGO_INCREMENTAL = "1";
        };

        # Package definitions for building Korppi
        packages = {
          default = self.packages.${system}.korppi;

          korppi = pkgs.rustPlatform.buildRustPackage {
            pname = "korppi";
            version = "0.1.0";

            src = ./.;

            cargoLock = {
              lockFile = ./src-tauri/Cargo.lock;
            };

            nativeBuildInputs = commonDeps ++ darwinDeps ++ linuxDeps;

            buildInputs = commonDeps ++ darwinDeps ++ linuxDeps;

            # Skip tests during build (run separately)
            doCheck = false;

            meta = with pkgs.lib; {
              description = "Local-first collaborative writing tool";
              homepage = "https://github.com/yourusername/korppi";
              license = licenses.mit;
              maintainers = [ ];
            };
          };
        };

        # CI/CD apps
        apps = {
          default = self.apps.${system}.korppi-dev;

          korppi-dev = {
            type = "app";
            program = "${scripts.dev}/bin/korppi-dev";
          };

          korppi-test = {
            type = "app";
            program = "${scripts.test}/bin/korppi-test";
          };

          korppi-check = {
            type = "app";
            program = "${scripts.check}/bin/korppi-check";
          };
        };

        # Formatter for `nix fmt`
        formatter = pkgs.nixpkgs-fmt;
      }
    );
}
