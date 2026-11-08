# Architecture

This document records the architecture decisions for the Tasks & Bookmarks plugin. It is
deliberately biased toward a small production deployment (one Mattermost app node, 1 vCPU,
512 MB RAM) and a third-party plugin that cannot rely on internal server packages.

## 1. Reference projects and what we took from them

| Project | Relevant lesson | What we did not copy |
| --- | --- | --- |
| [Mattermost Plugin Starter Template](https://github.com/mattermost/mattermost-plugin-starter-template) | Plugin layout, plugin API client, HTTP handler conventions, test patterns | The demo channel-status feature was removed. Licensing is Apache-2.0, like this repository. |
| [mattermost-plugin-todo](https://github.com/mattermost-community/mattermost-plugin-todo) | Per-user task records in the plugin KV store, RHS integration, slash command | It issues each user a token and uses an external Todoist API; this plugin has no external service. |
| [mattermost-plugin-demo](https://github.com/mattermost/mattermost-plugin-demo) | Webapp registry API, RHS and post dropdown examples | Demo-only hooks and global state. |
| [mattermost-plugin-playbooks](https://github.com/mattermost/mattermost-plugin-playbooks) | Domain service separated from HTTP handlers, audit records, explicit permissions | Its SQL/`plugin.Driver` storage. The Mattermost `plugin.Driver` SQL API is documented as not backward compatible and intended for Mattermost-owned plugins, so a third-party plugin should not depend on it. |
| [mattermost-plugin-boards](https://github.com/mattermost/mattermost-plugin-boards) | Per-board permissions, indexed queries | Its external database and migration tooling. |

No code was copied from those projects. The implementation follows the public plugin API
(`plugin.API`, `pluginapi.Client`) and the conventions already present in the starter template.

## 2. Components

```
server/
  model/        Task, Bookmark, compact index references, validation, query/compare rules
  store/        KV abstraction + indexed plugin-KV implementation
  access/       one place for team/channel/system permission checks
  tasks/        task use cases, audit records, notifications
  bookmarks/    bookmark use cases and audit records
  api/          REST routing, JSON decoding, error mapping
  command/      /task slash-command fallback (mobile and keyboard users)
  plugin.go     activation, bot, notification worker, HTTP handler wiring
webapp/
  src/
    client.ts   the only module that talks to the plugin API
    types.ts    server-compatible TypeScript types
    state.ts    tiny Redux state for websocket revisions and deep links
    components/ RHS, task list/editor/detail, bookmark list/editor
    index.tsx   registry: RHS, channel header button, post dropdown actions
```

The server is layered so that the same permission and validation code is used by the HTTP API
and the slash command. The webapp never makes authorization decisions; it hides actions only
as a convenience.

## 3. Storage: plugin KV store with derived indexes

### Options considered

1. **One KV record per task, no index.** Simple, but listing My Tasks or a channel would require
   listing every plugin key and reading every task record. `KVList` applies filters after fetching
   a page of keys, so this is a full-table scan with extra round trips. Rejected.
2. **SQL through `plugin.Driver`.** Gives real indexes and transactions, but the driver interface
   is explicitly not covered by Mattermost's compatibility guarantees and is intended for
   Mattermost-owned plugins. It would also require migrations for both Postgres and MySQL, a
   connection pool, and deployment/backup documentation. Too heavy for this MVP and unsafe for a
   third-party plugin. Rejected.
3. **KV records plus derived indexes.** Each write maintains a small number of index records.
   Reads are one record per shard for the requested scope; no key scans. This is the chosen design.

### Keys and records

All keys are namespaced with a short prefix and stay below Mattermost's 150-byte key limit.

| Key | Value |
| --- | --- |
| `task:<id>` | Full task JSON (description included) |
| `task_team:<teamId>:<shard>` | Array of compact `TaskRef`s for all tasks in the team |
| `task_channel:<channelId>:<shard>` | Array of compact `TaskRef`s for channel tasks |
| `task_user:<userId>:<shard>` | Array of compact `TaskRef`s assigned to the user |
| `bookmark:<id>` | Full bookmark JSON |
| `bookmark_team:<teamId>:<shard>` | Array of compact `BookmarkRef`s |
| `bookmark_channel:<channelId>:<shard>` | Array of compact `BookmarkRef`s |

`shard = FNV-1a(task ID) % 4`. Four shards bound the size of each JSON value and spread
compare-and-swap contention. A list request performs four KV reads instead of one, which is
cheaper than fetching every task in the scope.

`TaskRef` contains only the fields needed to filter, sort and render a list row: ID, team,
channel, title, status, priority, assignee IDs, due/created/updated timestamps and a version.
It uses one-character JSON keys, because index records are rewritten on mutation and are the
hot data for a 1 vCPU deployment. Descriptions and other large fields stay in the full record.
A list request therefore returns summaries without an N+1 read for every row; opening a task
fetches the full record.

`BookmarkRef` contains ID, scope, URL, title, tags, creator, source post, timestamps and version.
It is enough to render and search bookmark lists and to link back to the source post; the full
record (description) is fetched for the editor.

### Consistency and concurrency

- Full records are updated with compare-and-swap (task/bookmark version is stored in the record).
  A per-ID striped mutex on the node also serializes a record's write and its index maintenance.
- Index records are updated with `KVSetAtomicWithRetries`. Upserts compare the stored ref's
  version and never overwrite a newer ref with an older one.
- Index maintenance is idempotent: remove-then-add for scope changes, upsert otherwise.
- Indexes are derived data. If a list ever sees a ref whose full record has been deleted, the
  row is skipped. Index writes that fail return an error so the caller can retry; the full
  record remains the source of truth.
- On a multi-node cluster each node applies CAS writes; the in-process lock only makes the common
  single-node case cheaper. Index upserts use the version guard, so the newest write wins.

### Limits and scaling path

The design is intended for the MVP scale of tens of thousands of tasks per scope. Because a list
reads the whole scope index, a very large scope (roughly >10k tasks) will cost more CPU and
memory per request. The indexes are deliberately shaped like a normalized table; if that limit is
reached, the store interface can be backed by SQL (with `(team_id, created_at)`,
`(channel_id, status)`, and `(assignee_id, status)` indexes) without changing the service or API
layers. This is documented rather than hidden.

The store uses no background compaction, no per-request goroutine fan-out and no in-memory cache
of user data, so an idle plugin uses almost no CPU and little memory. Team/channel metadata and
permission checks are delegated to the Mattermost server's existing caches.

## 4. Permissions

All checks are server-side and always use the authenticated `Mattermost-User-ID`; user IDs in
request bodies are only data, never the actor.

Definitions:

- **Scope access**: team-level tasks require `read_channel`-equivalent access to the team
  (`PermissionViewTeam`); channel tasks require `PermissionReadChannel` on the channel.
  A channel task must be in an open or private channel of the task's team. DMs and group
  messages are not valid task scopes.
- **View**: the actor has scope access and is not relying on assignment alone. Assignment never
  grants access to a private channel.
- **Status updates**: the actor is an assignee, the creator, or a system administrator, and still
  has scope access.
- **Metadata, assignee and delete**: the creator or a system administrator, and still has scope
  access. Moving a task to another scope additionally requires access to the new scope.
- **Create**: the actor has access to the requested scope. Every assignee must be eligible in that
  scope (channel read access for channel tasks, team view access for team tasks).
- **Bookmarks**: same scope rules. The creator or a system administrator may edit or delete;
  any user with scope access may read and create.

These rules are implemented in `server/access` and `server/tasks` and are reused by the REST API
and slash commands. Denied attempts and successful state changes are written to the audit log with
IDs only, never titles, descriptions or URLs.

## 5. REST API

All authenticated routes are under `/plugins/<plugin-id>/api/v1` and require a Mattermost session.
State changes use POST/PATCH/DELETE so the server's CSRF protection applies. The API is described
in [API.md](API.md).

## 6. Webapp integration

- RHS sidebar registered with `registerRightHandSidebarComponent`, opened from a channel header
  button.
- One RHS with a Tasks/Bookmarks switch, and My/Team/Channel/All task scopes. The scope defaults to
  the current channel when creating from the channel.
- Task editor is an inline Compass-styled overlay inside the RHS (the host does not expose a
  stable plugin modal API in 11.7). It traps focus and closes on Escape.
- Post dropdown menu actions: "Create task" and "Save URL as bookmark". They read the post from
  the host Redux store, prefill the dialog, and send only IDs to the server. The server re-checks
  the post's channel and the actor's permission.
- WebSocket events (`custom_<plugin-id>_changed`) carry only IDs and scope; the client refetches
  the visible list. Payloads never include task content.
- A `#task-<id>` hash on a Mattermost channel/team URL opens the RHS and loads that task, so
  notification links are real deep links in the web/desktop client. Mobile has no plugin webapp
  support, hence the `/task` slash command fallback.

## 7. Notifications

A bot account is created with `EnsureBot` on activation. On task creation or when assignees are
added, a bounded single-worker queue sends one direct message per newly added assignee (never one
per reassignment of the same user, so no duplicates). The message contains the task title, team
and channel names, due date, priority, and a link to the channel with `#task-<id>`. The queue is
non-blocking for the API; if it is full, the notification is logged and dropped rather than
delaying the task write. Notifications can be disabled in the plugin settings.

## 8. Failure model and known limitations

- The plugin API has no multi-key transactions. Index updates are best-effort after the full
  record write; stale refs are skipped or repaired by the next write of that record.
- The RHS does not support dragging or subtasks yet. `parentTaskId` is in the model and API to
  reserve the field.
- Mobile clients do not load plugin webapps; task and bookmark operations are available through
  `/task` slash commands.
- Bookmark metadata is never fetched from the remote URL, so there is no SSRF surface.
- No due-date reminder scheduler is included in the MVP (the assignment notification is the only
  notification), matching the prompt's optional scope.
