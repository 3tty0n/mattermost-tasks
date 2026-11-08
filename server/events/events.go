// Package events publishes the plugin's WebSocket change notifications. Payloads carry IDs only:
// every recipient of a WebSocket event can read its payload, so task titles and bookmark URLs
// never leave the server this way.
package events

import (
	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/pluginapi"

	taskmodel "github.com/3tty0n/mattermost-tasks/server/model"
)

// Event is the name the webapp registers as custom_<plugin-id>_changed.
const Event = "changed"

// Publisher sends change events to the affected Mattermost scope.
type Publisher struct {
	client *pluginapi.Client
}

// New returns a Publisher backed by the plugin API.
func New(client *pluginapi.Client) *Publisher {
	return &Publisher{client: client}
}

// TaskChanged notifies the task's channel or team. Channel broadcasts reach every member of the
// channel, which is exactly the set of users allowed to see the task.
func (p *Publisher) TaskChanged(action string, task *taskmodel.Task) {
	p.client.Frontend.PublishWebSocketEvent(Event, map[string]any{
		"entity":    "task",
		"action":    action,
		"taskId":    task.ID,
		"teamId":    task.TeamID,
		"channelId": task.ChannelID,
	}, broadcast(task.TeamID, task.ChannelID))
}

// BookmarkChanged notifies the bookmark's channel or team.
func (p *Publisher) BookmarkChanged(action string, bookmark *taskmodel.Bookmark) {
	p.client.Frontend.PublishWebSocketEvent(Event, map[string]any{
		"entity":     "bookmark",
		"action":     action,
		"bookmarkId": bookmark.ID,
		"teamId":     bookmark.TeamID,
		"channelId":  bookmark.ChannelID,
	}, broadcast(bookmark.TeamID, bookmark.ChannelID))
}

func broadcast(teamID, channelID string) *model.WebsocketBroadcast {
	if channelID != "" {
		return &model.WebsocketBroadcast{ChannelId: channelID}
	}
	return &model.WebsocketBroadcast{TeamId: teamID}
}
