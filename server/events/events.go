// Package events publishes the plugin's WebSocket change notifications. Payloads carry IDs only:
// every recipient of a WebSocket event can read its payload, so task titles and descriptions
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

// EventChanged notifies the event's channel, team or creator. Private events are sent only to
// their creator, because every WebSocket recipient can read the payload.
func (p *Publisher) EventChanged(action string, event *taskmodel.Event) {
	payload := map[string]any{
		"entity":    "event",
		"action":    action,
		"eventId":   event.ID,
		"teamId":    event.TeamID,
		"channelId": event.ChannelID,
	}
	if event.EffectiveVisibility() == taskmodel.TaskVisibilityPrivate {
		p.client.Frontend.PublishWebSocketEvent(Event, payload, &model.WebsocketBroadcast{UserId: event.CreatorID})
		return
	}
	p.client.Frontend.PublishWebSocketEvent(Event, payload, broadcast(event.TeamID, event.ChannelID))
}

func broadcast(teamID, channelID string) *model.WebsocketBroadcast {
	if channelID != "" {
		return &model.WebsocketBroadcast{ChannelId: channelID}
	}
	return &model.WebsocketBroadcast{TeamId: teamID}
}
