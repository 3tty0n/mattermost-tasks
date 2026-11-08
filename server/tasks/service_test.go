package tasks

import (
	"slices"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/3tty0n/mattermost-tasks/server/access"
	taskmodel "github.com/3tty0n/mattermost-tasks/server/model"
	"github.com/3tty0n/mattermost-tasks/server/store/kvstore"
	"github.com/3tty0n/mattermost-tasks/server/testutil"
)

type fakePublisher struct {
	events []string
	tasks  []*taskmodel.Task
}

func (p *fakePublisher) TaskChanged(action string, task *taskmodel.Task) {
	p.events = append(p.events, action)
	p.tasks = append(p.tasks, task)
}

type notification struct {
	taskID string
	users  []string
}

type fakeNotifier struct {
	notifications []notification
}

func (n *fakeNotifier) NotifyAssignment(task *taskmodel.Task, assigneeIDs []string) {
	n.notifications = append(n.notifications, notification{taskID: task.ID, users: slices.Clone(assigneeIDs)})
}

type testEnv struct {
	service   *Service
	api       *testutil.API
	store     kvstore.Store
	notifier  *fakeNotifier
	publisher *fakePublisher
	now       int64
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	api := testutil.NewAPI()
	t.Cleanup(func() { api.AssertExpectations(t) })
	client := pluginapi.NewClient(api, &plugintest.Driver{})
	store := kvstore.NewStoreWithKV(kvstore.NewMemoryKV())
	notifier := &fakeNotifier{}
	publisher := &fakePublisher{}
	env := &testEnv{api: api, store: store, notifier: notifier, publisher: publisher, now: 1000}
	env.service = NewService(client, store, access.NewChecker(client), publisher, notifier, WithClock(func() int64 {
		env.now++
		return env.now
	}))
	return env
}

func allowChannel(api *testutil.API, userID, channelID, teamID string) {
	api.On("GetChannel", channelID).Return(&model.Channel{Id: channelID, TeamId: teamID, Type: model.ChannelTypeOpen}, nil).Maybe()
	api.On("HasPermissionToChannel", userID, channelID, model.PermissionReadChannel).Return(true).Maybe()
}

func denyAdmin(api *testutil.API, userID string) {
	api.On("HasPermissionTo", userID, model.PermissionManageSystem).Return(false).Maybe()
}

func allowAdmin(api *testutil.API, userID string) {
	api.On("HasPermissionTo", userID, model.PermissionManageSystem).Return(true).Maybe()
}

func storeTestTask(t *testing.T, store kvstore.Store, task *taskmodel.Task) *taskmodel.Task {
	t.Helper()
	task.Version = 1
	task.CreatedAt = 1
	task.UpdatedAt = 1
	require.NoError(t, store.CreateTask(task))
	return task
}

func TestCreateTaskInChannel(t *testing.T) {
	env := newTestEnv(t)
	teamID, channelID := model.NewId(), model.NewId()
	actorID, assigneeID := model.NewId(), model.NewId()
	allowChannel(env.api, actorID, channelID, teamID)
	allowChannel(env.api, assigneeID, channelID, teamID)

	task, err := env.service.Create(nil, "/tasks", actorID, taskmodel.CreateTaskInput{
		ChannelID:   channelID,
		Title:       "  Ship it  ",
		Description: " Details ",
		AssigneeIDs: []string{assigneeID, assigneeID},
		Priority:    taskmodel.TaskPriorityHigh,
	})
	require.NoError(t, err)
	assert.Equal(t, teamID, task.TeamID)
	assert.Equal(t, channelID, task.ChannelID)
	assert.Equal(t, "Ship it", task.Title)
	assert.Equal(t, "Details", task.Description)
	assert.Equal(t, actorID, task.CreatorID)
	assert.Equal(t, []string{assigneeID}, task.AssigneeIDs)
	assert.Equal(t, taskmodel.TaskStatusTodo, task.Status)
	assert.Equal(t, int64(1), task.Version)
	assert.NotEmpty(t, task.ID)
	assert.Equal(t, 1, env.api.AuditSuccesses())
	assert.Equal(t, []string{"created"}, env.publisher.events)
	require.Len(t, env.notifier.notifications, 1)
	assert.Equal(t, []string{assigneeID}, env.notifier.notifications[0].users)

	refs, err := env.store.ListTaskRefsByUser(assigneeID)
	require.NoError(t, err)
	require.Len(t, refs, 1)
	assert.Equal(t, task.ID, refs[0].ID)
	assert.Equal(t, "Ship it", refs[0].Title)
}

