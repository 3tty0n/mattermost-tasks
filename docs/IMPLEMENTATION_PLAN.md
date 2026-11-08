# Implementation plan

The work is split into independently testable phases, in the order requested by the task. Each
phase ends with the narrowest relevant test command; the full `make test`/`make check-style` run
happens at the end.

## Phase 0 — Repository and decisions

- [x] Start from the Mattermost plugin starter template (this repository).
- [x] Compare the reference plugins; record the comparison in `ARCHITECTURE.md`.
- [x] Choose storage: plugin KV store plus compact per-scope indexes, no SQL driver, no key scans.
- [x] Define the task/bookmark models, enums and permission matrix.
- [x] Set the plugin identity (`plugin.json`, Go module path, webapp manifest usage).
- [x] Document the design in `ARCHITECTURE.md` and this file.

## Phase 1 — Server foundation

- [x] `server/model`: task/bookmark records, compact index refs, validation, query comparison and
      pagination helpers with focused unit tests.
- [x] `server/store/kvstore`: narrow KV interface, atomic update helpers, four-shard index
      maintenance, version guards and an in-memory KV for tests.
- [x] Store tests: create/update/delete index maintenance, scope moves, assignee changes,
      concurrent updates, corruption/not-found handling.

## Phase 2 — Permissions and services

- [x] `server/access`: team/channel/system checks and scope resolution.
- [x] `server/tasks`: create/list/get/update/delete, status transitions, assignment rules,
      audit records, WebSocket events and notification dispatch.
- [x] `server/bookmarks`: create/list/get/update/delete and search.
- [x] Unit tests using a real store over the in-memory KV and a fake Mattermost API for
      permission outcomes, private-channel isolation, invalid input, concurrent updates,
      notification deduplication.

## Phase 3 — REST API and slash commands

- [x] Routes under `/api/v1` with strict JSON decoding, page-size caps, generic error responses,
      `Cache-Control: no-store`, and request-body limits.
- [x] Handler tests for happy paths and every denied/bad-input path (401/403/400/404).
- [x] `/task` slash commands (`list`, `create`, `done`, `show`, `bookmark`, `help`) sharing the
      service layer for mobile and keyboard fallback.
- [x] Plugin activation wiring, configuration, bot creation and notification worker lifecycle.

## Phase 4 — Webapp

- [x] Typed client with abortable requests and CSRF-compatible `Client4.getOptions`.
- [x] Redux slice for websocket revision, reconnect reset and deep-link task selection.
- [x] RHS: Tasks/Bookmarks switch, My/Team/Channel/All scopes, filters, sort, pagination,
      status quick-toggle, loading/error/empty states.
- [x] Task editor dialog: title, description, scope, assignees, status, priority, due date.
- [x] Task detail: metadata, source post link, edit/delete.
- [x] Bookmark list, search, create/edit dialog with URL selection from posts.
- [x] Channel header button, post dropdown actions, `#task-<id>` deep link, websocket refresh.
- [x] Webapp tests with mocked client: filtering, status change, editor/assignee selection,
      bookmark management, error handling.

## Phase 5 — Verification and deliverables

- [x] `plugin.json` manifest, icon, settings schema and build integration.
- [x] `README.md` installation and usage, `docs/API.md` endpoint reference,
      `docs/DEPLOYMENT.md` backup/upgrade notes.
- [x] `go test -race ./server/...`, `go vet`, webapp `npm test`, `npm run lint`,
      `npm run check-types`, production bundle build.
- [x] `golangci-lint` (v2.15.0, with the repository config): 0 issues.
- [x] `govulncheck ./...`: no called vulnerabilities; `npm audit --omit=dev`: 0 advisories.
- [x] Testcontainers integration tests against a live Mattermost 11.7.0 container: task/bookmark CRUD,
      private-channel isolation, plugin restart persistence, and assignment DM delivery.
- [ ] Browser-level end-to-end UI testing (the production bundle builds and component tests pass,
      but no browser automation was available).

**Unverified:** browser automation only.

## Deliberate non-goals for the MVP

- Due-date reminder cron job (the prompt marks it optional).
- Bookmark metadata fetching (avoids SSRF and external latency).
- Subtask UI (`parentTaskId` is reserved in the model/API).
- Real-time collaborative editing of a task; last-write-wins with CAS and version guards.
- Full-page task boards or kanban; the RHS is the primary surface.
