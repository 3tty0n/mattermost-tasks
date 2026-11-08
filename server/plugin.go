package main

import (
	"net/http"
	"sync"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/mattermost/mattermost/server/public/pluginapi"

	"github.com/3tty0n/mattermost-tasks/server/access"
	"github.com/3tty0n/mattermost-tasks/server/api"
	"github.com/3tty0n/mattermost-tasks/server/bookmarks"
	"github.com/3tty0n/mattermost-tasks/server/command"
	"github.com/3tty0n/mattermost-tasks/server/events"
	"github.com/3tty0n/mattermost-tasks/server/notifications"
	"github.com/3tty0n/mattermost-tasks/server/store/kvstore"
	"github.com/3tty0n/mattermost-tasks/server/tasks"
)

// Plugin implements the interface expected by the Mattermost server.
type Plugin struct {
	plugin.MattermostPlugin

	client    *pluginapi.Client
	access    *access.Checker
	store     kvstore.Store
	tasks     *tasks.Service
	bookmarks *bookmarks.Service
	notifier  *notifications.Notifier

	// commandClient is the slash-command fallback.
	commandClient command.Command

	// httpHandler serves the routes in server/api.
	httpHandler *api.Handler

	configurationLock sync.RWMutex
	configuration     *configuration
}

// OnActivate wires the plugin. Failure here deactivates the plugin.
func (p *Plugin) OnActivate() error {
	if p.notifier != nil {
		p.notifier.Close()
	}
	p.client = pluginapi.NewClient(p.API, p.Driver)
	p.access = access.NewChecker(p.client)
	p.store = kvstore.NewStore(p.client)

	botUserID := p.ensureBot()

	p.notifier = notifications.New(
		p.client,
		p.access,
		p.siteURL,
		func() bool { return p.getConfiguration().EnableAssignmentNotifications },
	)
	p.notifier.SetBotUserID(botUserID)
	p.notifier.Start()

	publisher := events.New(p.client)
	p.tasks = tasks.NewService(p.client, p.store, p.access, publisher, p.notifier)
	p.bookmarks = bookmarks.NewService(p.client, p.store, p.access, publisher)

	commandClient, err := command.NewCommandHandler(p.client, p.tasks, p.bookmarks)
	if err != nil {
		p.notifier.Close()
		return err
	}
	p.commandClient = commandClient

	p.httpHandler = api.NewHandler(p.API, p.client, p.access, p.tasks, p.bookmarks)
	return nil
}

// OnDeactivate stops the notification worker. The KV store needs no close.
func (p *Plugin) OnDeactivate() error {
	if p.notifier != nil {
		p.notifier.Close()
	}
	return nil
}

// ensureBot creates (or finds) the account that authors assignment DMs. A missing bot must not
// prevent tasks from working, so the error is logged and notifications are simply skipped.
func (p *Plugin) ensureBot() string {
	botUserID, err := p.client.Bot.EnsureBot(&model.Bot{
		Username:    "tasks-bookmarks-bot",
		DisplayName: "Tasks",
		Description: "Sends task assignment notifications for the Tasks & Bookmarks plugin.",
	})
	if err != nil {
		p.client.Log.Error("Failed to ensure the task notification bot; assignment notifications are disabled", "error", err.Error())
		return ""
	}
	return botUserID
}

// ServeHTTP is invoked for requests to /plugins/{plugin_id}.
func (p *Plugin) ServeHTTP(c *plugin.Context, w http.ResponseWriter, r *http.Request) {
	if p.httpHandler == nil {
		http.Error(w, "Plugin is not ready", http.StatusServiceUnavailable)
		return
	}
	p.httpHandler.ServeHTTP(c, w, r)
}

// ExecuteCommand runs the slash commands registered by NewCommandHandler.
func (p *Plugin) ExecuteCommand(c *plugin.Context, args *model.CommandArgs) (*model.CommandResponse, *model.AppError) {
	if p.commandClient == nil {
		return nil, model.NewAppError("ExecuteCommand", "plugin.command.execute_command.app_error", nil, "plugin not ready", http.StatusServiceUnavailable)
	}
	response, err := p.commandClient.Handle(c, args)
	if err != nil {
		return nil, model.NewAppError("ExecuteCommand", "plugin.command.execute_command.app_error", nil, err.Error(), http.StatusInternalServerError)
	}
	return response, nil
}

func (p *Plugin) siteURL() string {
	config := p.client.Configuration.GetConfig()
	if config == nil || config.ServiceSettings.SiteURL == nil {
		return ""
	}
	return *config.ServiceSettings.SiteURL
}
