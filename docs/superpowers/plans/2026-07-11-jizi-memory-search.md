# Jizi Memory and Deep Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace append-only memory with versioned records and extend search from snippets to safely fetched, attributable body excerpts.

**Architecture:** Memory migration and conflict resolution remain Store-independent pure functions. Deep search adds URL policy, bounded fetch, text extraction, source classification, and evidence assembly after existing provider failover.

**Tech Stack:** TypeScript, Zustand persist migrations, Tauri HTTP, DOMParser, Vitest.

## Global Constraints

- Existing memory strings migrate without loss.
- Conflicted, superseded, and expired records are never injected as active memory.
- Deep fetch must block private/local addresses and limit redirects, size, type, and time.
- Run every `npm.cmd` command in this plan from `app`.

---

### Task 1: Introduce structured memory and migration

**Files:**
- Create: `app/src/lib/jiziMemoryRecords.ts`
- Create: `app/src/lib/jiziMemoryRecords.test.ts`
- Modify: `app/src/stores/masterAgentStore.ts`
- Modify: `app/src/lib/jiziMemory.ts`
- Modify: `app/src/lib/jiziMemory.test.ts`

**Interfaces:**
- Produces: `JiziMemoryRecord`, `migrateLegacyMemory`, `activeMemoryRecords`, and `applyMemoryDraft`.

- [ ] **Step 1: Write failing migration tests**

Assert that all legacy strings become active records with `origin: 'migration'`, stable generated IDs, confidence `1`, and no lost duplicates after normalized exact deduplication.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- src/lib/jiziMemoryRecords.test.ts`

- [ ] **Step 3: Implement record types and pure migration**

Use the exact record shape from the design. IDs must be generated once during Store migration, not during selectors. Preserve the old category mapping.

- [ ] **Step 4: Bump Store version and migrate**

Retain a compatibility selector that exposes grouped active strings to existing UI until the memory management UI is migrated. Persist `memoryRecords`; stop writing new entries to legacy arrays.

- [ ] **Step 5: Update extraction and semantic selection**

Selection candidates include only active, unexpired records. The prompt includes IDs, content, scope, and confidence, but not hidden source message content.

- [ ] **Step 6: Run tests and commit**

Run: `npm.cmd test -- src/lib/jiziMemoryRecords.test.ts src/lib/jiziMemory.test.ts`

Run: `npm.cmd test`

```bash
git add app/src/lib/jiziMemoryRecords.ts app/src/lib/jiziMemoryRecords.test.ts app/src/stores/masterAgentStore.ts app/src/lib/jiziMemory.ts app/src/lib/jiziMemory.test.ts
git commit -m "feat(jizi): migrate to structured memory records"
```

### Task 2: Add memory replacement, conflict, and expiry rules

**Files:**
- Modify: `app/src/lib/jiziMemoryRecords.ts`
- Modify: `app/src/lib/jiziMemoryRecords.test.ts`
- Modify: `app/src/components/MasterAgentPanel.tsx`

**Interfaces:**
- Produces: `resolveMemoryCandidate(existing, candidate, decision)` with decisions `append`, `supersede`, `conflict`, or `ignore`.

- [ ] **Step 1: Write failing rule tests**

Cover explicit preference replacement, ambiguous contradiction, expired records, lower-confidence duplicates, and project/global scope separation.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- src/lib/jiziMemoryRecords.test.ts`

- [ ] **Step 3: Implement deterministic application rules**

Exact normalized duplicates update timestamp/confidence. Explicit user corrections supersede matched records. Ambiguous contradictions mark both records conflicted. Expired records remain stored but inactive.

- [ ] **Step 4: Update memory refresh flow**

The extraction model returns candidate plus relation IDs and confidence. Invalid relation IDs fall back to append only when confidence is at least `0.8`; otherwise ignore.

- [ ] **Step 5: Verify and commit**

Run: `npm.cmd test`

Run: `npm.cmd run build`

```bash
git add app/src/lib/jiziMemoryRecords.ts app/src/lib/jiziMemoryRecords.test.ts app/src/components/MasterAgentPanel.tsx
git commit -m "feat(jizi): resolve memory conflicts and expiry"
```

### Task 3: Add safe deep-page fetching

**Files:**
- Create: `app/src/lib/webPageReader.ts`
- Create: `app/src/lib/webPageReader.test.ts`

**Interfaces:**
- Produces: `validatePublicHttpUrl(url)`, `readWebPage(url, options)`, and `extractReadableText(html)`.

- [ ] **Step 1: Write failing URL-policy tests**

Reject localhost, loopback IPv4/IPv6, RFC1918, link-local, credentials in URLs, non-HTTP schemes, redirects to blocked targets, non-text content, responses over 2 MB, more than 3 redirects, and requests over 10 seconds.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- src/lib/webPageReader.test.ts`

- [ ] **Step 3: Implement URL and response policy**

Resolve hostnames before request in the Tauri/Rust boundary or use a backend endpoint that validates every resolved address and redirect target. Do not rely only on string checks in the WebView.

- [ ] **Step 4: Implement deterministic text extraction**

Remove scripts, styles, navigation, forms, and hidden elements. Prefer `article`, then `main`, then body. Normalize whitespace and cap extracted text at 80,000 characters.

- [ ] **Step 5: Run tests and commit**

Run: `npm.cmd test -- src/lib/webPageReader.test.ts`

```bash
git add app/src/lib/webPageReader.ts app/src/lib/webPageReader.test.ts
git commit -m "feat(jizi): add safe bounded web page reader"
```

### Task 4: Assemble attributable deep-search evidence

**Files:**
- Create: `app/src/lib/jiziDeepSearch.ts`
- Create: `app/src/lib/jiziDeepSearch.test.ts`
- Modify: `app/src/components/MasterAgentPanel.tsx`
- Modify: `app/src/stores/masterAgentStore.ts`

**Interfaces:**
- Produces: `buildDeepSearchEvidence(userText, query, results, deps)` and source metadata containing fetch mode, authority class, and evidence excerpts.

- [ ] **Step 1: Write failing evidence tests**

Test successful two-source corroboration, one-source warning, body-fetch fallback to snippet, duplicate-domain handling, official source priority, and cancellation.

- [ ] **Step 2: Run and verify RED**

Run: `npm.cmd test -- src/lib/jiziDeepSearch.test.ts`

- [ ] **Step 3: Implement bounded parallel reading**

Read at most 4 pages with concurrency 2. Select relevant excerpts through the existing LLM client, but validate returned source IDs and cap each excerpt at 2,000 characters.

- [ ] **Step 4: Integrate evidence and source metadata**

Prompt injection uses excerpts, authority labels, URLs, and fallback warnings. Chat sources show whether the body or only the search snippet was used.

- [ ] **Step 5: Run full verification and commit**

Run: `npm.cmd test`

Run: `npm.cmd run lint`

Run: `npm.cmd run build`

```bash
git add app/src/lib/jiziDeepSearch.ts app/src/lib/jiziDeepSearch.test.ts app/src/components/MasterAgentPanel.tsx app/src/stores/masterAgentStore.ts
git commit -m "feat(jizi): use attributable deep-search evidence"
```
