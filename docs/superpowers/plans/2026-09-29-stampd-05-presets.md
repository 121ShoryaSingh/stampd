# Stampd Plan 5: Workspace Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reusable, workspace-private presets (PDF + roles + fields), managed like Horizon Admin's presets, used to start envelopes.

**Architecture:** Three new tenant tables under the same RLS policy as envelopes. A `src/server/presets/` service mirrors the envelope services (withTenant, lock by touching the row, audit on use). The envelope field editor becomes generic (a bound save action + a list of "people"), so the preset editor reuses it with roles.

**Tech Stack:** Next.js 16.3, Prisma 7.10 (no raw SQL outside migrations), Postgres RLS, vitest + testcontainers, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-28-stampd-design.md` section 13.

## Global Constraints

- No raw SQL in app code; SQL only in migrations (enforced by `tests/db/no-raw-sql.test.ts`).
- Every tenant table: ENABLE + FORCE RLS, policy `tenant_isolation` on `tenant_id = app_tenant_id()`.
- Admins manage presets; members only list and use active ones.
- Inputs use `Enter <label>` placeholders; shadcn inputs via `src/components/ui`.
- Comments are one short line. Plain ASCII only (no em/en dashes).
- Storage keys: preset PDF at `t/<tenant>/p/<preset>/doc/<uuid>.pdf`; envelopes get their own copy.
- PDFs: 25 MB max, same inspect checks as envelopes (`inspectPdf`).

## Review Focus

1. A preset id from another workspace passed to any action: must be "not found", never data.
2. Using a preset whose signer role has no fields: refused with a clear message.
3. Deleting a draft made from a preset, or the draft a preset was saved from: preset PDF still loads.
4. Two admins saving the same preset at once: version bumps once per save, no lost roles (row lock).
5. Replacing a preset PDF with fewer pages: fields on missing pages are dropped, not left dangling.

---

### Task 1: Schema, migration and RLS

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_presets/migration.sql` (via `prisma migrate dev --create-only`, then append RLS)
- Test: `tests/db/rls-presets.test.ts`

**Produces:** Prisma models `Preset`, `PresetRole`, `PresetField`; enum `PresetStatus { active archived }`.

- [ ] Add models: `Preset` (id uuid7, tenantId, name, description?, status, version Int @default(1), usageCount Int @default(0), lastUsedAt?, createdBy, message?, filename?, s3Key?, sha256?, pageCount Int @default(0), pageSizes Json @default("[]"), sizeBytes Int @default(0), timestamps; index [tenantId, status]); `PresetRole` (id, tenantId, presetId, label, role RecipientRole, routingOrder, defaultName?, defaultEmail?, position Int); `PresetField` (id, tenantId, presetId, presetRoleId, type FieldType, page, x, y, w, h, required). Cascades from preset and role.
- [ ] Create migration, append: enable + force RLS and `tenant_isolation` policy on `presets`, `preset_roles`, `preset_fields`; grant select/insert/update/delete to `stampd_app`.
- [ ] Failing test: as tenant A, create a preset; as tenant B, `findMany` returns nothing and `update` by id changes 0 rows; with no tenant set, reads return nothing.
- [ ] `prisma migrate deploy`, `prisma generate`, test passes. Commit `feat: preset tables with RLS`.

### Task 2: Preset service, create and manage

**Files:**
- Create: `src/server/presets/service.ts`, `src/server/presets/service.test.ts`
- Modify: `src/server/envelopes/keys.ts` (add `presetDocKeyFor(tenantId, presetId)`)

**Produces:**
- `createPreset({tenantId,userId,name,description?}) -> {id}`
- `presetUploadUrl({tenantId,presetId}) -> {url,key}`; `finalizePresetUpload({tenantId,userId,presetId,key,filename}) -> {pageCount}` (drops fields on removed pages, bumps version if any dropped)
- `setPresetRoles({tenantId,userId,presetId,roles:{id?,label,role,routingOrder,defaultName?,defaultEmail?}[]}) -> {id,label}[]` (bumps version)
- `savePresetFields({tenantId,userId,presetId,fields:{roleId,type,page,x,y,w,h,required?}[]}) -> number` (same checks as `saveFields`; bumps version)
- `updatePresetInfo({tenantId,userId,presetId,name,description?})` (no version bump)
- `archivePreset` / `restorePreset`, `duplicatePreset -> {id}` (copies PDF object)
- `listPresets(tenantId,{status,q}) -> rows with roles count, usage`, `getPreset(tenantId,id)`

