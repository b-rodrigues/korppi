Here is a pitch for Korppi, focusing on the freedom from "Version Hell" and the power of its unique backend:
Korppi is the first collaborative writing tool that allows you to work offline, share files via email or USB, and merge everything back together without ever fearing a "conflict" error. Unlike Google Docs (which demands you be online) or Microsoft Word (which breaks when too many people use Track Changes), Korppi uses a mathematical engine to treat every edit as a separate, compatible layer. This means five people can rewrite the same paragraph simultaneously on their own computers, and Korppi will simply present the variations side-by-side for you to choose the winner—no data loss, no overwriting, and no messy file versions.
Under the hood, Korppi brings the power of developer-grade version control to a beautiful, minimalist editor designed for everyone else. It replaces the anxiety of "Who has the latest version?" with a fluid, local-first workflow where you own your data completely. Whether you are drafting legislation, writing a novel, or managing contracts, Korppi turns the chaos of asynchronous collaboration into a calm, structured, and mathematically perfect history of your work.

# Korppi Technical Validation Plan

**Purpose:** Validate our core technical assumptions before investing 8+ weeks in full development.

## What We're Building (3-Day Prototype)

A minimal Tauri app that proves Pijul can:
1. Track document changes as patches
2. Merge conflicting edits from multiple sources
3. Surface conflicts in a format our UI can display

**Not included:** No React, no Milkdown, no polished UI. Just backend validation.

## Why This Matters Now

Our implementation plan assumes Pijul will work seamlessly in a desktop environment. But we haven't proven:

- ✅ **Compilation:** Does Pijul build successfully in Tauri across Windows/macOS/Linux?
- ✅ **API compatibility:** Can we call Pijul's Rust functions the way we need?
- ✅ **Conflict detection:** Does Pijul actually detect word-level conflicts and present them in a parseable format?
- ✅ **Performance:** Is patch application fast enough for real-time editing?
- ✅ **File format:** Can we serialize/deserialize patches for our `.pjmd` format?

**Risk if we skip this:** We could spend 6 weeks building the beautiful Phase 1 UI, then discover in Phase 2 that Pijul doesn't work as expected. That's a project-killing delay.

## The Three-Day Timeline

### Day 1: Does It Compile? (4 hours)
**Build:** Barebones Tauri app with Pijul as a dependency  
**Test:** Single button that creates an empty Pijul repository  
**Success metric:** App launches, button works, no build errors

**What we learn:** Whether there are platform-specific compilation issues we need to solve early.

---

### Day 2: Can We Track Changes? (6 hours)
**Build:** Add functions to record edits and retrieve history  
**Test:** Text area where you type → Save button → View patch history  
**Success metric:** Multiple edits show up as separate patches in the log

**What we learn:** 
- Exact Pijul API syntax we'll need
- How fast patch recording is (should be <100ms)
- Whether our "record every edit" approach is viable

---

### Day 3: The Critical Test—Merging (8 hours)
**Build:** Simulate two users editing the same text differently  
**Test:** Function that creates conflicting patches and checks for conflicts  
**Success metric:** Pijul detects the conflict and returns data we can parse

**What we learn:**
- **This is the make-or-break test.** If Pijul can't detect or represent conflicts in a useful way, our entire merge feature breaks.
- How conflicts are structured (line-based? character-based? can we get word-level?)
- Whether the "newline explosion" workaround (from Phase 2.2) is actually necessary

## Three Possible Outcomes

### ✅ Outcome A: "Green Light" (Best Case)
Everything works smoothly. Conflicts are detected and parseable.

**Action:** Proceed confidently with Phase 1 UI development. We know Phase 2 will succeed.

---

### ⚠️ Outcome B: "Yellow Light" (Needs Adjustment)
Pijul works, but we discover issues:
- Conflict format is complex (need extra parsing layer)
- Performance slower than expected (need optimization strategy)  
- Some edge cases don't work (need workarounds)

**Action:** Adjust implementation plan based on findings. Add new milestones or change approach to Phase 2. Still viable, but informed.

---

### 🛑 Outcome C: "Red Light" (Pivot Required)
Fundamental blockers:
- Pijul won't compile on Windows
- Conflicts aren't detected at word-level
- Performance is unacceptably slow (>1 second per edit)
- Merge logic is too complex to expose via simple API

**Action:** Pivot to alternative backends (Automerge, Yjs, or custom OT) **before** investing months in Pijul-specific work. Our Phase 1 UI design (the `KorppiEngine` interface) still works—we just swap the backend.

**Time saved:** 8+ weeks of Phase 2 work on the wrong foundation.

## Why 3 Days Is the Right Timeline

**Too short (1 day):** We won't hit the hard problems. Might get false confidence.

**Too long (2 weeks):** We're building a full prototype instead of validating assumptions. Defeats the purpose.

**3 days hits the sweet spot:**
- Day 1 catches build/environment issues
- Day 2 validates basic operations  
- Day 3 tests the **core value proposition** (conflict merging)

## What This Doesn't Delay

Phase 1 UI work can continue in parallel if needed:
- Designing the "conflict card" visual component
- Milkdown customization experiments
- User research on how non-techies think about conflicts

The key difference: We'll know by Thursday whether Phase 2 needs Plan B.

## Success Criteria (How We Decide)

By end of Day 3, we should be able to answer:

| Question | What "Yes" Looks Like | What "No" Means |
|----------|----------------------|-----------------|
| Does it build? | Runs on at least 2 platforms without errors | Compilation blockers exist |
| Can we track changes? | Patches are created and retrievable | API too complex/buggy |
| Are conflicts detected? | Function returns conflict data we can parse | Conflicts not detected or unusable format |
| Is performance acceptable? | Patch operations complete in <200ms | Noticeable lag (user experience issue) |

**Decision threshold:** Need "Yes" on at least 3 of 4 questions to proceed with Pijul. If 2 or fewer, we pivot.

## Resource Requirements

- **Time:** 1 developer, 3 full days (no meetings/distractions)
- **Environment:** Computer with Rust toolchain installed (any OS)
- **Dependencies:** Tauri CLI, Pijul crate (both free/open-source)

**Total cost:** 3 developer-days now vs. potentially 40+ developer-days wasted later.

## The Bottom Line

**This is risk management, not perfectionism.**

We're about to bet 2-3 months of development on Pijul being the right foundation. A 3-day prototype tells us if that bet is sound **before** we're pot-committed.

If Pijul works: We proceed with confidence.  
If it doesn't: We pivot early and save months.  
Either way: We make informed decisions instead of hopeful assumptions.

