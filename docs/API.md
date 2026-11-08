# API reference

All routes live under the Mattermost plugin namespace:

```
<SiteURL>/plugins/com.github.3tty0n.mattermost-tasks/api/v1
```

Requests are authenticated by the Mattermost server. The plugin takes the acting user only from
the `Mattermost-User-ID` header that the server sets after validating the session; it never trusts
a user ID in a body, query or path. State-changing requests use POST, PATCH or DELETE, so the
server's CSRF protection applies. Every route is available to signed-in users and enforces
record and scope permissions itself.

Errors have one shape:

```json
{"error": "A message that is safe to show to the user"}
```

| Status | Meaning |
| --- | --- |
| 400 | Invalid input; the message explains which field is wrong |
| 401 | No Mattermost session |
| 403 | The session user may not do that in this scope |
| 404 | The record does not exist, or the user must not learn that it exists |
| 409 | A compare-and-swap conflict; retry the request |
| 500 | Internal failure; details are logged, never returned |

The request body is limited to 256 KiB. Page sizes are capped at 100 (default 30).

## Tasks

### `GET /tasks`

Lists task summaries. The list is filtered before it is paginated, so `total` is the number of
matching tasks the user may see.

| Query | Values | Notes |
| --- | --- | --- |
| `scope` | `my` (default), `team`, `channel`, `all` | `my` uses the assignee index; `all` merges the user's accessible teams |
| `team_id` | Mattermost team ID | Required for `scope=team` |
| `channel_id` | Mattermost channel ID | Required for `scope=channel` |
| `status` | `todo,in_progress,done` | Comma-separated; repeats allowed |
| `assignee_id` | Mattermost user ID | |
| `priority` | `none,low,normal,high,urgent` | |
| `due_before` | epoch milliseconds | Strictly before; tasks without a due date are excluded |
| `due_after` | epoch milliseconds | Strictly after; tasks without a due date are excluded |
| `has_due` | `true`, `false` | |
| `sort` | `due` (default), `created`, `priority` | |
| `direction` | `asc` (default), `desc` | Tasks without a due date sort last |
| `page` | integer, default 0 | |
| `per_page` | 1–100, default 30 | |

Response:

```json
{
  "items": [
    {
      "id": "…",
      "teamId": "…",
      "channelId": "…",
      "title": "Ship the release",
      "status": "todo",
      "priority": "high",
      "assigneeIds": ["…"],
      "dueAt": 1760000000000,
      "createdAt": 1750000000000,
      "updatedAt": 1750000000000
    }
  ],
  "total": 1,
  "page": 0,
  "perPage": 30,
  "hasMore": false
}
```

### `POST /tasks`

```json
{
  "teamId": "…",
  "channelId": "…",
  "title": "Ship the release",
  "description": "Optional Markdown-free text",
  "assigneeIds": ["…"],
  "status": "todo",
  "priority": "high",
  "dueAt": 1760000000000,
  "sourcePostId": "…",
  "parentTaskId": "…"
}
```

- `teamId` is optional when `channelId` is present; the server derives the team from the channel.
- A missing `channelId` creates a team-level task.
- A source post must be in the task's channel and readable by the acting user.
- `assigneeIds` is de-duplicated and every assignee must be able to read the scope.
- Returns `201` with the full task.

### `GET /tasks/{id}`

Returns the full task, including `description`, `creatorId`, `sourcePostId`, `completedAt` and
`version`. `404` is returned both for a missing task and for a task in a scope the user can not
read.

### `PATCH /tasks/{id}`

Any subset of the create fields. A `null`/omitted field is unchanged. Send `"channelId": ""` to
turn a channel task into a team-level task, and `"dueAt": 0` to clear the due date.

Permissions:

| Change | Who |
| --- | --- |
| `status` only | creator, assignee, or system administrator with scope access |
| title, description, scope, priority, due date, assignees | creator or system administrator with scope access |

Status changes maintain `completedAt`. Moving a task validates that all retained assignees can
read the new scope, and a task created from a post can not move away from that post's channel.
Newly added assignees are notified once; re-sending the same list does not notify again.

### `DELETE /tasks/{id}`

Creator or system administrator, with current scope access. Returns `204`.

### `GET /assignees`

Returns eligible assignees for a scope. The caller must be able to read the scope.

| Query | Notes |
| --- | --- |
| `team_id` | Team-level eligible users |
| `channel_id` | Channel-level eligible users; takes precedence |
| `q` | Optional search term, at most 100 characters |

Returns up to 50 users:

```json
[{"id": "…", "username": "alice", "firstName": "Alice", "lastName": "Smith", "lastPictureUpdate": 0}]
```

Deleted users and bots are excluded.

## Bookmarks

Bookmarks use the same team/channel permission model. They are never fetched from the remote URL,
so creating one does not make the server contact an external host.

### `GET /bookmarks`

| Query | Values | Notes |
| --- | --- | --- |
| `scope` | `team`, `channel`, `all` | Required unless defaults are adequate |
| `team_id` | team ID | Required for `scope=team` |
| `channel_id` | channel ID | Required for `scope=channel` |
| `q` | string, max 200 | Case-insensitive title, URL and tag search |
| `tag` | string | Exact, case-insensitive tag match |
| `page` | integer | |
| `per_page` | 1–100 | |

Items are bookmark summaries (`id`, `teamId`, `channelId`, `url`, `title`, `tags`,
`creatorId`, `sourcePostId`, timestamps), newest first.

### `POST /bookmarks`

```json
{
  "teamId": "…",
  "channelId": "…",
  "url": "https://example.com/docs",
  "title": "Docs",
  "description": "Optional",
  "tags": ["work", "docs"],
  "sourcePostId": "…"
}
```

Only `http` and `https` URLs are accepted, credentials in the URL are rejected, the URL is limited
to 2,048 bytes, titles to 200 characters, descriptions to 8,000 characters, and tags to 20 items
of 50 characters each. Returns `201` with the full bookmark.

### `GET /bookmarks/{id}`

Returns the full bookmark, including `description`. `404` for a bookmark in a scope the user can
not read.

### `PATCH /bookmarks/{id}`

Any subset of the create fields. Creator or system administrator with scope access.

### `DELETE /bookmarks/{id}`

Creator or system administrator with scope access. Returns `204`.

## WebSocket events

The server publishes `custom_com.github.3tty0n.mattermost-tasks_changed` to the task's channel
(when it has one) or team. The payload carries IDs only:

```json
{"entity": "task", "action": "updated", "taskId": "…", "teamId": "…", "channelId": "…"}
```

Bookmark events use `"entity": "bookmark"` and `bookmarkId`. The webapp refetches its visible
list; it never receives task titles or bookmark URLs through the event.
