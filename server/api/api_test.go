package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/3tty0n/mattermost-tasks/server/access"
	taskmodel "github.com/3tty0n/mattermost-tasks/server/model"
	"github.com/3tty0n/mattermost-tasks/server/store/kvstore"
	"github.com/3tty0n/mattermost-tasks/server/tasks"
	"github.com/3tty0n/mattermost-tasks/server/testutil"
)

type noopPublisher struct{}

func (noopPublisher) TaskChanged(string, *taskmodel.Task) {}

type apiTestEnv struct {
	handler *Handler
	api     *testutil.API
	store   kvstore.Store
	tasks   *tasks.Service
}

func newAPITestEnv(t *testing.T) *apiTestEnv {
	t.Helper()
	api := testutil.NewAPI()
	t.Cleanup(func() { api.AssertExpectations(t) })
	client := pluginapi.NewClient(api, &plugintest.Driver{})
	checker := access.NewChecker(client)
	store := kvstore.NewStoreWithKV(kvstore.NewMemoryKV())
	publisher := noopPublisher{}
	taskService := tasks.NewService(client, store, checker, publisher, nil, tasks.WithClock(func() int64 { return 1000 }))
	return &apiTestEnv{
		handler: NewHandler(api, client, checker, taskService),
		api:     api,
		store:   store,
		tasks:   taskService,
	}
}

func (e *apiTestEnv) serve(method, path, body, userID string) *httptest.ResponseRecorder {
	var reader *strings.Reader
	if body == "" {
		reader = strings.NewReader("")
	} else {
		reader = strings.NewReader(body)
	}
	r := httptest.NewRequest(method, path, reader)
	if userID != "" {
		r.Header.Set("Mattermost-User-ID", userID)
	}
	w := httptest.NewRecorder()
	e.handler.ServeHTTP(nil, w, r)
	return w
}

func decodeResponse[T any](t *testing.T, w *httptest.ResponseRecorder) T {
	t.Helper()
	var out T
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &out), w.Body.String())
	return out
}

func allowChannel(api *testutil.API, userID, channelID, teamID string) {
	api.On("GetChannel", channelID).Return(&model.Channel{Id: channelID, TeamId: teamID, Type: model.ChannelTypeOpen}, nil).Maybe()
	api.On("HasPermissionToChannel", userID, channelID, model.PermissionReadChannel).Return(true).Maybe()
}

func denyAdmin(api *testutil.API, userID string) {
	api.On("HasPermissionTo", userID, model.PermissionManageSystem).Return(false).Maybe()
}

func TestAllRoutesRejectUnauthenticatedRequests(t *testing.T) {
	env := newAPITestEnv(t)
	id := model.NewId()
	routes := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v1/tasks"},
		{http.MethodPost, "/api/v1/tasks"},
		{http.MethodGet, "/api/v1/tasks/" + id},
		{http.MethodPatch, "/api/v1/tasks/" + id},
		{http.MethodDelete, "/api/v1/tasks/" + id},
		{http.MethodGet, "/api/v1/assignees"},
	}
	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			w := env.serve(route.method, route.path, "", "")
			assert.Equal(t, http.StatusUnauthorized, w.Code)
		})
	}
}

func TestTaskAPILifecycle(t *testing.T) {
	env := newAPITestEnv(t)
	teamID, channelID := model.NewId(), model.NewId()
	creatorID, assigneeID, strangerID := model.NewId(), model.NewId(), model.NewId()
	allowChannel(env.api, creatorID, channelID, teamID)
	allowChannel(env.api, assigneeID, channelID, teamID)
	denyAdmin(env.api, creatorID)
	env.api.On("HasPermissionToChannel", strangerID, channelID, model.PermissionReadChannel).Return(false).Maybe()

	createBody := `{"channelId":"` + channelID + `","title":"Ship the release","assigneeIds":["` + assigneeID + `"],"priority":"high","dueAt":2000}`
	w := env.serve(http.MethodPost, "/api/v1/tasks", createBody, creatorID)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	created := decodeResponse[taskmodel.Task](t, w)
	assert.Equal(t, "Ship the release", created.Title)
	assert.Equal(t, teamID, created.TeamID)
	assert.Equal(t, channelID, created.ChannelID)
	assert.Equal(t, []string{assigneeID}, created.AssigneeIDs)

	w = env.serve(http.MethodGet, "/api/v1/tasks/"+created.ID, "", creatorID)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	got := decodeResponse[taskmodel.Task](t, w)
	assert.Equal(t, created.ID, got.ID)

	w = env.serve(http.MethodGet, "/api/v1/tasks/"+created.ID, "", strangerID)
	assert.Equal(t, http.StatusNotFound, w.Code)

	w = env.serve(http.MethodGet, "/api/v1/tasks?scope=channel&channel_id="+channelID, "", creatorID)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	list := decodeResponse[tasks.ListResult](t, w)
	assert.Equal(t, 1, list.Total)
	require.Len(t, list.Items, 1)
	assert.Equal(t, "Ship the release", list.Items[0].Title)

	w = env.serve(http.MethodPost, "/api/v1/tasks/"+created.ID, `{"status":"in_progress"}`, creatorID)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.Equal(t, taskmodel.TaskStatusInProgress, decodeResponse[taskmodel.Task](t, w).Status)

	w = env.serve(http.MethodPatch, "/api/v1/tasks/"+created.ID, `{"status":"done"}`, creatorID)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	patched := decodeResponse[taskmodel.Task](t, w)
	assert.Equal(t, taskmodel.TaskStatusDone, patched.Status)
	assert.NotZero(t, patched.CompletedAt)

	w = env.serve(http.MethodDelete, "/api/v1/tasks/"+created.ID, "", creatorID)
	require.Equal(t, http.StatusNoContent, w.Code, w.Body.String())

	w = env.serve(http.MethodGet, "/api/v1/tasks/"+created.ID, "", creatorID)
	assert.Equal(t, http.StatusNotFound, w.Code)
}

