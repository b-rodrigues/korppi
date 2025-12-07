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

        darwinDeps = with pkgs; lib.optionals stdenv.isDarwin ([
          libiconv
          darwin.cctools
          apple-sdk
        ]);

        # Tauri 2.x dependencies for Linux
        linuxDeps = with pkgs; lib.optionals stdenv.isLinux [
          webkitgtk_4_1
          gtk3
          cairo
          gdk-pixbuf
          glib
          dbus
          openssl
          librsvg
          pango
          atk
          libsoup_3
          pkg-config
        ];

        # Common dependencies across all platforms
        commonDeps = with pkgs; [
          rustToolchain
          cargo-watch
          cargo-edit
          cargo-outdated
          cargo-audit
          cargo-flamegraph
          nodejs_20
          nodePackages.npm
          openssl
          zlib
          pkg-config
          cmake
          just
          watchexec
          git
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
        ############################################################
        # PACKAGES
        ############################################################
        packages = rec {
          # Builds the Rust Tauri backend (no linuxdeploy)
          korppi-bin = pkgs.rustPlatform.buildRustPackage {
            pname = "korppi-prototype";
            version = "0.1.0";

            src = ./.;

            cargoToml = ./src-tauri/Cargo.toml;
            cargoLock = ./src-tauri/Cargo.lock;

            nativeBuildInputs = [
              pkgs.nodejs_20
              pkgs.nodePackages.npm
              pkgs.pkg-config
              pkgs.cmake
            ];

            buildInputs = commonDeps ++ darwinDeps ++ linuxDeps;

            # Build Tauri frontend before cargo
            preBuild = ''
              npm ci
              npm run build
            '';
          };

          # Wrap as AppImage using Nix — replaces linuxdeploy fully
          appimage = pkgs.appimageTools.wrapType2 {
            name = "korppi";
            src = korppi-bin;

            extraInstallCommands = ''
              mkdir -p $out/share/applications
              cat > $out/share/applications/korppi.desktop <<EOF
              [Desktop Entry]
              Name=Korppi
              Exec=korppi
              Type=Application
              Categories=Utility;
              EOF
            '';
          };

          # Default package = built binary
          default = korppi-bin;
        };

        ############################################################
        # DEV SHELL
        ############################################################
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
            export RUST_BACKTRACE=1
            export RUST_LOG=info

            export PKG_CONFIG_PATH="${pkgs.openssl.dev}/lib/pkgconfig''${PKG_CONFIG_PATH:+:$PKG_CONFIG_PATH}"
            export OPENSSL_DIR="${pkgs.openssl.dev}"
            export OPENSSL_LIB_DIR="${pkgs.openssl.out}/lib"
            export OPENSSL_INCLUDE_DIR="${pkgs.openssl.dev}/include"

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
            echo "   korppi-dev"
            echo "   korppi-build"
            echo "   korppi-test"
            echo "   korppi-check"
            echo "   korppi-clean"
            echo "   korppi-update"
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
