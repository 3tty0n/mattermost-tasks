package command

import (
	"strings"
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/3tty0n/mattermost-tasks/server/access"
	"github.com/3tty0n/mattermost-tasks/server/events"
	taskmodel "github.com/3tty0n/mattermost-tasks/server/model"
	"github.com/3tty0n/mattermost-tasks/server/store/kvstore"
	"github.com/3tty0n/mattermost-tasks/server/tasks"
	"github.com/3tty0n/mattermost-tasks/server/testutil"
)

type commandEnv struct {
	handler *Handler
	api     *testutil.API
	store   *kvstore.KVStore
}

func newCommandEnv(t *testing.T) *commandEnv {
	t.Helper()
	api := testutil.NewAPI()
	t.Cleanup(func() { api.AssertExpectations(t) })
	client := pluginapi.NewClient(api, &plugintest.Driver{})
	checker := access.NewChecker(client)
	store := kvstore.NewStoreWithKV(kvstore.NewMemoryKV())
	taskService := tasks.NewService(client, store, checker, nil, nil, tasks.WithClock(func() int64 { return 1000 }))
	return &commandEnv{
		handler: &Handler{client: client, tasks: taskService, events: events.NewEventService(client, store, checker, nil)},
		api:     api,
		store:   store,
	}
}

func args(userID, teamID, channelID, text string) *model.CommandArgs {
	return &model.CommandArgs{UserId: userID, TeamId: teamID, ChannelId: channelID, Command: text}
}

func allowChannel(api *testutil.API, userID, channelID, teamID string) {
	api.On("GetChannel", channelID).Return(&model.Channel{Id: channelID, TeamId: teamID, Type: model.ChannelTypeOpen}, nil).Maybe()
	api.On("HasPermissionToChannel", userID, channelID, model.PermissionReadChannel).Return(true).Maybe()
}

func TestCommandHelpAndUnknown(t *testing.T) {
	env := newCommandEnv(t)
	userID := model.NewId()

	response, err := env.handler.Handle(nil, args(userID, "", "", "/task"))
	require.NoError(t, err)
	assert.Contains(t, response.Text, "**Tasks**")

	response, err = env.handler.Handle(nil, args(userID, "", "", "/task help"))
	require.NoError(t, err)
	assert.Contains(t, response.Text, "/task list")

	response, err = env.handler.Handle(nil, args(userID, "", "", "/task nonsense"))
	require.NoError(t, err)
	assert.Contains(t, response.Text, "Unknown subcommand")
}

func TestCommandListAndShow(t *testing.T) {
	env := newCommandEnv(t)
	userID := model.NewId()
	teamID, channelID := model.NewId(), model.NewId()
	allowChannel(env.api, userID, channelID, teamID)

	response, err := env.handler.Handle(nil, args(userID, teamID, channelID, "/task list"))
	require.NoError(t, err)
	assert.Contains(t, response.Text, "no open tasks")

	task := &taskmodel.Task{
		ID: model.NewId(), TeamID: teamID, ChannelID: channelID, Title: "Visible",
		CreatorID: userID, AssigneeIDs: []string{userID}, Status: taskmodel.TaskStatusTodo,
		Priority: taskmodel.TaskPriorityNormal, Version: 1, CreatedAt: 1, UpdatedAt: 1,
	}
	require.NoError(t, env.store.CreateTask(task))
	env.api.On("HasPermissionToChannel", userID, channelID, model.PermissionReadChannel).Return(true).Maybe()

	response, err = env.handler.Handle(nil, args(userID, teamID, channelID, "/task list"))
	require.NoError(t, err)
	assert.Contains(t, response.Text, "Visible")
	assert.Contains(t, response.Text, task.ID)

	response, err = env.handler.Handle(nil, args(userID, teamID, channelID, "/task show "+task.ID))
	require.NoError(t, err)
	assert.Contains(t, response.Text, "Visible")
	assert.Contains(t, response.Text, "To do")
}

func TestCommandCreateAndDone(t *testing.T) {
	env := newCommandEnv(t)
	userID := model.NewId()
	teamID, channelID := model.NewId(), model.NewId()
	allowChannel(env.api, userID, channelID, teamID)

	response, err := env.handler.Handle(nil, args(userID, teamID, channelID, "/task create Ship the release"))
	require.NoError(t, err)
	assert.Contains(t, response.Text, "Created task")

	refs, err := env.store.ListTaskRefsByChannel(channelID)
	require.NoError(t, err)
	require.Len(t, refs, 1)
	assert.Equal(t, "Ship the release", refs[0].Title)
	assert.Equal(t, []string{userID}, refs[0].AssigneeIDs)

	env.api.On("HasPermissionTo", userID, model.PermissionManageSystem).Return(false).Maybe()
	response, err = env.handler.Handle(nil, args(userID, teamID, channelID, "/task done "+refs[0].ID))
	require.NoError(t, err)
	assert.Contains(t, response.Text, "Marked")

	task, err := env.store.GetTask(refs[0].ID)
	require.NoError(t, err)
	assert.Equal(t, taskmodel.TaskStatusDone, task.Status)
}

