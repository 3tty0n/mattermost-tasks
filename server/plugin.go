package main

import (
	"net/http"
	"sync"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/mattermost/mattermost/server/public/pluginapi/cluster"

	"github.com/3tty0n/mattermost-tasks/server/access"
	"github.com/3tty0n/mattermost-tasks/server/api"
	"github.com/3tty0n/mattermost-tasks/server/command"
	"github.com/3tty0n/mattermost-tasks/server/events"
	"github.com/3tty0n/mattermost-tasks/server/notifications"
	"github.com/3tty0n/mattermost-tasks/server/reminders"
	"github.com/3tty0n/mattermost-tasks/server/store/kvstore"
	"github.com/3tty0n/mattermost-tasks/server/tasks"
)

// Plugin implements the interface expected by the Mattermost server.
type Plugin struct {
	plugin.MattermostPlugin

	client   *pluginapi.Client
	access   *access.Checker
	store    *kvstore.KVStore
	tasks    *tasks.Service
	events   *events.EventService
	notifier *notifications.Notifier

	// reminderJob fires due reminders once a minute on a single cluster node.
	reminderJob *cluster.Job

	// commandClient is the slash-command fallback.
	commandClient command.Command

	// httpHandler serves the routes in server/api.
	httpHandler *api.Handler

	configurationLock sync.RWMutex
	configuration     *configuration
}

// OnActivate wires the plugin. Failure here deactivates the plugin.
func (p *Plugin) OnActivate() error {
	p.stopReminders()
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
	scheduler := reminders.New(p.client, p.store, p.notifier, model.GetMillis)
	p.tasks = tasks.NewService(p.client, p.store, p.access, publisher, p.notifier, tasks.WithReminders(scheduler))
	p.events = events.NewEventService(p.client, p.store, p.access, publisher, events.WithEventReminders(scheduler))

	commandClient, err := command.NewCommandHandler(p.client, p.tasks, p.events, command.WithDefaultEventMinutes(func() int {
		return p.getConfiguration().eventDurationMinutes()
	}))
	if err != nil {
		p.notifier.Close()
		return err
	}
	p.commandClient = commandClient

	p.httpHandler = api.NewHandler(p.API, p.client, p.access, p.tasks, p.events)
	p.httpHandler.SetClientConfig(func() api.ClientConfig {
		return api.ClientConfig{DefaultEventDurationMinutes: p.getConfiguration().eventDurationMinutes()}
	})

	job, err := cluster.Schedule(p.API, "tasks-reminders", cluster.MakeWaitForInterval(time.Minute), scheduler.RunOnce)
	if err != nil {
		p.notifier.Close()
		return err
	}
	p.reminderJob = job
	return nil
}

// OnDeactivate stops the reminder job and the notification worker. The KV store needs no close.
func (p *Plugin) OnDeactivate() error {
	p.stopReminders()
	return nil
}

func (p *Plugin) stopReminders() {
	if p.reminderJob != nil {
		if err := p.reminderJob.Close(); err != nil {
			p.API.LogWarn("Failed to stop the reminder job", "error", err.Error())
		}
		p.reminderJob = nil
	}
	if p.notifier != nil {
		p.notifier.Close()
	}
}

// ensureBot creates (or finds) the account that authors assignment DMs. A missing bot must not
// prevent tasks from working, so the error is logged and notifications are simply skipped.
func (p *Plugin) ensureBot() string {
	botUserID, err := p.client.Bot.EnsureBot(&model.Bot{
		Username:    "tasks-bot",
		DisplayName: "Tasks",
		Description: "Sends task assignment notifications for the Tasks plugin.",
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
