# Architecture

This document records the architecture decisions for the Tasks plugin. It is deliberately biased
toward a small Mattermost deployment (one app node, 1 vCPU, 512 MB RAM) and a third-party plugin
that cannot rely on internal server packages.

## Reference projects

| Project | Relevant lesson | What we did not copy |
| --- | --- | --- |
| [Mattermost Plugin Starter Template](https://github.com/mattermost/mattermost-plugin-starter-template) | Plugin layout, plugin API client, HTTP handler conventions, test patterns | The demo channel-status feature was removed. Licensing is Apache-2.0, like this repository. |
| [mattermost-plugin-todo](https://github.com/mattermost-community/mattermost-plugin-todo) | Per-user task records in the plugin KV store, RHS integration, slash command | It issues each user a token and uses an external Todoist API; this plugin has no external service. |
| [mattermost-plugin-boards](https://github.com/mattermost/mattermost-plugin-boards) | Per-board permissions, indexed queries | Its external database and migration tooling. |

No code was copied from those projects. The implementation follows the public plugin API
(`plugin.API`, `pluginapi.Client`) and the conventions already present in the starter template.

## Components

```
server/
  model/        Task + visibility, compact index references, validation/query rules
  store/        KV abstraction + visibility-aware indexed plugin-KV implementation
  access/       one place for team/channel/system permission checks
  tasks/        task use cases and audit records
  api/          REST routing, JSON decoding, error mapping
  command/      /task slash-command fallback
  notifications/ assignment DM worker
  events/       WebSocket change events (IDs only)
  testutil/     shared test API wrapper
webapp/
  src/          RHS panel, list/board, editor, detail and local selectors
```

The plugin has one RHS, one channel header button and one post dropdown action.

## Storage model

- Full record: `task:<id>` (JSON). It includes the Markdown description, assignees, status,
  priority, visibility, due timestamp, optional `dueHasTime` flag, source post and a
  compare-and-swap version.
- Visibility is `private`, `team` or `channel`. Private tasks are not written to the team or
  channel indexes and are always assigned to their creator; team tasks go to the team index;
  channel tasks go to both the team and channel indexes and are filtered by channel permission in
  team views. All tasks are in the assignee index, which also powers the Mine scope.
- Index reference: `task_team:<teamID>:<shard>`, `task_channel:<channelID>:<shard>` and
  `task_user:<userID>:<shard>`.
- `shard = fnv32a(taskID) % 4`. Four shards keep each index value small and reduce CAS contention.
- References contain only fields needed by the list: ID, team/channel, title, status, priority,
  due timestamp and flag, creator, assignees, timestamps and version. They omit the description.
- Concurrent updates use `CompareAndSet` retries plus in-process striped locks. Index updates use
  `KV.Update` and are skipped when only non-indexed fields change.
- A task with no due time sets `dueHasTime=false` and stores the due date at local midnight. The
  UI displays only the date in that case; notifications and the slash command do the same.

Search/filtering is applied after reading the index shards for the requested scope. This is
bounded by the number of tasks in that team/channel/user and avoids a separate search index. The
maximum page size is 100.

## Permissions

Every route resolves the actor from the `Mattermost-User-ID` header, which the Mattermost server
sets after authenticating the session. The plugin then checks `PermissionViewTeam` or
`PermissionReadChannel` on the current scope, and re-checks the source post's channel when creating
from a post. Private-channel tasks are filtered from lists and return 404 to non-members.

The creator or a system administrator may edit task metadata. The creator, an assignee or a
system administrator may change status. Delete is limited to the creator or a system
administrator. A private task is readable and editable only by its creator, even for a system
administrator. Assignment never grants access to a private channel.

## Webapp

- `registerRightHandSidebarComponent` provides the Tasks panel and the check-circle channel header
  button.
- `registerPostDropdownMenuAction` adds **Create task** for public/private channel posts. On the
  actor's own DM message it opens a private task instead of a channel-visible one; DM tasks have no
  source backlink.
- The sidebar switches between **Team** and **Mine** at the top. A channel opens on Team and a DM
  on Mine. The team query returns readable team/channel tasks and events plus the actor's own
  private items; Mine collects tasks assigned to the actor and events created by the actor.
- Events are a separate aggregate (`event:` records and `event_team:` / `event_channel:` /
  `event_user:` indexes) with the same visibility and access rules as tasks. They have start/end
  times, an all-day flag and no status, priority or completion. The calendar fetches tasks and
  events separately for the same range and merges them on the client. In the UI, events use an
  accent-bordered card with a time range and task cards keep priority/assignee metadata; month
  cells show tasks as dots and events as bars.
- The list and board share one query; the calendar queries a due-date range for the visible week or
  month. The board and calendar fetch up to 100 tasks and ask the user to narrow filters beyond
  that. Manual order is a float `position`; drops use the midpoint between the neighboring tasks,
  and old tasks without a position fall back to creation time.
- The task detail view edits visibility, team, channel, assignees and the due date inline;
  source-post tasks keep their fixed scope. The due-date control reuses the New task calendar
  picker. There is no separate full-edit modal from the detail view.
- The due calendar commits only on **OK**. Time is off by default and only a date is stored unless
  the user enables **Set time**. Recurrence stores a frequency, interval, stable start date,
  optional end date and IANA timezone in both the task and its compact ref. The calendar asks for
  recurrence-overlapping tasks and expands them into occurrences for the visible days.
- Completing a recurring task advances `dueAt` on the server to the next occurrence; the series
  keeps its original start date for month-end and leap-day clamping. The calendar shows the
  current and future occurrences only, so completed dates do not reappear.
- The webapp uses the host's Redux store and local selectors rather than bundling Mattermost
  redux. CSRF uses the `MMCSRF` cookie and `X-CSRF-Token` header; requests include credentials.
- WebSocket `custom_<plugin-id>_changed` and reconnect events bump a revision counter that
  refetches the visible list.
- All user content is rendered through React or the host's sanitized Markdown renderer.

## Slash command

`/task list|show|create|done` is a keyboard/mobile fallback. It uses the same service and
permission checks as HTTP; it is not a second implementation.

## Notifications

A plugin bot (`tasks-bot`) sends direct messages to newly assigned users. The worker is bounded,
closes during deactivation and does not block task creation on delivery. A missing bot disables
notifications but leaves tasks working.

## Performance

- No full KV scans: each list reads at most `4` shards per requested index. A calendar range
  performs one task query and one event query.
- The list response is bounded to 100 per page; the webapp loads 20 by default.
- No outbound HTTP.
- Release builds use `-trimpath -ldflags "-s -w -buildid="`. The default bundle contains only a
  linux-amd64 binary; darwin-amd64 and darwin-arm64 are added only when the release workflow is
  explicitly dispatched with `macos=true`.
- The webapp bundle uses Compass components already loaded by the host and avoids mattermost-redux.

## Limitations

- Mobile clients do not load plugin webapps; use the slash command.
- Full-page task boards are not provided; the board lives in the RHS.
- Events are currently one-off; event recurrence and attendees are not implemented yet.
- Subtasks are not exposed in the UI yet. `parentTaskId` is reserved.
- Bookmarks are a separate app in `mattermost-bookmarks`.