- [ ] Failing tests: member gets ForbiddenError on every write; name 2-80 chars; upload checks reuse envelope PDF rules; roles validated like recipients (label required, max 20, order 1-20, cc has no fields); version bumps on roles/fields, not on info; duplicate copies PDF bytes to a new key and resets usage; archive hides from `listPresets({status:"active"})`; concurrent `setPresetRoles` twice gives version +2.
- [ ] Implement with `withTenant`, admin check via membership, row lock by `tx.preset.update({ data: { updatedAt } })`.
- [ ] Tests pass. Commit `feat: preset service`.

### Task 3: Save as preset and use preset

**Files:**
- Modify: `src/server/presets/service.ts`, test file
- Modify: `src/server/audit/*` only if event names are validated

**Produces:**
- `savePresetFromEnvelope({tenantId,userId,envelopeId,name,replacePresetId?}) -> {id}`: needs document + recipients; copies PDF; recipients -> roles (label = name, defaultEmail = email); fields mapped by recipient.
- `createEnvelopeFromPreset({tenantId,userId,presetId,title,people:Record<roleId,{name,email}>}) -> {envelopeId}`: active only; every signer role has a field; copies PDF to envelope doc key; creates document, recipients, fields; audit `created_from_preset` {presetId, version}; usage +1, lastUsedAt now.

- [ ] Failing tests: round trip (save from envelope, use it, new draft has same field boxes, types and orders); replace bumps version and keeps id; deleting source draft leaves preset PDF readable; deleting new draft leaves preset PDF readable; archived preset refused; signer role without fields refused; missing person for a role refused; other tenant's preset id is NotFound.
- [ ] Implement, tests pass. Commit `feat: save as preset and start envelopes from presets`.

### Task 4: Generic field editor

**Files:**
- Modify: `src/app/(app)/envelopes/[id]/edit/editor.tsx`, `page.tsx`
- Move: editor to `src/components/app/field-editor.tsx`

**Produces:** `FieldEditor({ save: (list) => Promise<{count}|{error}>, pdfUrl, pageSizes, people: {id,name,role}[], initial, assignLabel? })`. Envelope page passes `saveFieldsAction.bind(null, id)`.

- [ ] Refactor only; existing `e2e/editor.spec.ts` and `e2e/send.spec.ts` must stay green.
- [ ] Commit `refactor: field editor takes a save action and people`.

### Task 5: Presets pages

**Files:**
- Create: `src/app/(app)/presets/page.tsx` (list, search, Active/Archived tabs, New preset for admins), `presets/new/page.tsx` + `actions.ts`, `presets/[id]/page.tsx` (info form, upload, roles form, field editor, duplicate/archive/restore), `presets/[id]/use/page.tsx` (title + name/email per role, prefilled)
- Modify: `src/components/app/shell.tsx` (nav item "Presets"), `src/app/(app)/envelopes/new/page.tsx` ("Start from a preset" list), `src/app/(app)/envelopes/[id]/page.tsx` ("Save as preset" for admins on drafts with document and recipients)

- [ ] Server actions validate with zod and map DomainError to `{error}` like `edit/actions.ts`.
- [ ] Members: see list and Use only; admin-only controls not rendered and actions refuse.
- [ ] Commit `feat: presets pages`.

### Task 6: End-to-end

**Files:**
- Create: `e2e/presets.spec.ts`

- [ ] Admin creates a preset (upload, roles Client + Manager, a signature field each), uses it with two people, sends, first signer receives an invite.
- [ ] Save as preset from a draft, then duplicate, archive (hidden from Use), restore.
- [ ] A member sees presets and can use one, sees no New/Archive buttons.
- [ ] Axe passes on `/presets` and the preset editor.
- [ ] Full `npm test` and `npm run e2e` green. Commit `test: presets e2e`.
