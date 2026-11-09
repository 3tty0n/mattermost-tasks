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
- `scope=team` requires `team_id`.
- `scope=channel` requires `channel_id`.
- `scope=all` returns every task in teams the user can access.
- `status` is a comma-separated list of `todo`, `in_progress`, `done`.
- `sort` defaults to `due`; `direction` defaults to `asc`.
- `per_page` defaults to 30 and is capped at 100.

Response:

```json
{
  "items": [
    {
      "id": "26characterid",
      "teamId": "teamid",
      "channelId": "channelid",
      "title": "Ship the release",
      "status": "todo",
      "priority": "high",
      "assigneeIds": ["userid"],
      "dueAt": 1767225600000,
      "dueHasTime": false,
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

`dueHasTime` absent or false means the due value is date-only and the UI must not show a time.

## Create task

`POST /tasks`

```json
{
  "teamId": "teamid",
  "channelId": "channelid",
  "title": "Ship the release",
  "description": "Optional **Markdown** text",
  "assigneeIds": ["userid"],
  "status": "todo",
  "priority": "high",
  "dueAt": 1767225600000,
  "dueHasTime": false,
  "sourcePostId": "optionalpostid"
}
```

`teamId` or `channelId` selects the scope; when `channelId` is present the server derives the team
and rejects a mismatched `teamId`. `dueHasTime: true` requires a non-zero `dueAt`. A source post
must be in an accessible public/private channel.

Returns 201 with the full task.

## Get task

`GET /tasks/{id}`

Returns the full task, including `description`, `creatorId`, `version` and `completedAt`. Non-members
of a private channel receive 404.

## Update task

`PATCH /tasks/{id}` or `POST /tasks/{id}`

The POST alias exists because some reverse proxies reject PATCH. The body accepts any subset of:

```json
{
  "teamId": "teamid",
  "channelId": "channelid",
  "title": "New title",
  "description": "New description",
  "assigneeIds": ["userid"],
  "status": "in_progress",
  "priority": "urgent",
  "dueAt": 1767225600000,
  "dueHasTime": true,
  "sourcePostId": "postid"
}
```

An empty object is rejected. Set `dueAt` to `0` to clear the due date; clearing also resets
`dueHasTime`. Metadata edits require the creator or a system administrator with current scope
access. Status changes are allowed for the creator, an assignee or a system administrator. A
status-only body skips the metadata checks but still checks scope access.

Returns 200 with the updated full task.

## Delete task

`DELETE /tasks/{id}`

Requires the creator or a system administrator. Returns 204. The record and its index entries are
removed.

## Assignees

`GET /assignees?team_id=...&channel_id=...&q=...`

Returns users who can be assigned in the scope, filtered by the search term. Names and avatars are
loaded separately through the Mattermost users API.

## WebSocket

The server publishes `custom_com.github.3tty0n.mattermost-tasks_changed` to the task's channel (or
team for a team-level task) after create/update/delete. The payload contains the entity name,
action, task ID, team ID and channel ID; it never contains the title or description.