func TestCreateTaskWithSourcePostAndScopeMismatch(t *testing.T) {
	env := newTestEnv(t)
	teamID, channelID, otherChannelID := model.NewId(), model.NewId(), model.NewId()
	actorID, postID := model.NewId(), model.NewId()
	allowChannel(env.api, actorID, channelID, teamID)
	env.api.On("GetPost", postID).Return(&model.Post{Id: postID, ChannelId: channelID}, nil).Maybe()

	task, err := env.service.Create(nil, "/tasks", actorID, taskmodel.CreateTaskInput{
		TeamID:       teamID,
		ChannelID:    channelID,
		Title:        "From post",
		SourcePostID: postID,
	})
	require.NoError(t, err)
	assert.Equal(t, teamID, task.TeamID)
	assert.Equal(t, channelID, task.ChannelID)
	assert.Equal(t, postID, task.SourcePostID)

	_, err = env.service.Create(nil, "/tasks", actorID, taskmodel.CreateTaskInput{
		ChannelID:    otherChannelID,
		Title:        "Wrong scope",
		SourcePostID: postID,
	})
	assert.ErrorIs(t, err, taskmodel.ErrInvalid)
}

func TestCreateTaskRejectsIneligibleAssignee(t *testing.T) {
	env := newTestEnv(t)
	teamID, channelID := model.NewId(), model.NewId()
	actorID, assigneeID := model.NewId(), model.NewId()
	allowChannel(env.api, actorID, channelID, teamID)
	env.api.On("GetChannel", channelID).Return(&model.Channel{Id: channelID, TeamId: teamID, Type: model.ChannelTypePrivate}, nil).Maybe()
	env.api.On("HasPermissionToChannel", assigneeID, channelID, model.PermissionReadChannel).Return(false).Maybe()

	_, err := env.service.Create(nil, "/tasks", actorID, taskmodel.CreateTaskInput{
		ChannelID:   channelID,
		Title:       "Nope",
		AssigneeIDs: []string{assigneeID},
	})
	assert.ErrorIs(t, err, taskmodel.ErrInvalid)
	refs, err := env.store.ListTaskRefsByChannel(channelID)
	require.NoError(t, err)
	assert.Empty(t, refs)
}

func TestCreateTaskRejectsInvalidInput(t *testing.T) {
	env := newTestEnv(t)
	teamID, channelID := model.NewId(), model.NewId()
	actorID := model.NewId()
	allowChannel(env.api, actorID, channelID, teamID)

	cases := []taskmodel.CreateTaskInput{
		{ChannelID: channelID, Title: ""},
		{ChannelID: channelID, Title: "ok", Status: "blocked"},
		{ChannelID: channelID, Title: "ok", Priority: "whenever"},
		{ChannelID: channelID, Title: "ok", DueAt: -1},
		{ChannelID: channelID, Title: "ok", AssigneeIDs: []string{"bad"}},
		{ChannelID: "bad", Title: "ok"},
	}
	for _, input := range cases {
		_, err := env.service.Create(nil, "/tasks", actorID, input)
		assert.ErrorIs(t, err, taskmodel.ErrInvalid, "%+v", input)
	}
}

func TestListMyTasksFiltersInaccessibleScopes(t *testing.T) {
	env := newTestEnv(t)
	actorID := model.NewId()
	teamID := model.NewId()
	openChannel, privateChannel := model.NewId(), model.NewId()

	storeTestTask(t, env.store, &taskmodel.Task{
		ID: model.NewId(), TeamID: teamID, ChannelID: openChannel, Title: "Open",
		CreatorID: "creator", AssigneeIDs: []string{actorID}, Status: taskmodel.TaskStatusTodo,
		Priority: taskmodel.TaskPriorityNormal, DueAt: 200,
	})
	storeTestTask(t, env.store, &taskmodel.Task{
		ID: model.NewId(), TeamID: teamID, ChannelID: privateChannel, Title: "Private",
		CreatorID: "creator", AssigneeIDs: []string{actorID}, Status: taskmodel.TaskStatusTodo,
		Priority: taskmodel.TaskPriorityNormal, DueAt: 100,
	})
	storeTestTask(t, env.store, &taskmodel.Task{
		ID: model.NewId(), TeamID: teamID, Title: "Team-level",
		CreatorID: "creator", AssigneeIDs: []string{actorID}, Status: taskmodel.TaskStatusTodo,
		Priority: taskmodel.TaskPriorityNormal, DueAt: 300,
	})

	env.api.On("HasPermissionToChannel", actorID, openChannel, model.PermissionReadChannel).Return(true).Maybe()
	env.api.On("HasPermissionToChannel", actorID, privateChannel, model.PermissionReadChannel).Return(false).Maybe()
	env.api.On("HasPermissionToTeam", actorID, teamID, model.PermissionViewTeam).Return(true).Maybe()

	result, err := env.service.List(actorID, taskmodel.TaskQuery{Scope: taskmodel.TaskScopeMy})
	require.NoError(t, err)
	assert.Equal(t, 2, result.Total)
	require.Len(t, result.Items, 2)
	assert.Equal(t, []string{"Open", "Team-level"}, []string{result.Items[0].Title, result.Items[1].Title})
}