func TestCommandErrorsAreEphemeral(t *testing.T) {
	env := newCommandEnv(t)
	userID := model.NewId()
	teamID, channelID := model.NewId(), model.NewId()
	env.api.On("GetChannel", channelID).Return(&model.Channel{Id: channelID, TeamId: teamID, Type: model.ChannelTypePrivate}, nil).Maybe()
	env.api.On("HasPermissionToChannel", userID, channelID, model.PermissionReadChannel).Return(false).Maybe()

	response, err := env.handler.Handle(nil, args(userID, teamID, channelID, "/task create Nope"))
	require.NoError(t, err)
	assert.Equal(t, model.CommandResponseTypeEphemeral, response.ResponseType)
	assert.Contains(t, response.Text, "permission")
}

func TestEventCommandCreateListShowDelete(t *testing.T) {
	env := newCommandEnv(t)
	userID := model.NewId()
	teamID, channelID := model.NewId(), model.NewId()
	allowChannel(env.api, userID, channelID, teamID)
	env.api.On("HasPermissionTo", userID, model.PermissionManageSystem).Return(false).Maybe()
	env.api.On("GetUser", userID).Return(&model.User{Id: userID, Timezone: map[string]string{"useAutomaticTimezone": "false", "manualTimezone": "Asia/Tokyo"}}, nil).Maybe()

	tomorrow := time.Now().In(time.FixedZone("JST", 9*3600)).AddDate(0, 0, 1).Format("2006-01-02")
	response, err := env.handler.Handle(nil, args(userID, teamID, channelID, "/event create "+tomorrow+" 15:30 45m Design review"))
	require.NoError(t, err)
	assert.Contains(t, response.Text, "Created event **Design review**")
	assert.Contains(t, response.Text, "15:30–16:15")

	response, err = env.handler.Handle(nil, args(userID, teamID, channelID, "/event create tomorrow Offsite day"))
	require.NoError(t, err)
	assert.Contains(t, response.Text, "(all day)")

	refs, err := env.store.ListEventRefsByChannel(channelID)
	require.NoError(t, err)
	require.Len(t, refs, 2)
	var timed *taskmodel.EventRef
	for i := range refs {
		if refs[i].Title == "Design review" {
			timed = &refs[i]
		}
	}
	require.NotNil(t, timed)
	assert.Equal(t, "Asia/Tokyo", timed.TimeZone)
	assert.Equal(t, 45*time.Minute.Milliseconds(), timed.EndAt-timed.StartAt)

	response, err = env.handler.Handle(nil, args(userID, teamID, channelID, "/event list"))
	require.NoError(t, err)
	assert.Contains(t, response.Text, "Design review")
	assert.Contains(t, response.Text, "Offsite day")

	response, err = env.handler.Handle(nil, args(userID, teamID, channelID, "/event show "+timed.ID))
	require.NoError(t, err)
	assert.Contains(t, response.Text, "Design review")

	response, err = env.handler.Handle(nil, args(userID, teamID, channelID, "/event delete "+timed.ID))
	require.NoError(t, err)
	assert.Contains(t, response.Text, "Deleted")
	refs, err = env.store.ListEventRefsByChannel(channelID)
	require.NoError(t, err)
	assert.Len(t, refs, 1)
}

func TestEventCommandUsageAndHelp(t *testing.T) {
	env := newCommandEnv(t)
	userID := model.NewId()
	env.api.On("GetUser", userID).Return(&model.User{Id: userID}, nil).Maybe()

	response, err := env.handler.Handle(nil, args(userID, "", "", "/event"))
	require.NoError(t, err)
	assert.Contains(t, response.Text, "**Events**")

	for _, text := range []string{"/event create", "/event create 2026-13-45 Oops", "/event create 2026-01-05 10:00", "/event delete"} {
		response, err = env.handler.Handle(nil, args(userID, "", "", text))
		require.NoError(t, err)
		assert.True(t, strings.Contains(response.Text, "Usage"), text)
	}

	response, err = env.handler.Handle(nil, args(userID, "", "", "/event nonsense"))
	require.NoError(t, err)
	assert.Contains(t, response.Text, "Unknown subcommand")
}
