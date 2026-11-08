# Deployment and operations

## Requirements

- Mattermost 11.7.0 or newer (the plugin manifest pins this minimum).
- The plugin webapp is for web and desktop clients. Mobile clients do not load plugin webapps;
  use the `/task` slash commands.
- No external database, object store, network egress or cron service.

## Install and upgrade

Build a bundle with `make dist` (or download a release), upload the `.tar.gz` in **System Console →
Plugins → Plugin Management**, and enable it. Upgrading is the same upload flow; the plugin ID and
KV keys are unchanged across the 0.x releases.

The plugin becomes active on every cluster node that runs the plugin. Task and bookmark records
and indexes live in the Mattermost plugin KV store, so they are shared by all nodes. The
in-process write lock described in `ARCHITECTURE.md` is a performance optimization for the common
single-node case; compare-and-swap and ref-version checks keep concurrent cluster writes safe.

## Backup and restore

Everything is in Mattermost's own database:

- Full records: `PluginKeyValueStore` rows for the plugin ID with keys beginning `task:` and
  `bookmark:`.
- Derived indexes: rows with keys beginning `task_team:`, `task_channel:`, `task_user:`,
  `bookmark_team:` and `bookmark_channel:`.

Back up Mattermost's database normally. There is no separate plugin backup file. To restore,
restore the database (or the plugin's KV rows) before the plugin is re-enabled. If you restore only
full records and not indexes, lists will be incomplete until the records are written again; this
is why a database-level backup is recommended over copying individual keys.

The plugin has no migrations and no schema of its own. A downgrade keeps the records; older
versions of this plugin may not understand fields added later, so back up before changing versions.

## Resource footprint

- Plugin process: the Go server uses the Mattermost plugin process; it does not start a separate
  daemon.
- Idle CPU: no scheduled jobs, polling loops or reconnect work. Only user requests and assignment
  notifications do work.
- Notification delivery: one goroutine and a bounded 64-item queue. When the queue is full the
  notification is logged and dropped instead of delaying a task write.
- Read path: four KV reads per task/bookmark list scope, plus per-channel permission checks
  memoized for that request. Opening a task fetches the full record.
- Write path: one full-record CAS write and a small number of index CAS writes (team, channel and
  each changed assignee). A change that does not touch index fields, such as editing a description,
  writes only the full record.

At roughly more than 10,000 tasks in one team/channel/user scope, list requests start to pay for
reading the whole scope index. The service/store boundary is designed so the KV implementation
can be replaced by a SQL implementation with `(team_id, created_at)`,
`(channel_id, status)` and `(assignee_id, status)` indexes without changing the API or webapp.
This is a deliberate MVP limit, not a hidden scan: only the requested scope's four shards are read.

## Scaling knobs

- Assignment notifications can be disabled per installation in the plugin settings.
- The REST API caps page sizes at 100 and request bodies at 256 KiB.
- `maxIndexEntries` is not needed at MVP scale; if a deployment expects six-figure record counts
  per scope, add SQL storage or time-bucket the index before enabling it.

## Observability

The plugin writes normal Mattermost plugin logs for HTTP failures, index maintenance failures and
notification problems. It writes audit records for task/bookmark create, update and delete,
including denied attempts, with IDs only (never titles, descriptions or URLs). Audit records are
available wherever the Mattermost audit log is configured.