func TestListTeamTasksKeepsPrivateChannelsPrivate(t *testing.T) {
	env := newTestEnv(t)
	actorID := model.NewId()
	teamID := model.NewId()
	openChannel, privateChannel := model.NewId(), model.NewId()

	storeTestTask(t, env.store, &taskmodel.Task{
		ID: model.NewId(), TeamID: teamID, ChannelID: openChannel, Title: "Open",
		CreatorID: "creator", Status: taskmodel.TaskStatusTodo, Priority: taskmodel.TaskPriorityNormal,
	})
	storeTestTask(t, env.store, &taskmodel.Task{
		ID: model.NewId(), TeamID: teamID, ChannelID: privateChannel, Title: "Private",
		CreatorID: "creator", Status: taskmodel.TaskStatusTodo, Priority: taskmodel.TaskPriorityNormal,
	})

	env.api.On("HasPermissionToTeam", actorID, teamID, model.PermissionViewTeam).Return(true).Maybe()
	env.api.On("HasPermissionToChannel", actorID, openChannel, model.PermissionReadChannel).Return(true).Maybe()
	env.api.On("HasPermissionToChannel", actorID, privateChannel, model.PermissionReadChannel).Return(false).Maybe()

	result, err := env.service.List(actorID, taskmodel.TaskQuery{Scope: taskmodel.TaskScopeTeam, TeamID: teamID})
	require.NoError(t, err)
	assert.Equal(t, 1, result.Total)
	require.Len(t, result.Items, 1)
	assert.Equal(t, "Open", result.Items[0].Title)
}

func TestListAllTasks(t *testing.T) {
	env := newTestEnv(t)
	actorID := model.NewId()
	teamA, teamB := model.NewId(), model.NewId()
	channelA := model.NewId()

	storeTestTask(t, env.store, &taskmodel.Task{
		ID: model.NewId(), TeamID: teamA, ChannelID: channelA, Title: "A",
		CreatorID: "creator", Status: taskmodel.TaskStatusTodo, Priority: taskmodel.TaskPriorityNormal,
	})
	storeTestTask(t, env.store, &taskmodel.Task{
		ID: model.NewId(), TeamID: teamB, Title: "B",
		CreatorID: "creator", Status: taskmodel.TaskStatusTodo, Priority: taskmodel.TaskPriorityNormal,
	})

	env.api.On("GetTeamsForUser", actorID).Return([]*model.Team{{Id: teamA}, {Id: teamB}}, nil)
	env.api.On("HasPermissionToChannel", actorID, channelA, model.PermissionReadChannel).Return(true).Maybe()
	env.api.On("HasPermissionToTeam", actorID, teamA, model.PermissionViewTeam).Return(true).Maybe()
	env.api.On("HasPermissionToTeam", actorID, teamB, model.PermissionViewTeam).Return(true).Maybe()

	result, err := env.service.List(actorID, taskmodel.TaskQuery{Scope: taskmodel.TaskScopeAll})
	require.NoError(t, err)
	assert.Equal(t, 2, result.Total)
}

