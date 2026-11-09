# HTTP API

All routes are below:

```
<SiteURL>/plugins/com.github.3tty0n.mattermost-tasks/api/v1
```

Authentication is the normal Mattermost session cookie. The server adds `Mattermost-User-ID`
after authenticating; the plugin rejects requests without it. Non-GET requests also require the
`X-CSRF-Token` header (the webapp reads `MMCSRF`).

Errors are JSON `{"error":"..."}`. Validation errors return 400, missing or inaccessible records
404, permission failures 403, compare-and-swap conflicts 409, and unexpected failures 500. All
responses set `Cache-Control: no-store` because task titles and descriptions are private data.

## List tasks

`GET /tasks?scope=my|team|channel|all&team_id=...&channel_id=...&status=todo,in_progress&assignee_id=...&priority=...&due_before=...&due_after=...&has_due=true&sort=due|created|priority&direction=asc|desc&page=0&per_page=20`

- `scope=my` returns tasks assigned to the actor.
- `scope=team` requires `team_id` and is the single view used by the webapp. It includes
  team/channel tasks the actor can read plus the actor's own private tasks in that team.
- `scope=channel` requires `channel_id`.
- `scope=all` returns every task in teams the user can access.
- `status` is a comma-separated list of `todo`, `in_progress`, `done`.
- `sort` is `manual`, `due`, `created` or `priority`; defaults to `manual`. `direction` defaults
  to `asc`. Manual order uses the persisted `position`, falling back to creation time for older
  tasks.
- `per_page` defaults to 30 and is capped at 100.

Response:

```json
{
  "items": [
    {
      "id": "26characterid",
      "teamId": "teamid",
      "channelId": "channelid",
      "visibility": "channel",
      "creatorId": "creatorid",
      "title": "Ship the release",
      "status": "todo",
      "priority": "high",
      "assigneeIds": ["userid"],
      "dueAt": 1767225600000,
      "dueHasTime": false,
      "position": 1700000000000,
      "createdAt": 1700000000000,
      "updatedAt": 1700000000000
    }
  ],
  "total": 1,
  "page": 0,
  "perPage": 20,
  "hasMore": false
}
```

`visibility` is `private`, `team` or `channel`. A private task is only returned to its creator;
team tasks to team members; channel tasks to channel members. `dueHasTime` absent or false means
the due value is date-only and the UI must not show a time.

## Create task

`POST /tasks`

```json
{
  "teamId": "teamid",
  "channelId": "channelid",
  "title": "Ship the release",
  "description": "Optional **Markdown** text",
  "visibility": "team",
  "assigneeIds": ["userid"],
  "status": "todo",
  "priority": "high",
  "dueAt": 1767225600000,
  "dueHasTime": false,
  "sourcePostId": "optionalpostid"
}
```

`teamId` or `channelId` selects the scope; when `channelId` is present the server derives the team
and rejects a mismatched `teamId`. `visibility` defaults from the scope (channel when a channel is
present, team otherwise):
- `private`: only the creator can read it; the server forces `assigneeIds` to the creator and
  ignores `channelId`.
- `team`: every member of `teamId` can read it; `channelId` is cleared.
- `channel`: only members of `channelId` can read it; a channel is required.

`dueHasTime: true` requires a non-zero `dueAt`. A source post must be in an accessible
public/private channel and is always channel-visible.

Returns 201 with the full task.

## Get task

`GET /tasks/{id}`

Returns the full task, including `description`, `visibility`, `creatorId`, `version` and
`completedAt`. Non-members of a private channel receive 404; private tasks return 404 to everyone
except their creator.

## Update task

`PATCH /tasks/{id}` or `POST /tasks/{id}`

The POST alias exists because some reverse proxies reject PATCH. The body accepts any subset of:

```json
{
  "teamId": "teamid",
  "channelId": "channelid",
  "title": "New title",
  "description": "New description",
  "visibility": "channel",
  "assigneeIds": ["userid"],
  "status": "in_progress",
  "priority": "urgent",
  "dueAt": 1767225600000,
  "dueHasTime": true,
  "position": 1700000000000,
  "sourcePostId": "postid"
}
```

An empty object is rejected. Set `dueAt` to `0` to clear the due date; clearing also resets
`dueHasTime`. Changing `visibility` follows the same rules as create: private tasks must have only
the creator as assignee, team tasks have no channel, channel tasks require a channel, and a task
with a source post must remain channel-visible.

Metadata edits require the creator or a system administrator with current scope access. Status
changes are allowed for the creator, an assignee or a system administrator. A `position`-only
change is allowed for any user who can view the task, because manual order is shared within the
scope. Private tasks are editable only by their creator. A status/position-only body skips the
metadata checks but still checks scope access. Positions are non-negative numbers; clients
normally use the midpoint between neighboring task positions.

Returns 200 with the updated full task.

## Delete task

`DELETE /tasks/{id}`

Requires the creator or a system administrator. Returns 204. The record and its index entries are
removed.

## Assignees

`GET /assignees?team_id=...&channel_id=...&q=...`

Returns users who can be assigned in the scope. With no query, it lists the first 50 members of the
channel/team. With `q`, Mattermost user search matches username, first name, last name and
nickname; if that search returns no hits, the handler falls back to the first page of scope
members and matches every token against those fields. Avatars are loaded separately through the
Mattermost users API.

## WebSocket

The server publishes `custom_com.github.3tty0n.mattermost-tasks_changed` to the task's channel (or
team for a team-level task) after create/update/delete. The payload contains the entity name,
action, task ID, team ID and channel ID; it never contains the title or description.
