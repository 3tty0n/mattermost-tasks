package reminders

import (
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/3tty0n/mattermost-tasks/server/model"
	"github.com/3tty0n/mattermost-tasks/server/notifications"
	"github.com/3tty0n/mattermost-tasks/server/store/kvstore"
	"github.com/3tty0n/mattermost-tasks/server/testutil"
)

type fakeSender struct{ sent []notifications.Reminder }

func (f *fakeSender) SendReminder(r notifications.Reminder) { f.sent = append(f.sent, r) }

type fixture struct {
	scheduler *Scheduler
	store     *kvstore.KVStore
	sender    *fakeSender
	now       int64
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{
		store:  kvstore.NewStoreWithKV(kvstore.NewMemoryKV()),
		sender: &fakeSender{},
		now:    time.Date(2026, 1, 5, 8, 0, 0, 0, time.UTC).UnixMilli(),
	}
	client := pluginapi.NewClient(testutil.NewAPI(), &plugintest.Driver{})
	f.scheduler = New(client, f.store, f.sender, func() int64 { return f.now })
	f.scheduler.RunOnce() // first run only records the cursor
	return f
}

func (f *fixture) advance(d time.Duration) {
	f.now += d.Milliseconds()
	f.scheduler.RunOnce()
}

func TestTaskReminderFiresOnceAtOffset(t *testing.T) {
	f := newFixture(t)
	task := &model.Task{ID: "t1", Title: "Report", AssigneeIDs: []string{"u1"}, CreatorID: "c", Status: model.TaskStatusTodo,
		DueAt: f.now + 30*60_000, DueHasTime: true, Reminders: []int{0, 15, 24 * 60}}
	require.NoError(t, f.store.CreateTask(task))
	f.scheduler.ScheduleTask(task) // the 1-day reminder is already in the past and is skipped

	f.advance(10 * time.Minute)
	assert.Empty(t, f.sender.sent)
	f.advance(6 * time.Minute) // 16 min in: the 15-minute reminder is due
	require.Len(t, f.sender.sent, 1)
	assert.Equal(t, 15, f.sender.sent[0].Offset)
	assert.Equal(t, []string{"u1"}, f.sender.sent[0].UserIDs)
	f.advance(20 * time.Minute) // due time reached
	require.Len(t, f.sender.sent, 2)
	assert.Equal(t, 0, f.sender.sent[1].Offset)
	f.advance(time.Hour)
	assert.Len(t, f.sender.sent, 2)
}

func TestStaleTaskReminderIsDropped(t *testing.T) {
	f := newFixture(t)
	task := &model.Task{ID: "t1", Title: "Report", CreatorID: "c", Status: model.TaskStatusTodo, DueAt: f.now + 30*60_000, Reminders: []int{10}}
	require.NoError(t, f.store.CreateTask(task))
	f.scheduler.ScheduleTask(task)

	task.DueAt += 60 * 60_000 // rescheduled
	_, err := f.store.UpdateTask("t1", func(*model.Task) (*model.Task, error) { return task, nil })
	require.NoError(t, err)
	f.advance(time.Hour)
	assert.Empty(t, f.sender.sent)
}

func TestRepeatingEventRemindsEveryOccurrence(t *testing.T) {
	f := newFixture(t)
	event := &model.Event{ID: "e1", Title: "Standup", CreatorID: "c", TimeZone: "UTC",
		StartAt: f.now + 60*60_000, EndAt: f.now + 90*60_000, Reminders: []int{10},
		Recurrence: &model.EventRecurrence{Frequency: model.EventRecurrenceDaily, Interval: 1}}
	require.NoError(t, f.store.CreateEvent(event))
	f.scheduler.ScheduleEvent(event)

	f.advance(55 * time.Minute)
	require.Len(t, f.sender.sent, 1)
	assert.Equal(t, []string{"c"}, f.sender.sent[0].UserIDs) // no assignees: the creator
	f.advance(24 * time.Hour)
	require.Len(t, f.sender.sent, 2)
	assert.Equal(t, f.sender.sent[0].Start+24*60*60_000, f.sender.sent[1].Start)
}
