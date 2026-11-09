# Deployment

## Requirements

- Mattermost 11.7.0 or newer.
- No external database or service. The plugin uses the Mattermost plugin KV store.
- No special outbound network access.

## Install

1. Build or download the bundle: `dist/com.github.3tty0n.mattermost-tasks-<version>.tar.gz`.
2. **System Console → Plugins → Plugin Management → Upload Plugin**.
3. Enable **Tasks**.
4. Optionally disable assignment notifications in the plugin settings.

## Upgrade

Upload the new bundle and enable it. Task records and indexes are stored under the plugin ID; no
database migration is required. Restarting the plugin or Mattermost does not clear data.

## Rollback

Disable the plugin. Data remains in the plugin KV store. Re-enabling the same or a newer bundle
continues to use it.

## Backup

Tasks live in the Mattermost database's plugin KV table. Use the normal Mattermost database backup
procedure; there is no separate volume or file store.

## Resource use

The plugin has one RHS, one notification worker and no outbound calls. List requests read up to
four index shards per scope, making it suitable for a 1 vCPU / 512 MB app node.
