# Tasks & Bookmarks for Mattermost

A Mattermost plugin that adds Todoist-style tasks and URL bookmarks to teams, channels and
posts. It uses Mattermost's existing teams, channels, users, posts and permissions instead of a
separate identity system, and it stores everything in the plugin's own KV store.

- Tasks with title, description, multiple assignees, status, priority, due date and a source post.
- Team-level tasks and channel-level tasks.
- My Tasks, Team Tasks, Channel Tasks and All Accessible Tasks views.
- Quick status changes from the right-hand sidebar.
- URL bookmarks with tags, search, and "Save URL as bookmark" from the post menu.
- Assignment direct messages from a plugin bot.
- Server-side permission checks on every route and operation.
- No external services, no URL fetching, no separate database.

The target server is the oldest supported ESR, **Mattermost 11.7.0**. Web and desktop clients are
supported; mobile clients do not load plugin webapps, so the `/task` slash command is provided as
a fallback.

## Installation

1. Download the release bundle (`com.github.3tty0n.mattermost-tasks-*.tar.gz`).
2. In Mattermost, go to **System Console → Plugins → Plugin Management**.
3. Upload the bundle and enable **Tasks & Bookmarks**.
4. Optionally turn off assignment notifications in the plugin settings.

There is no external service or separate database to install; the plugin KV store lives in the
Postgres/MySQL database Mattermost already uses. The only setting is the assignment-notification
toggle.

## Usage

### Sidebar

Click the check-circle icon in the channel header to open the sidebar.

- **Tasks** has four scopes: **My tasks**, **Team**, **Channel** and **All**. The current channel
  defaults the scope of a new task when one is created from a channel.
- Filter by status, priority, assignee or due date; sort by due date, creation date or priority.
- Click the checkbox to mark a task done, the status pill to cycle status, or the title to open
  details.
- The **+** button opens the task editor. It supports title, description, team/channel scope,
  multiple assignees, status, priority and due date.

### Tasks from posts

Every post in a public or private channel has **Create task** in its **⋯** menu. The editor opens
prefilled with the post's first line as the title, the full message as the description, and the
post's channel as the scope. The task keeps the source post ID and the detail view links back to
the original post. The server re-checks the post's channel and the user's read permission.

### Bookmarks

Switch the sidebar to **Bookmarks**, choose Team, Channel or All, and search by title, URL or tag.

- The **+** button creates a bookmark manually.
- **Save URL as bookmark** in a post's menu detects links in the post. A post with several URLs
  shows a URL picker.
- Titles, descriptions, URLs, tags and scope can be edited; deleting asks for confirmation.
- URLs are never fetched by the server. Only `http`/`https` URLs are accepted and credentials in
  the URL are rejected.

### Slash commands

For keyboards and mobile clients:

```
/task                         Show help
/task list                    Your assigned tasks
/task show <id>               Task details
/task create <title>          Create a task in this channel, assigned to you
/task done <id>               Mark a task done
/task bookmark <url> [title]  Save a bookmark in this channel
```

Slash commands use the same permission checks as the REST API.

### Notification deep links

Assignment DMs contain a normal Mattermost channel/team URL with `#task-<id>`. Opening it opens
the sidebar and loads that task. The link is checked by the server when the task is loaded; the
notification recipient must still have access to the channel.

## Permissions

| Action | Who |
| --- | --- |
| Create in a team | Any user who can view the team |
| Create in a channel | Any user who can read the channel |
| View | Users who can read the task's team (team-level) or channel |
| Change status | Creator, an assignee, or a system administrator, with current scope access |
| Edit title, description, scope, priority, due date, assignees | Creator or system administrator, with current scope access |
| Delete | Creator or system administrator, with current scope access |
| Bookmarks | Same scope rules; creator/admin edit and delete |

Assignment never grants access to a private channel. Private-channel tasks and bookmarks are
filtered out before pagination, and a task ID from another scope returns `404` rather than
confirming that it exists.

## Performance notes

The plugin is designed for a single small Mattermost node (for example 1 vCPU / 512 MB RAM):

- Reads use four compact KV index shards per scope; there is no full-key scan and no N+1 read for
  each task row. List responses are built from the index summaries.
- Index records use short JSON keys and only the fields needed to filter/sort/render. Descriptions
  and other large fields stay in the full record and are fetched only when a task is opened.
- Writes are compare-and-swap, with a per-ID striped lock in the plugin process. Index
  compare-and-swap means a stale writer can not overwrite a newer ref.
- No idle cron jobs, no background polling, no in-memory cache of user content. The notification
  worker has one goroutine and a 64-item bounded queue, and drops (with a log line) rather than
  delaying the API when full.
- The plugin webapp keeps Redux state small: change events carry IDs only and trigger a refetch of
  the visible list.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the storage design, limits, and the path to
SQL if a single scope outgrows the index. Deployment and backup notes are in
[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). The REST API is documented in [docs/API.md](docs/API.md).

## Development

Requirements: Go 1.26+, Node 24+, Docker (only for the integration tests).

```bash
make apply                  # generate server/manifest.go and webapp/src/manifest.ts
make server webapp          # build the plugin binary and webapp bundle
make dist                   # create dist/<plugin-id>-<version>.tar.gz
make deploy                 # build, bundle and install into a local Mattermost via pluginctl
```

Tests:

```bash
GOMODCACHE=$PWD/.gomodcache GOCACHE=$PWD/.gocache go test -race ./server/...
cd webapp && NODE_ENV=test npm test
cd webapp && npm run lint && npm run check-types
SKIP_DOCKER_TESTS=1 go test ./server/...   # unit tests only, skips testcontainers
```

The integration tests in `server/api/integration_test.go` use the Mattermost test helper, which
starts Postgres and Mattermost with testcontainers and deploys the bundle from `dist/`. Set
`SKIP_DOCKER_TESTS=1` to skip them when Docker is not available. `make test` builds the bundle and
runs both test suites; `MM_TEST_IMAGE` selects the server image used by the integration tests.

These tests were run against a live Mattermost 11.7.0 container for task/bookmark CRUD,
private-channel isolation, persistence across a plugin restart, and assignment DM delivery. The webapp has
component tests and a production bundle build, but no browser automation was available, so
browser-level UI behavior is the remaining unverified area.

## Repository layout

```
server/model        persisted records, compact refs, validation, query rules
server/store        plugin-KV store + four-shard indexes + in-memory KV for tests
server/access       one place for team/channel/system permission checks
server/tasks        task use cases, audit, notifications
server/bookmarks    bookmark use cases
server/api          REST routes and error mapping
server/command      /task slash command
server/notifications bounded bot DM worker
webapp/src          React/TypeScript RHS, editors, post actions, deep links
docs/               architecture, implementation plan, API, deployment
```

## License

This repository keeps the license of the Mattermost plugin starter template. See [LICENSE](LICENSE).
