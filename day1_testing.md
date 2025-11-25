# Day 1 Testing Guide

This guide walks you through testing the Day 1 implementation of Korppi.

## What You're Testing

**Goal:** Verify that Pijul can create a repository structure in Tauri.

**Success Criteria:**
- ✅ Rust code compiles without errors
- ✅ Tauri app launches with UI
- ✅ Repository directory is created
- ✅ Pristine database is initialized
- ✅ Main channel is created
- ✅ No runtime errors

## Prerequisites

Make sure you've completed setup:

```bash
# Enter Nix environment
nix develop
# or
direnv allow

# Install Node dependencies
npm install
```

## Step 1: Verify Compilation (5 minutes)

```bash
# Test Rust code compiles
cd src-tauri
cargo check

# Expected output:
#   Checking korppi-prototype v0.1.0
#   Finished dev [unoptimized + debuginfo] target(s) in X.XXs
```

**If compilation fails:**
- Check error messages carefully
- Common issues:
  - Missing trait imports
  - Pijul version mismatch
  - Missing dependencies

**Fix:** See troubleshooting section below.

---

## Step 2: Launch the Application (2 minutes)

```bash
# Return to project root
cd ..

# Start development server
npm run tauri dev
# or
just dev
```

**Expected:**
- Terminal shows compilation progress
- Window opens with Korppi UI
- No error messages in terminal

**What you should see:**
```
    Compiling korppi-prototype v0.1.0
    Finished dev [unoptimized + debuginfo] target(s) in X.XXs
[Tauri] Listening on http://localhost:XXXX
```

A window should appear showing:
- Header: "🦀 Korppi Prototype"
- Day 1 section highlighted in blue
- Three buttons: "Test Pijul Init", "Check Repository Status", "Reset Repository"

**If app doesn't launch:**
- Check terminal for Rust errors
- Check browser console (F12) for JavaScript errors
- Verify Tauri dependencies are installed

---

## Step 3: Run Day 1 Test (2 minutes)

### Test A: Initialize Repository

1. Click **"▶️ Test Pijul Init"** button
2. Button text changes to "⏳ Initializing..."
3. Wait 1-2 seconds

**Expected Success:**
- Green success box appears
- Message: "✅ Pijul repository initialized successfully!"
- Details show:
  ```
  Repository created at: /tmp/korppi-test-repo

  Structure:
  - .pijul/ directory created
  - pristine/ database initialized
  - main channel created
  - changes/ directory ready

  ✨ Day 1 validation complete!
  ```
- Celebration animation: "🎉 Day 1 Complete! 🎉"

**Expected Behavior on Failure:**
- Red error box appears
- Message explains what failed
- Details show error message from Pijul

---

### Test B: Verify Repository Structure

1. Click **"📊 Check Repository Status"**

**Expected output:**
```
📁 Repository Status

Path: /tmp/korppi-test-repo

Structure:
  .pijul/ - ✅
  pristine/ - ✅
  changes/ - ✅
  pristine/db - ✅

✅ Repository is valid and functional
```

---

### Test C: Manual Verification

Open a terminal and check the file system:

```bash
# Check repository exists
ls -la /tmp/korppi-test-repo/

# Expected output:
# drwxr-xr-x  3 user  wheel   96 Nov 24 12:00 .pijul

# Check internal structure
ls -la /tmp/korppi-test-repo/.pijul/

# Expected output:
# drwxr-xr-x  3 user  wheel   96 Nov 24 12:00 changes
# drwxr-xr-x  3 user  wheel   96 Nov 24 12:00 pristine

# Check database file
ls -lh /tmp/korppi-test-repo/.pijul/pristine/db

# Expected: File exists, size varies (typically a few KB)
```

---

### Test D: Reset and Repeat

1. Click **"🗑️ Reset Repository"**
2. Confirm the dialog
3. Check that status box disappears
4. Click **"▶️ Test Pijul Init"** again
5. Should succeed again

**This tests:**
- Cleanup works properly
- Initialization is repeatable
- No stale state issues

---

## Step 4: Run Automated Tests (2 minutes)

```bash
cd src-tauri
cargo test

# Expected output:
# running 3 tests
# test pijul_ops::tests::test_get_test_repo_path ... ok
# test pijul_ops::tests::test_init_repository ... ok
# test pijul_ops::tests::test_verify_repository ... ok
```

**What this tests:**
- Repository initialization logic
- Verification logic
- Path handling

---

## Success Checklist

