# Implementation status

- [x] Plugin manifest, KV store, server API and permissions.
- [x] Task model: title, Markdown description, assignees, status, priority, due date, source post.
- [x] Team-level and channel-level tasks; one team-global sidebar view (no scope tabs).
- [x] Per-task visibility: private (creator only), team-wide, or channel members only. Private
      tasks are created explicitly with Only me, or from the user's own DM message.
- [x] List/board RHS with filters, sorting, pagination and status quick-toggle.
- [x] Kanban columns with drag-and-drop, per-column Name-only quick add and description popups.
- [x] Manual ordering in list and board views with persisted positions.
- [x] Due calendar with OK/Clear and optional time (`dueHasTime`).
- [x] Post dropdown **Create task** with source backlink.
- [x] Assignment notifications from the plugin bot.
- [x] `/task` slash commands.
- [x] Markdown rendering through the host's sanitized renderer.
- [x] Unit, integration and webapp tests.

Bookmarks are maintained in the separate
[mattermost-bookmarks](https://github.com/3tty0n/mattermost-bookmarks) repository.
