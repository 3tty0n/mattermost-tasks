// Package notifications sends task-assignment direct messages. Deliveries run on one bounded
// worker so a slow Mattermost API call never delays the task write that triggered it.
package notifications

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"sync"

	mmodel "github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/pluginapi"

	"github.com/3tty0n/mattermost-tasks/server/access"
	"github.com/3tty0n/mattermost-tasks/server/model"
	"github.com/3tty0n/mattermost-tasks/server/tasks"
)

const queueSize = 64

type assignment struct {
	taskID     string
	title      string
	teamID     string
	channelID  string
	priority   string
	dueAt      int64
	dueHasTime bool
	userIDs    []string
}

// Notifier queues and delivers assignment messages from the plugin bot.
type Notifier struct {
	client  *pluginapi.Client
	access  *access.Checker
	siteURL func() string
	enabled func() bool

	mu        sync.Mutex
	botUserID string
	started   bool
	cancel    context.CancelFunc
	wg        sync.WaitGroup
	queue     chan assignment
}

// New returns a notifier. Call Start after the bot user has been created.
func New(client *pluginapi.Client, checker *access.Checker, siteURL func() string, enabled func() bool) *Notifier {
	return &Notifier{
		client:  client,
		access:  checker,
		siteURL: siteURL,
		enabled: enabled,
		queue:   make(chan assignment, queueSize),
	}
}

// SetBotUserID records the plugin bot that authors the messages.
func (n *Notifier) SetBotUserID(botUserID string) {
	n.mu.Lock()
	n.botUserID = botUserID
	n.mu.Unlock()
}

// Start launches the single delivery worker.
func (n *Notifier) Start() {
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.started {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	n.cancel = cancel
	n.started = true
	n.wg.Go(func() {
		for {
			select {
			case <-ctx.Done():
				return
			case item := <-n.queue:
				n.safeDeliver(item)
			}
		}
	})
}

// Close stops the worker after the current message, if any.
func (n *Notifier) Close() {
	n.mu.Lock()
	cancel := n.cancel
	started := n.started
	n.started = false
	n.cancel = nil
	n.mu.Unlock()
	if started && cancel != nil {
		cancel()
		n.wg.Wait()
	}
}

// NotifyAssignment enqueues one message per assignee. It never blocks: if the queue is full the
// notification is dropped and logged rather than delaying the API response.
func (n *Notifier) NotifyAssignment(task *model.Task, assigneeIDs []string) {
	if task == nil || len(assigneeIDs) == 0 {
		return
	}
	n.mu.Lock()
	botUserID := n.botUserID
	started := n.started
	n.mu.Unlock()
	if botUserID == "" || !started || (n.enabled != nil && !n.enabled()) {
		return
	}

	item := assignment{
		taskID:     task.ID,
		title:      task.Title,
		teamID:     task.TeamID,
		channelID:  task.ChannelID,
		priority:   task.Priority,
		dueAt:      task.DueAt,
		dueHasTime: task.DueHasTime,
		userIDs:    append([]string(nil), assigneeIDs...),
	}
	select {
	case n.queue <- item:
	default:
		n.client.Log.Warn("Dropped task assignment notification because the queue is full", "task_id", task.ID)
	}
}

func (n *Notifier) safeDeliver(item assignment) {
	defer func() {
		if recovered := recover(); recovered != nil {
			n.client.Log.Error("Recovered from panic while sending a task notification", "task_id", item.taskID, "error", fmt.Sprint(recovered))
		}
	}()
	n.deliver(item)
}

func (n *Notifier) deliver(item assignment) {
	n.mu.Lock()
	botUserID := n.botUserID
	n.mu.Unlock()
	if botUserID == "" {
		return
	}

	teamName, err := n.access.ResolveTeamName(item.teamID)
	if err != nil {
		n.client.Log.Warn("Failed to resolve the team for a task notification", "task_id", item.taskID, "error", err.Error())
		return
	}
	channelName := ""
	if item.channelID != "" {
		channelName, err = n.access.ResolveChannelName(item.channelID)
		if err != nil {
			n.client.Log.Warn("Failed to resolve the channel for a task notification", "task_id", item.taskID, "error", err.Error())
			return
		}
	}

	message := formatMessage(item, teamName, channelName, n.link(item, teamName, channelName))
	for _, userID := range item.userIDs {
		if err := n.client.Post.DM(botUserID, userID, &mmodel.Post{Message: message}); err != nil {
			n.client.Log.Warn("Failed to send a task notification", "task_id", item.taskID, "user_id", userID, "error", err.Error())
		}
	}
}

func (n *Notifier) link(item assignment, teamName, channelName string) string {
	base := ""
	if n.siteURL != nil {
		base = strings.TrimRight(n.siteURL(), "/")
	}
	path := "/" + url.PathEscape(teamName)
	if channelName != "" {
		path += "/channels/" + url.PathEscape(channelName)
	}
	return base + path + "#task-" + item.taskID
}

func formatMessage(item assignment, teamName, channelName, link string) string {
	var builder strings.Builder
	builder.WriteString("**You were assigned a task:** ")
	builder.WriteString(item.title)
	builder.WriteString("\n\n")
	builder.WriteString("- **Team:** ")
	builder.WriteString(teamName)
	if channelName != "" {
		builder.WriteString("\n- **Channel:** ")
		builder.WriteString(channelName)
	}
	if item.dueAt != 0 {
		builder.WriteString("\n- **Due:** ")
		builder.WriteString(tasks.FormatDue(item.dueAt, item.dueHasTime))
	}
	builder.WriteString("\n- **Priority:** ")
	builder.WriteString(item.priority)
	builder.WriteString("\n\n[Open in Mattermost](")
	builder.WriteString(link)
	builder.WriteString(")")
	return builder.String()
}

// Ensure the notifier satisfies the tasks interface.
var _ tasks.Notifier = (*Notifier)(nil)