Use this to verify Day 1 is complete:

- [ ] Code compiles without errors
- [ ] App launches and shows UI
- [ ] "Test Pijul Init" button succeeds
- [ ] Success message shows correct details
- [ ] Repository status shows all checkmarks
- [ ] Manual filesystem check confirms structure
- [ ] Reset works and can re-initialize
- [ ] Cargo tests pass
- [ ] No errors in terminal or console

**If all boxes are checked: 🎉 Day 1 is complete!**

---

## Troubleshooting

### Issue: Compilation Error - "trait MutTxnT not found"

**Cause:** Missing trait imports

**Fix:** Add to top of `pijul_ops.rs`:
```rust
use libpijul::pristine::{MutTxnT, ChannelMutTxnT};
```

---

### Issue: Runtime Error - "channel not found"

**Cause:** Main channel wasn't created during init

**Fix:** Check that `init_repository` includes:
```rust
let mut txn = pristine.mut_txn_begin()?;
txn.open_or_create_channel("main")?;
txn.commit()?;
```

---

### Issue: "Pristine::new failed"

**Cause:** Database path doesn't exist or permissions issue

**Fix:**
```bash
# Check temp directory is writable
ls -ld /tmp
# Should show drwxrwxrwt

# Manually test
mkdir -p /tmp/korppi-test
touch /tmp/korppi-test/test.txt
# If this fails, your /tmp has permission issues
```

---

### Issue: App window doesn't open

**Cause:** Tauri dependencies missing

**Fix (macOS):**
```bash
# In nix develop shell, check:
echo $IN_NIX_SHELL  # Should output "impure"
```

**Fix (Linux):**
```bash
# Verify libraries are available
echo $LD_LIBRARY_PATH
# Should show Nix store paths
```

---

### Issue: "libpijul version mismatch"

**Cause:** Wrong version of libpijul

**Fix:** Check `Cargo.toml`:
```toml
libpijul = "=1.0.0-beta.9"  # Exact version
```

Run:
```bash
cd src-tauri
cargo update libpijul
cargo clean
cargo build
```

---

## Next Steps After Day 1 Success

Once Day 1 is working:

### Option A: Proceed to Day 2
- Study Pijul CLI source code for recording examples
- Implement `record_change` function
- Expected time: 4-8 hours

### Option B: Document and Report
- Take screenshots of successful test
- Document any issues encountered
- Share results with team
- Decide on Day 2 approach

### Option C: Consider Alternatives
If Day 1 was very difficult or unstable:
- Evaluate switching to Automerge or Yjs
- These have simpler APIs and better documentation
- Can still use the same Tauri + React structure

---

## Debug Commands

Useful for investigating issues:

```bash
# Check repository on disk
ls -laR /tmp/korppi-test-repo/

# View Rust logs (set RUST_LOG before starting app)
RUST_LOG=debug npm run tauri dev

# Check Pijul version in use
cd src-tauri
cargo tree | grep libpijul

# Test just the Pijul code
cargo test -- --nocapture

# Clean and rebuild everything
just clean
npm install
npm run tauri dev
```

---

## Performance Expectations

**Compilation (first time):**
- Cold build: 2-5 minutes
- Incremental: 5-15 seconds

**Runtime:**
- App launch: 1-3 seconds
- Repository init: <100ms
- UI interactions: Instant

**If slower:** Check system resources, close other apps.

---

## Reporting Results

After testing, document:

1. **Environment:**
   - OS: (macOS/Linux/WSL2)
   - Nix version: `nix --version`
   - Rust version: `rustc --version`

2. **Results:**
   - Did compilation succeed? Y/N
   - Did app launch? Y/N
   - Did init test pass? Y/N
   - Did verification pass? Y/N
   - Any errors encountered?

3. **Screenshots:**
   - Successful init result
   - Repository status output
   - Any error messages

4. **Next Steps:**
   - Ready for Day 2? Y/N
   - Any blockers?
   - Estimated time to complete Day 2?

---

## Additional Resources

- **Pijul Documentation:** https://pijul.org/manual/
- **libpijul API Docs:** https://docs.rs/libpijul/
- **Pijul Source Code:** https://nest.pijul.com/pijul/pijul
- **Tauri Docs:** https://tauri.app/v1/guides/

---

Good luck! 🚀

Remember: Day 1 is about **proving compilation and basic structure work**. Even if Pijul operations are challenging, getting this far validates the Tauri + Nix + Rust setup.