func TestUpdateStatusPermissions(t *testing.T) {
	env := newTestEnv(t)
	creatorID, assigneeID, strangerID := model.NewId(), model.NewId(), model.NewId()
	teamID, channelID := model.NewId(), model.NewId()
	task := storeTestTask(t, env.store, &taskmodel.Task{
		ID: model.NewId(), TeamID: teamID, ChannelID: channelID, Title: "Status",
		CreatorID: creatorID, AssigneeIDs: []string{assigneeID}, Status: taskmodel.TaskStatusTodo,
		Priority: taskmodel.TaskPriorityNormal,
	})
	env.api.On("HasPermissionToChannel", assigneeID, channelID, model.PermissionReadChannel).Return(true).Maybe()
	denyAdmin(env.api, assigneeID)

	done := taskmodel.TaskStatusDone
	updated, err := env.service.Update(nil, "/tasks", assigneeID, task.ID, taskmodel.TaskPatch{Status: &done})
	require.NoError(t, err)
	assert.Equal(t, taskmodel.TaskStatusDone, updated.Status)
	assert.NotZero(t, updated.CompletedAt)
	assert.Equal(t, int64(2), updated.Version)
	assert.Equal(t, []string{"updated"}, env.publisher.events)

	env.api.On("HasPermissionToChannel", strangerID, channelID, model.PermissionReadChannel).Return(true).Maybe()
	denyAdmin(env.api, strangerID)
	todo := taskmodel.TaskStatusTodo
	_, err = env.service.Update(nil, "/tasks", strangerID, task.ID, taskmodel.TaskPatch{Status: &todo})
	assert.ErrorIs(t, err, taskmodel.ErrForbidden)
}

func TestUpdateMetadataOnlyCreatorOrAdmin(t *testing.T) {
	env := newTestEnv(t)
	creatorID, assigneeID, adminID := model.NewId(), model.NewId(), model.NewId()
	teamID, channelID := model.NewId(), model.NewId()
	task := storeTestTask(t, env.store, &taskmodel.Task{
		ID: model.NewId(), TeamID: teamID, ChannelID: channelID, Title: "Original",
		CreatorID: creatorID, AssigneeIDs: []string{assigneeID}, Status: taskmodel.TaskStatusTodo,
		Priority: taskmodel.TaskPriorityNormal,
	})
	env.api.On("HasPermissionToChannel", creatorID, channelID, model.PermissionReadChannel).Return(true).Maybe()
	denyAdmin(env.api, creatorID)
	env.api.On("HasPermissionToChannel", assigneeID, channelID, model.PermissionReadChannel).Return(true).Maybe()
	denyAdmin(env.api, assigneeID)
	env.api.On("HasPermissionToChannel", adminID, channelID, model.PermissionReadChannel).Return(true).Maybe()
	allowAdmin(env.api, adminID)

	title := "renamed"
	_, err := env.service.Update(nil, "/tasks", assigneeID, task.ID, taskmodel.TaskPatch{Title: &title})
	assert.ErrorIs(t, err, taskmodel.ErrForbidden)

	updated, err := env.service.Update(nil, "/tasks", creatorID, task.ID, taskmodel.TaskPatch{Title: &title})
	require.NoError(t, err)
	assert.Equal(t, "renamed", updated.Title)

	adminTitle := "admin renamed"
	updated, err = env.service.Update(nil, "/tasks", adminID, task.ID, taskmodel.TaskPatch{Title: &adminTitle})
	require.NoError(t, err)
	assert.Equal(t, "admin renamed", updated.Title)
}

func TestUpdateAssigneesNotifiesOnlyNewUsers(t *testing.T) {
	env := newTestEnv(t)
	creatorID, firstID, secondID := model.NewId(), model.NewId(), model.NewId()
	teamID, channelID := model.NewId(), model.NewId()
	allowChannel(env.api, creatorID, channelID, teamID)
	allowChannel(env.api, firstID, channelID, teamID)
	allowChannel(env.api, secondID, channelID, teamID)
	denyAdmin(env.api, creatorID)

	task, err := env.service.Create(nil, "/tasks", creatorID, taskmodel.CreateTaskInput{
		ChannelID:   channelID,
		Title:       "Assign",
		AssigneeIDs: []string{firstID},
	})
	require.NoError(t, err)
	require.Len(t, env.notifier.notifications, 1)

	assignees := []string{firstID, secondID}
	_, err = env.service.Update(nil, "/tasks", creatorID, task.ID, taskmodel.TaskPatch{AssigneeIDs: &assignees})
	require.NoError(t, err)
	require.Len(t, env.notifier.notifications, 2)
	assert.Equal(t, []string{secondID}, env.notifier.notifications[1].users)

	// Repeating the same assignment list must not notify anyone.
	_, err = env.service.Update(nil, "/tasks", creatorID, task.ID, taskmodel.TaskPatch{AssigneeIDs: &assignees})
	require.NoError(t, err)
	assert.Len(t, env.notifier.notifications, 2)
}

