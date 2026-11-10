// Package reminders sends "N minutes before" notifications for task due times and event starts.
// Mattermost has no scheduled-notification API, so a cluster-wide job (one run per minute) pops due
// entries from hour buckets in the KV store and sends them as bot DMs, which Mattermost turns into
// each user's own desktop/push/email notification.
package reminders

import (
	"errors"
	"slices"

	"github.com/mattermost/mattermost/server/public/pluginapi"

	"github.com/3tty0n/mattermost-tasks/server/model"
	"github.com/3tty0n/mattermost-tasks/server/notifications"
	"github.com/3tty0n/mattermost-tasks/server/store/kvstore"
)

const (
	minuteMs = 60_000
	// maxCatchUpMs bounds how late a reminder may still fire after downtime.
	maxCatchUpMs = 24 * 3600_000
)

// Store is the persistence the scheduler needs.
type Store interface {
	kvstore.ReminderStore
	GetTask(id string) (*model.Task, error)
	GetEvent(id string) (*model.Event, error)
}

// Sender delivers a reminder.
type Sender interface {
	SendReminder(r notifications.Reminder)
}

// Scheduler records pending reminders and fires them from RunOnce.
type Scheduler struct {
	client *pluginapi.Client
	store  Store
	sender Sender
	now    func() int64
}

// New returns a scheduler.
func New(client *pluginapi.Client, store Store, sender Sender, now func() int64) *Scheduler {
	return &Scheduler{client: client, store: store, sender: sender, now: now}
}

// ScheduleTask records the reminders for the task's current due time.
func (s *Scheduler) ScheduleTask(task *model.Task) {
	if task.DueAt == 0 || task.Status == model.TaskStatusDone {
		return
	}
	now := s.now()
	var entries []kvstore.ReminderEntry
	for _, offset := range task.Reminders {
		if at := task.DueAt - int64(offset)*minuteMs; at > now {
			entries = append(entries, kvstore.ReminderEntry{Kind: "task", ID: task.ID, Offset: offset, At: at})
		}
	}
	s.add(entries)
}

// ScheduleEvent records the reminders for the next occurrence of each offset.
func (s *Scheduler) ScheduleEvent(event *model.Event) {
	now := s.now()
	var entries []kvstore.ReminderEntry
	for _, offset := range event.Reminders {
		lead := int64(offset) * minuteMs
		if start, ok := event.NextStart(now + lead); ok {
			entries = append(entries, kvstore.ReminderEntry{Kind: "event", ID: event.ID, Offset: offset, At: start - lead})
		}
	}
	s.add(entries)
}

func (s *Scheduler) add(entries []kvstore.ReminderEntry) {
	if len(entries) == 0 {
		return
	}
	if err := s.store.AddReminders(entries); err != nil {
		s.client.Log.Warn("Failed to schedule reminders", "error", err.Error())
	}
}

// RunOnce fires every reminder that became due since the previous run.
func (s *Scheduler) RunOnce() {
	now := s.now()
	cursor, err := s.store.GetReminderCursor()
	if err != nil {
		s.client.Log.Warn("Failed to read the reminder cursor", "error", err.Error())
		return
	}
	if cursor <= 0 || cursor > now {
		cursor = now
	}
	cursor = max(cursor, now-maxCatchUpMs)
	for hour := kvstore.ReminderHour(cursor); hour <= kvstore.ReminderHour(now); hour++ {
		due, err := s.store.PopDueReminders(hour, now)
		if err != nil {
			s.client.Log.Warn("Failed to read due reminders", "error", err.Error())
			return
		}
		for _, entry := range due {
			s.fire(entry)
		}
	}
	if err := s.store.SetReminderCursor(now); err != nil {
		s.client.Log.Warn("Failed to save the reminder cursor", "error", err.Error())
	}
}

func (s *Scheduler) fire(entry kvstore.ReminderEntry) {
	lead := int64(entry.Offset) * minuteMs
	start := entry.At + lead
	switch entry.Kind {
	case "task":
		task, err := s.store.GetTask(entry.ID)
		if err != nil {
			s.logLoad(err, entry)
			return
		}
		// Stale entry: the task was edited, completed or its reminder removed since scheduling.
		if task.Status == model.TaskStatusDone || task.DueAt != start || !slices.Contains(task.Reminders, entry.Offset) {
			return
		}
		s.sender.SendReminder(notifications.Reminder{
			Kind: "task", ID: task.ID, Title: task.Title, TeamID: task.TeamID, ChannelID: task.ChannelID,
			Start: start, HasTime: task.DueHasTime, TimeZone: task.TimeZone, Offset: entry.Offset,
			UserIDs: recipients(task.AssigneeIDs, task.CreatorID),
		})
	case "event":
		event, err := s.store.GetEvent(entry.ID)
		if err != nil {
			s.logLoad(err, entry)
			return
		}
		if !slices.Contains(event.Reminders, entry.Offset) {
			return
		}
		if next, ok := event.NextStart(start - 1); ok && next == start {
			s.sender.SendReminder(notifications.Reminder{
				Kind: "event", ID: event.ID, Title: event.Title, TeamID: event.TeamID, ChannelID: event.ChannelID,
				Start: start, HasTime: !event.AllDay, TimeZone: event.TimeZone, Offset: entry.Offset,
				UserIDs: recipients(event.AssigneeIDs, event.CreatorID),
			})
		}
		s.ScheduleEvent(event) // queue the next occurrence of a repeating event
	}
}

func (s *Scheduler) logLoad(err error, entry kvstore.ReminderEntry) {
	if !errors.Is(err, kvstore.ErrNotFound) { // a deleted item is expected
		s.client.Log.Warn("Failed to load an item for a reminder", "id", entry.ID, "error", err.Error())
	}
}

// recipients are the assignees, or the creator when nobody is assigned.
func recipients(assigneeIDs []string, creatorID string) []string {
	if len(assigneeIDs) > 0 {
		return assigneeIDs
	}
	return []string{creatorID}
}
