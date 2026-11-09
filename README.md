# Tasks for Mattermost

A Mattermost plugin for Todoist-style task management inside teams and channels. It uses
Mattermost's existing teams, channels, users, posts and permissions instead of a separate identity
system, and stores everything in the plugin's own KV store.

- Tasks with title, Markdown description, multiple assignees, status, priority, due date and a
  source post.
- Team-level and channel-level tasks.
- My tasks, Team, Channel and All scopes.
- List and Kanban board views (Todo / In progress / Done) with drag-and-drop.
- Names-only quick add in each board column (GitHub Projects style).
- Board description popups, inline status changes and hover/click selection.
- Optional due time: a due date is date-only unless **Set time** is enabled in the calendar.
- Create a task from any public/private channel post.
- Assignment direct messages from a plugin bot.
- Server-side permission checks on every route and operation.
- No external services, no URL fetching and no separate database.

The target server is the oldest supported ESR, **Mattermost 11.7.0**. Web and desktop clients are
supported; mobile clients do not load plugin webapps, so the `/task` slash command is the fallback.

## Installation

1. Download the release bundle (`com.github.3tty0n.mattermost-tasks-*.tar.gz`).
2. In Mattermost, go to **System Console → Plugins → Plugin Management**.
3. Upload the bundle and enable **Tasks**.
4. Optionally turn off assignment notifications in the plugin settings.

There is no external service or separate database to install; the plugin KV store lives in the
Postgres/MySQL database Mattermost already uses. The only setting is the assignment-notification
toggle.

## Usage

### Tasks sidebar

Click the check-circle icon in the channel header to open the Tasks sidebar.

- Four scopes: **My tasks**, **Team**, **Channel** and **All**. The current channel defaults the
  scope of a new task created from a channel.
- Switch between **List** and **Board** with the header icons. The board has Todo, In progress and
  Done columns; drag a card between columns to change its status.
- Each board column has a **+** button at its top right. It opens a Name-only quick-add form that
  creates a task directly in that status and scope.
- Board cards show the task name as a headline. Clicking a card opens a popup with the full
  Markdown description and an **Open task** action. The checkbox and status pill work without
  opening the popup.
- In list view, hovering a card highlights it; click anywhere on the card to open the task.
- Filter by status (list view), priority, assignee or due date; sort by due date, creation date or
  priority.
- The **+** button opens the task editor. It supports title, Markdown description (with preview
  and formatting buttons), team/channel scope, multiple assignees, status, priority and due date.
  The due calendar has explicit **OK** and **Clear** actions. A date alone is saved without a
  time; enable **Set time** in the calendar to save a specific time.

### Tasks from posts

Every post in a public or private channel has **Create task** in its **⋯** menu. The editor opens
prefilled with the post's first line as the title, the full message as the description, and the
post's channel as the scope. The task keeps the source post ID and the detail view links back to
the original post. The server re-checks the post's channel and the user's read permission.

### Slash commands

For keyboards and mobile clients:

```
/task list
/task show <id>
/task create <title>
/task done <id>
```

## Permissions

| Operation | Who |
| --- | --- |
| View tasks | Members who can read the task's team or channel |
| Create in a team/channel | Members who can read that scope; post tasks require channel read access |
| Edit title, description, scope, priority, due date, assignees | Creator or system administrator, with current scope access |
| Change status | Creator, assignee or system administrator |
| Delete | Creator or system administrator |

Assignment never grants access to a private channel. Private-channel tasks are filtered from list
responses and return 404 to non-members, so their existence is not disclosed. Hiding UI is never
the check; the server enforces each rule.

## Development

Requirements: Go 1.26+, Node.js 22+, npm, Docker for integration tests.

```bash
make apply                  # generate manifests from plugin.json
make test                   # server + webapp tests and the bundle
SKIP_DOCKER_TESTS=1 go test ./server/...
cd webapp && npx jest --runInBand
```

The plugin bundle is written to `dist/com.github.3tty0n.mattermost-tasks-<version>.tar.gz`.

## Storage

Tasks are stored under `task:<id>` with compact per-team, per-channel and per-user index shards
(`task_team:`, `task_channel:`, `task_user:`). Lists read the indexes and apply search filters in
memory, so no query depends on a full KV scan. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
and [docs/API.md](docs/API.md).

Bookmarks are a separate app in
[mattermost-bookmarks](https://github.com/3tty0n/mattermost-bookmarks).