func TestUpdateRejectsAssigneeLosingScopeAccess(t *testing.T) {
	env := newTestEnv(t)
	creatorID, assigneeID := model.NewId(), model.NewId()
	teamA, teamB := model.NewId(), model.NewId()
	channelA, channelB := model.NewId(), model.NewId()
	task := storeTestTask(t, env.store, &taskmodel.Task{
		ID: model.NewId(), TeamID: teamA, ChannelID: channelA, Title: "Move",
		CreatorID: creatorID, AssigneeIDs: []string{assigneeID}, Status: taskmodel.TaskStatusTodo,
		Priority: taskmodel.TaskPriorityNormal,
	})
	env.api.On("GetChannel", channelA).Return(&model.Channel{Id: channelA, TeamId: teamA, Type: model.ChannelTypeOpen}, nil).Maybe()
	env.api.On("HasPermissionToChannel", creatorID, channelA, model.PermissionReadChannel).Return(true).Maybe()
	env.api.On("HasPermissionToChannel", creatorID, channelB, model.PermissionReadChannel).Return(true).Maybe()
	env.api.On("GetChannel", channelB).Return(&model.Channel{Id: channelB, TeamId: teamB, Type: model.ChannelTypePrivate}, nil).Maybe()
	env.api.On("HasPermissionToChannel", assigneeID, channelB, model.PermissionReadChannel).Return(false).Maybe()
	denyAdmin(env.api, creatorID)

	teamBValue, channelBValue := teamB, channelB
	_, err := env.service.Update(nil, "/tasks", creatorID, task.ID, taskmodel.TaskPatch{
		TeamID:    &teamBValue,
		ChannelID: &channelBValue,
	})
	assert.ErrorIs(t, err, taskmodel.ErrInvalid)

	// Updating the assignees to someone eligible and then moving is allowed.
	removeAssignee := []string{}
	_, err = env.service.Update(nil, "/tasks", creatorID, task.ID, taskmodel.TaskPatch{AssigneeIDs: &removeAssignee})
	require.NoError(t, err)
	moved, err := env.service.Update(nil, "/tasks", creatorID, task.ID, taskmodel.TaskPatch{
		TeamID:    &teamBValue,
		ChannelID: &channelBValue,
	})
	require.NoError(t, err)
	assert.Equal(t, teamB, moved.TeamID)
	assert.Equal(t, channelB, moved.ChannelID)

	oldRefs, err := env.store.ListTaskRefsByChannel(channelA)
	require.NoError(t, err)
	assert.Empty(t, oldRefs)
	newRefs, err := env.store.ListTaskRefsByChannel(channelB)
	require.NoError(t, err)
	require.Len(t, newRefs, 1)
}

func TestDeletePermissions(t *testing.T) {
	env := newTestEnv(t)
	creatorID, assigneeID, adminID, strangerID := model.NewId(), model.NewId(), model.NewId(), model.NewId()
	teamID, channelID := model.NewId(), model.NewId()
	task := storeTestTask(t, env.store, &taskmodel.Task{
		ID: model.NewId(), TeamID: teamID, ChannelID: channelID, Title: "Delete",
		CreatorID: creatorID, AssigneeIDs: []string{assigneeID}, Status: taskmodel.TaskStatusTodo,
		Priority: taskmodel.TaskPriorityNormal,
	})
	env.api.On("HasPermissionToChannel", creatorID, channelID, model.PermissionReadChannel).Return(true).Maybe()
	denyAdmin(env.api, creatorID)
	env.api.On("HasPermissionToChannel", assigneeID, channelID, model.PermissionReadChannel).Return(true).Maybe()
	denyAdmin(env.api, assigneeID)
	env.api.On("HasPermissionToChannel", adminID, channelID, model.PermissionReadChannel).Return(true).Maybe()
	allowAdmin(env.api, adminID)
	env.api.On("HasPermissionToChannel", strangerID, channelID, model.PermissionReadChannel).Return(false).Maybe()

	assert.ErrorIs(t, env.service.Delete(nil, "/tasks", assigneeID, task.ID), taskmodel.ErrForbidden)
	assert.ErrorIs(t, env.service.Delete(nil, "/tasks", strangerID, task.ID), taskmodel.ErrNotFound)
	require.NoError(t, env.service.Delete(nil, "/tasks", creatorID, task.ID))
	_, err := env.store.GetTask(task.ID)
	assert.ErrorIs(t, err, kvstore.ErrNotFound)
}
