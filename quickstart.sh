#!/usr/bin/env bash
# Korppi Day 1 Quick Start Script
# This script runs all Day 1 tests in sequence

set -e  # Exit on error

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║       🦀 Korppi Day 1 Quick Start                             ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Track success
TESTS_PASSED=0
TESTS_FAILED=0

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ PASSED${NC}: $2"
        ((TESTS_PASSED++))
    else
        echo -e "${RED}❌ FAILED${NC}: $2"
        ((TESTS_FAILED++))
    fi
}

# Check prerequisites
echo -e "${BLUE}📋 Checking Prerequisites...${NC}"
echo ""

# Check for Nix
if command -v nix &> /dev/null; then
    echo -e "${GREEN}✅${NC} Nix found: $(nix --version | head -n1)"
else
    echo -e "${RED}❌${NC} Nix not found!"
    echo "   Install: curl --proto '=https' --tlsv1.2 -sSf -L https://install.determinate.systems/nix | sh -s -- install"
    exit 1
fi

# Check for Node (in Nix shell, this should be available)
if command -v node &> /dev/null; then
    echo -e "${GREEN}✅${NC} Node found: $(node --version)"
else
    echo -e "${YELLOW}⚠️${NC}  Node not found (will be available in nix develop)"
fi

# Check for Rust (in Nix shell, this should be available)
if command -v rustc &> /dev/null; then
    echo -e "${GREEN}✅${NC} Rust found: $(rustc --version)"
else
    echo -e "${YELLOW}⚠️${NC}  Rust not found (will be available in nix develop)"
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Test 1: Check if package.json exists
echo -e "${BLUE}Test 1: Checking project structure...${NC}"
if [ -f "package.json" ] && [ -f "src-tauri/Cargo.toml" ]; then
    print_status 0 "Project structure"
else
    print_status 1 "Project structure"
    echo "   Missing package.json or Cargo.toml"
    exit 1
fi
echo ""

# Test 2: Install Node dependencies
echo -e "${BLUE}Test 2: Installing Node dependencies...${NC}"
if [ ! -d "node_modules" ]; then
    if npm install > /tmp/korppi-npm-install.log 2>&1; then
        print_status 0 "npm install"
    else
        print_status 1 "npm install"
        echo "   See /tmp/korppi-npm-install.log for details"
        exit 1
    fi
else
    echo -e "${GREEN}✅${NC} node_modules already exists, skipping"
fi
echo ""

# Test 3: Rust compilation check
echo -e "${BLUE}Test 3: Checking Rust compilation...${NC}"
cd src-tauri
if cargo check > /tmp/korppi-cargo-check.log 2>&1; then
    print_status 0 "cargo check"
else
    print_status 1 "cargo check"
    echo "   See /tmp/korppi-cargo-check.log for details"
    tail -20 /tmp/korppi-cargo-check.log
    exit 1
fi
cd ..
echo ""

# Test 4: Run Rust unit tests
echo -e "${BLUE}Test 4: Running Rust unit tests...${NC}"
cd src-tauri
if cargo test --quiet > /tmp/korppi-cargo-test.log 2>&1; then
    print_status 0 "cargo test"
    # Show test summary
    grep -E "test result:" /tmp/korppi-cargo-test.log || true
else
    print_status 1 "cargo test"
    echo "   See /tmp/korppi-cargo-test.log for details"
    tail -20 /tmp/korppi-cargo-test.log
fi
cd ..
echo ""

# Test 5: Manual repository initialization test
echo -e "${BLUE}Test 5: Testing repository initialization...${NC}"
cd src-tauri
cat > /tmp/korppi-init-test.rs << 'EOF'
use std::path::Path;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // This will be replaced with actual test
    println!("Manual init test would run here");
    Ok(())
}
EOF

# Note: We can't easily run the actual init without starting Tauri
echo -e "${YELLOW}⚠️${NC}  Manual test requires running the app"
echo "   Run: npm run tauri dev"
echo "   Then click: 'Test Pijul Init'"
cd ..
echo ""

# Summary
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${BLUE}📊 Test Summary${NC}"
echo "   Tests Passed: ${GREEN}${TESTS_PASSED}${NC}"
if [ ${TESTS_FAILED} -gt 0 ]; then
    echo "   Tests Failed: ${RED}${TESTS_FAILED}${NC}"
else
    echo "   Tests Failed: ${TESTS_FAILED}"
fi
echo ""

if [ ${TESTS_FAILED} -eq 0 ]; then
    echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║  🎉 All automated tests passed!                               ║${NC}"
    echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}🚀 Next Steps:${NC}"
    echo ""
    echo "1. Start the development server:"
    echo -e "   ${YELLOW}npm run tauri dev${NC}"
    echo ""
    echo "2. In the app window, click:"
    echo -e "   ${YELLOW}▶️ Test Pijul Init${NC}"
    echo ""
    echo "3. Verify you see:"
    echo "   ✅ Pijul repository initialized successfully!"
    echo ""
    echo "4. Check repository status:"
    echo -e "   ${YELLOW}📊 Check Repository Status${NC}"
    echo ""
    echo "5. See DAY1_TESTING.md for detailed testing guide"
    echo ""
    exit 0
else
    echo -e "${RED}╔════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║  ❌ Some tests failed                                         ║${NC}"
    echo -e "${RED}╚════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}🔧 Troubleshooting:${NC}"
    echo ""
    echo "1. Check log files in /tmp/:"
    echo "   - korppi-npm-install.log"
    echo "   - korppi-cargo-check.log"
    echo "   - korppi-cargo-test.log"
    echo ""
    echo "2. Make sure you're in the Nix shell:"
    echo -e "   ${YELLOW}nix develop${NC}"
    echo "   or"
    echo -e "   ${YELLOW}direnv allow${NC}"
    echo ""
    echo "3. Try cleaning and rebuilding:"
    echo -e "   ${YELLOW}just clean${NC}"
    echo -e "   ${YELLOW}npm install${NC}"
    echo ""
    echo "4. See DAY1_TESTING.md for detailed troubleshooting"
    echo ""
    exit 1
fi