func TestTaskAPIValidationAndPermissions(t *testing.T) {
	env := newAPITestEnv(t)
	teamID, channelID := model.NewId(), model.NewId()
	actorID := model.NewId()
	allowChannel(env.api, actorID, channelID, teamID)

	t.Run("invalid JSON", func(t *testing.T) {
		w := env.serve(http.MethodPost, "/api/v1/tasks", `{"title":`, actorID)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("unknown field", func(t *testing.T) {
		w := env.serve(http.MethodPost, "/api/v1/tasks", `{"title":"x","bogus":true}`, actorID)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("missing title", func(t *testing.T) {
		w := env.serve(http.MethodPost, "/api/v1/tasks", `{"channelId":"`+channelID+`"}`, actorID)
		assert.Equal(t, http.StatusBadRequest, w.Code)
		assert.Contains(t, w.Body.String(), "title is required")
	})

	t.Run("empty patch", func(t *testing.T) {
		id := model.NewId()
		w := env.serve(http.MethodPatch, "/api/v1/tasks/"+id, `{}`, actorID)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})

	t.Run("invalid task id", func(t *testing.T) {
		w := env.serve(http.MethodGet, "/api/v1/tasks/not-an-id", "", actorID)
		assert.Equal(t, http.StatusNotFound, w.Code)
	})

	t.Run("team list forbidden", func(t *testing.T) {
		env.api.On("HasPermissionToTeam", actorID, teamID, model.PermissionViewTeam).Return(false).Maybe()
		w := env.serve(http.MethodGet, "/api/v1/tasks?scope=team&team_id="+teamID, "", actorID)
		assert.Equal(t, http.StatusForbidden, w.Code)
	})

	t.Run("invalid pagination", func(t *testing.T) {
		w := env.serve(http.MethodGet, "/api/v1/tasks?scope=my&page=abc", "", actorID)
		assert.Equal(t, http.StatusBadRequest, w.Code)
	})
}

func TestAssigneesAPI(t *testing.T) {
	env := newAPITestEnv(t)
	teamID, channelID := model.NewId(), model.NewId()
	actorID := model.NewId()
	allowChannel(env.api, actorID, channelID, teamID)

	users := []*model.User{
		{Id: model.NewId(), Username: "alice", FirstName: "Alice"},
		{Id: model.NewId(), Username: "deleted", DeleteAt: 1},
		{Id: model.NewId(), Username: "bot", IsBot: true},
	}
	env.api.On("GetUsersInChannel", channelID, "", 0, maxAssigneeResults).Return(users, nil).Maybe()

	w := env.serve(http.MethodGet, "/api/v1/assignees?channel_id="+channelID, "", actorID)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	result := decodeResponse[[]assigneeResponse](t, w)
	require.Len(t, result, 1)
	assert.Equal(t, "alice", result[0].Username)

	env.api.On("HasPermissionToTeam", actorID, teamID, model.PermissionViewTeam).Return(true).Maybe()
	env.api.On("SearchUsers", &model.UserSearch{
		Term:          "bob",
		TeamId:        teamID,
		InChannelId:   channelID,
		AllowInactive: false,
		Limit:         maxAssigneeResults,
	}).Return([]*model.User{{Id: model.NewId(), Username: "bob"}}, nil).Maybe()
	w = env.serve(http.MethodGet, "/api/v1/assignees?team_id="+teamID+"&channel_id="+channelID+"&q=bob", "", actorID)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	result = decodeResponse[[]assigneeResponse](t, w)
	require.Len(t, result, 1)
	assert.Equal(t, "bob", result[0].Username)

	// First-name search falls back to the member directory if user search returns no hits.
	env.api.On("SearchUsers", &model.UserSearch{
		Term:          "alice",
		TeamId:        teamID,
		InChannelId:   channelID,
		AllowInactive: false,
		Limit:         maxAssigneeResults,
	}).Return([]*model.User{}, nil).Maybe()
	w = env.serve(http.MethodGet, "/api/v1/assignees?team_id="+teamID+"&channel_id="+channelID+"&q=alice", "", actorID)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	result = decodeResponse[[]assigneeResponse](t, w)
	require.Len(t, result, 1)
	assert.Equal(t, "alice", result[0].Username)

	w = env.serve(http.MethodGet, "/api/v1/assignees", "", actorID)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestAPISetsNoStoreAndContentType(t *testing.T) {
	env := newAPITestEnv(t)
	actorID := model.NewId()
	env.api.On("HasPermissionToTeam", actorID, model.NewId(), model.PermissionViewTeam).Return(false).Maybe()

	w := env.serve(http.MethodGet, "/api/v1/tasks?scope=my", "", actorID)
	assert.Equal(t, "no-store", w.Header().Get("Cache-Control"))
	assert.Equal(t, "nosniff", w.Header().Get("X-Content-Type-Options"))
	assert.Equal(t, "application/json", w.Header().Get("Content-Type"))
}

func TestTaskAPIDueTime(t *testing.T) {
	env := newAPITestEnv(t)
	teamID, channelID := model.NewId(), model.NewId()
	actorID := model.NewId()
	allowChannel(env.api, actorID, channelID, teamID)
	denyAdmin(env.api, actorID)

	body := `{"channelId":"` + channelID + `","title":"Timed","dueAt":1767225600000,"dueHasTime":true}`
	w := env.serve(http.MethodPost, "/api/v1/tasks", body, actorID)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	created := decodeResponse[taskmodel.Task](t, w)
	assert.True(t, created.DueHasTime)
	assert.Equal(t, int64(1767225600000), created.DueAt)

	w = env.serve(http.MethodPost, "/api/v1/tasks/"+created.ID, `{"dueAt":0}`, actorID)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	cleared := decodeResponse[taskmodel.Task](t, w)
	assert.False(t, cleared.DueHasTime)
	assert.Zero(t, cleared.DueAt)

	w = env.serve(http.MethodPost, "/api/v1/tasks/"+created.ID, `{"dueHasTime":true}`, actorID)
	assert.Equal(t, http.StatusBadRequest, w.Code)

	w = env.serve(http.MethodPost, "/api/v1/tasks/"+created.ID, `{"dueAt":1767225600000,"dueHasTime":false}`, actorID)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.False(t, decodeResponse[taskmodel.Task](t, w).DueHasTime)
}

func TestTaskAPIVisibility(t *testing.T) {
	env := newAPITestEnv(t)
	teamID, channelID := model.NewId(), model.NewId()
	creatorID, otherID := model.NewId(), model.NewId()
	allowChannel(env.api, creatorID, channelID, teamID)
	env.api.On("GetTeam", teamID).Return(&model.Team{Id: teamID}, nil).Maybe()
	env.api.On("HasPermissionToTeam", creatorID, teamID, model.PermissionViewTeam).Return(true).Maybe()
	denyAdmin(env.api, creatorID)

	body := `{"teamId":"` + teamID + `","visibility":"private","title":"Only me"}`
	w := env.serve(http.MethodPost, "/api/v1/tasks", body, creatorID)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	privateTask := decodeResponse[taskmodel.Task](t, w)
	assert.Equal(t, taskmodel.TaskVisibilityPrivate, privateTask.Visibility)
	assert.Equal(t, []string{creatorID}, privateTask.AssigneeIDs)

	w = env.serve(http.MethodGet, "/api/v1/tasks/"+privateTask.ID, "", otherID)
	assert.Equal(t, http.StatusNotFound, w.Code)

	w = env.serve(http.MethodGet, "/api/v1/tasks?scope=my", "", creatorID)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	list := decodeResponse[tasks.ListResult](t, w)
	require.Len(t, list.Items, 1)
	assert.Equal(t, privateTask.ID, list.Items[0].ID)

	teamVisibility := `{"teamId":"` + teamID + `","visibility":"team","title":"Everyone"}`
	w = env.serve(http.MethodPost, "/api/v1/tasks", teamVisibility, creatorID)
	require.Equal(t, http.StatusCreated, w.Code, w.Body.String())
	teamTask := decodeResponse[taskmodel.Task](t, w)
	assert.Equal(t, taskmodel.TaskVisibilityTeam, teamTask.Visibility)
	assert.Empty(t, teamTask.ChannelID)

	w = env.serve(http.MethodGet, "/api/v1/tasks?scope=team&team_id="+teamID, "", creatorID)
	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	list = decodeResponse[tasks.ListResult](t, w)
	assert.Equal(t, 1, list.Total, "the private task must not appear in the team index")
}
