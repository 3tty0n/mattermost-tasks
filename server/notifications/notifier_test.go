package notifications

import (
	"testing"
	"time"

	mmodel "github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest/mock"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"

	"github.com/3tty0n/mattermost-tasks/server/access"
	taskmodel "github.com/3tty0n/mattermost-tasks/server/model"
	"github.com/3tty0n/mattermost-tasks/server/testutil"
)

func newTestNotifier(t *testing.T) (*Notifier, *testutil.API) {
	t.Helper()
	api := testutil.NewAPI()
	t.Cleanup(func() { api.AssertExpectations(t) })
	client := pluginapi.NewClient(api, &plugintest.Driver{})
	notifier := New(client, access.NewChecker(client), func() string { return "https://mm.example" }, func() bool { return true })
	notifier.SetBotUserID("bot-user-id")
	return notifier, api
}

func TestDeliverAssignmentNotification(t *testing.T) {
	notifier, api := newTestNotifier(t)
	teamID, channelID, userID := mmodel.NewId(), mmodel.NewId(), mmodel.NewId()

	api.On("GetTeam", teamID).Return(&mmodel.Team{Id: teamID, Name: "engineering"}, nil).Once()
	api.On("GetChannel", channelID).Return(&mmodel.Channel{Id: channelID, TeamId: teamID, Name: "town-square"}, nil).Once()
	api.On("GetDirectChannel", "bot-user-id", userID).Return(&mmodel.Channel{Id: "dm-channel"}, nil).Once()
	api.On("CreatePost", mock.MatchedBy(func(post *mmodel.Post) bool {
		return post.ChannelId == "dm-channel" &&
			post.UserId == "bot-user-id" &&
			post.Message != ""
	})).Return(&mmodel.Post{Id: "post-id"}, nil).Once()

	notifier.deliver(assignment{
		taskID:    "task-id",
		title:     "Ship it",
		teamID:    teamID,
		channelID: channelID,
		priority:  "high",
		dueAt:     1700000000000,
		userIDs:   []string{userID},
	})
}

func TestFormatMessageIncludesContextAndLink(t *testing.T) {
	message := formatMessage(assignment{
		taskID:   "task-id",
		title:    "Ship it",
		priority: "urgent",
		dueAt:    1700000000000,
	}, "engineering", "town-square", "https://mm.example/engineering/channels/town-square#task-task-id")

	assert.Contains(t, message, "Ship it")
	assert.Contains(t, message, "engineering")
	assert.Contains(t, message, "town-square")
	assert.Contains(t, message, "urgent")
	assert.Contains(t, message, "https://mm.example/engineering/channels/town-square#task-task-id")
}

func TestLinkFallsBackToTeam(t *testing.T) {
	notifier, _ := newTestNotifier(t)
	link := notifier.link(assignment{taskID: "task-id"}, "engineering", "")
	assert.Equal(t, "https://mm.example/engineering#task-task-id", link)
}

func TestNotifyAssignmentIsSkippedWithoutBot(t *testing.T) {
	notifier, _ := newTestNotifier(t)
	notifier.SetBotUserID("")
	notifier.NotifyAssignment(&taskmodel.Task{ID: "task"}, []string{"user"})
	assert.Empty(t, notifier.queue)
}

func TestNotifyAssignmentDropsWhenDisabled(t *testing.T) {
	api := testutil.NewAPI()
	client := pluginapi.NewClient(api, &plugintest.Driver{})
	notifier := New(client, access.NewChecker(client), func() string { return "" }, func() bool { return false })
	notifier.SetBotUserID("bot")
	notifier.Start()
	t.Cleanup(notifier.Close)

	notifier.NotifyAssignment(&taskmodel.Task{ID: "task"}, []string{"user"})
	assert.Empty(t, notifier.queue)
}

func TestFormatReminder(t *testing.T) {
	start := time.Date(2026, 1, 5, 0, 0, 0, 0, time.UTC).UnixMilli()
	message := formatReminder(Reminder{Kind: "event", Title: "Standup", Start: start, HasTime: true, TimeZone: "Asia/Tokyo", Offset: 15},
		"engineering", "town-square", "https://mm.example/engineering#event-id")
	assert.Contains(t, message, "Event starting in 15 minutes")
	assert.Contains(t, message, "Jan 5, 2026 09:00 JST")

	message = formatReminder(Reminder{Kind: "task", Title: "Report", Start: start, Offset: 7 * 24 * 60}, "engineering", "", "link")
	assert.Contains(t, message, "Task due in 1 week")
	assert.Contains(t, message, "Jan 5, 2026")
}
