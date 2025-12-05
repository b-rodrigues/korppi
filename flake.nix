{
  description = "Korppi - Local-first collaborative markdown editor with CRDT sync and patch history";

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
            "wasm32-unknown-unknown"
          ];
        };

        # Platform-specific system libraries
        darwinDeps = with pkgs; lib.optionals stdenv.isDarwin [
          darwin.apple-sdk.frameworks.Security
          darwin.apple-sdk.frameworks.CoreServices
          darwin.apple-sdk.frameworks.CoreFoundation
          darwin.apple-sdk.frameworks.Foundation
          darwin.apple-sdk.frameworks.AppKit
          darwin.apple-sdk.frameworks.WebKit
          darwin.apple-sdk.frameworks.Cocoa
          darwin.apple-sdk.frameworks.IOKit
          darwin.apple-sdk.frameworks.QuartzCore
          darwin.apple-sdk.frameworks.Carbon
          libiconv
        ];

        # Tauri 2.x dependencies for Linux
        linuxDeps = with pkgs; lib.optionals stdenv.isLinux [
          # Tauri dependencies
          webkitgtk_4_1
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
          cargo-watch
          cargo-edit
          cargo-outdated
          cargo-audit
          cargo-flamegraph

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
          just
          watchexec

          # Git for version control
          git

          # Testing and debugging
          lldb
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

            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo "🦀 Korppi Development Environment (Tauri 2.x)"
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
            echo "   korppi-clean     - Clean all build artifacts"
            echo "   korppi-update    - Update all dependencies"
            echo ""
            echo "🔧 Setup (first time):"
            echo "   1. npm install"
            echo "   2. korppi-dev"
            echo ""
            echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
            echo ""

            if [ ! -d "node_modules" ]; then
              echo "💡 Tip: Run 'npm install' to install JavaScript dependencies"
              echo ""
            fi
          '';

          RUST_SRC_PATH = "${rustToolchain}/lib/rustlib/src/rust/library";
          CARGO_BUILD_JOBS = "8";
          RUST_BACKTRACE = "1";
          CARGO_INCREMENTAL = "1";
        };

        formatter = pkgs.nixpkgs-fmt;
      }
    );
}
