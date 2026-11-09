# Tasks for Mattermost

Todoist-style tasks that live inside Mattermost teams, channels and posts. No separate identity
system, no external service, no second database.

**Mattermost 11.7+** · Go server · React/TypeScript webapp

[Features](#features) · [UI previews](#ui-previews) · [Install](#install) · [Usage](#usage) · [Permissions](#permissions) · [Development](#development)

![Tasks board in the right-hand sidebar](docs/images/tasks-board.png)

<sub>UI preview (illustrative mockup): list/board views in the channel right-hand sidebar.</sub>

## Features

| Plan and see work | Capture it quickly |
| --- | --- |
| My tasks, Team, Channel and All scopes | Create from any public/private channel post |
| List and Kanban board views | Name-only quick add in each board column |
| Todo / In progress / Done with drag-and-drop | Assignment notifications from a plugin bot |
| Filters, sorting and pagination | `/task` slash commands for keyboard and mobile |
| Markdown descriptions and source backlinks | Hover selection and click-to-open cards |

**Due dates the way you expect:** a date is date-only by default. Open the calendar, choose a day,
and press **OK**. Enable **Set time** only when you need a time.

**Safe by construction:** every route re-checks Mattermost team/channel permissions on the server.
Private-channel tasks are filtered from lists and return 404 to non-members. The plugin never
fetches URLs and stores everything in the plugin KV store.

## UI previews

### Board view

Drag cards between Todo, In progress and Done (shown in the hero image above). Each column has a
**+** for GitHub-Projects-style quick capture; card names are headlines and clicking a card shows
its Markdown description.

### List view

Hover a card to highlight it, then click anywhere on the card to open the task detail. Checkboxes,
status pills and filters keep routine updates to one click.

![Task list with filters, status pills and hover selection](docs/images/tasks-list.png)

### Due date

The calendar commits only when you press **OK**. **Clear** removes the due date. Time is optional:
leave **Set time** off for a date-only due date.

![Task editor with the due-date calendar](docs/images/due-date.png)

<sub>UI previews are generated illustrative mockups, not screenshots of a running server. The
generator is in [`docs/images/generate_mockups.py`](docs/images/generate_mockups.py).</sub>

## Install

1. Download `com.github.3tty0n.mattermost-tasks-*.tar.gz` from a release.
2. In Mattermost, open **System Console → Plugins → Plugin Management**.
3. Upload the bundle and enable **Tasks**.
4. Optional: disable assignment notifications in the plugin settings.

The plugin has no external service or separate database. Task data lives in the Mattermost
database's plugin KV store.

**Requirements:** Mattermost 11.7.0+ (web or desktop client). Mobile clients do not load plugin
webapps; use the `/task` slash command there.

## Usage

### Tasks sidebar

Click the check-circle icon in the channel header to open the Tasks sidebar.

- **Scopes:** My tasks, Team, Channel, All. Creating a task from a channel defaults it to that
  channel.
- **Views:** switch between List and Board with the header icons. The board fetches up to 100
  cards; narrow the filters to see more.
- **Quick add:** the **+** at the top right of each board column creates a task in that column
  using only its name.
- **Open a task:** click a card. Board cards open a description popup with an **Open task**
  action; list cards open the full detail view.
- **Due date:** click the due property, pick a day, then **OK**. Turn on **Set time** to include a
  time; leave it off for a date-only task.
- **Filters:** status (list view), priority, assignee and due date; sort by due date, creation date
  or priority.

### Tasks from posts

Every post in a public or private channel has **Create task** in its **⋯** menu. The editor is
prefilled with the post's first line, full message and channel. The task keeps a source backlink;
the server re-checks the post's channel and the user's read permission.

### Slash commands

```text
/task list
/task show <id>
/task create <title>
/task done <id>
```

## Permissions

| Operation | Who |
| --- | --- |
| View | Members who can read the task's team or channel |
| Create | Members who can read the scope; post tasks require channel read access |
| Edit metadata | Creator or system administrator, with current scope access |
| Change status | Creator, assignee or system administrator |
| Delete | Creator or system administrator |

Assignment never grants access to a private channel. Hiding UI is not a permission check; the
server enforces each rule on every request.

## Development

Requirements: Go 1.26+, Node.js 22+, npm, Docker for integration tests.

```bash
make apply                  # generate manifests from plugin.json
make test                   # server + webapp tests and the bundle
SKIP_DOCKER_TESTS=1 go test ./server/...
cd webapp && npx jest --runInBand
```

The bundle is written to `dist/com.github.3tty0n.mattermost-tasks-<version>.tar.gz`.

## Architecture and storage

- Full records: `task:<id>`.
- Compact indexes: `task_team:`, `task_channel:`, `task_user:` (four shards each).
- No full KV scans: a list reads at most four shards per scope.
- No outbound HTTP; the webapp uses the host's Compass components and local selectors.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/API.md](docs/API.md) and
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Related app

Bookmarks is a separate plugin with its own repository, RHS panel and link icon:
[mattermost-bookmarks](https://github.com/3tty0n/mattermost-bookmarks).
