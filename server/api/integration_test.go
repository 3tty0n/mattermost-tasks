package api

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/pluginapi/testhelper"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	taskmodel "github.com/3tty0n/mattermost-tasks/server/model"
	"github.com/3tty0n/mattermost-tasks/server/tasks"
)

// pluginRequest calls the deployed plugin through the Mattermost server, so the server's
// authentication and CSRF behavior are exercised as well. A nil client sends no credentials.
func pluginRequest(t *testing.T, th *testhelper.TestHelper, client *model.Client4, method, path string, body any) (*http.Response, []byte) {
	t.Helper()

	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		require.NoError(t, err)
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(t.Context(), method, th.ServerURL+"/plugins/"+testhelper.PluginID()+"/api/v1"+path, reader)
	require.NoError(t, err)
	request.Header.Set("Content-Type", "application/json")
	if client != nil {
		request.Header.Set(model.HeaderAuth, "Bearer "+client.AuthToken)
	}

	response, err := http.DefaultClient.Do(request)
	require.NoError(t, err)
	defer func() { _ = response.Body.Close() }()
	payload, err := io.ReadAll(response.Body)
	require.NoError(t, err)
	return response, payload
}

func createTaskIntegration(t *testing.T, th *testhelper.TestHelper, client *model.Client4, body map[string]any) *taskmodel.Task {
	t.Helper()
	response, payload := pluginRequest(t, th, client, http.MethodPost, "/tasks", body)
	require.Equal(t, http.StatusCreated, response.StatusCode, string(payload))
	var task taskmodel.Task
	require.NoError(t, json.Unmarshal(payload, &task))
	return &task
}

func waitForPluginRunning(t *testing.T, th *testhelper.TestHelper) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		statuses, _, err := th.AdminClient.GetPluginStatuses(t.Context())
		if err == nil {
			for _, status := range statuses {
				if status.PluginId == testhelper.PluginID() && status.State == model.PluginStateRunning {
					return
				}
			}
		}
		time.Sleep(250 * time.Millisecond)
	}
	t.Fatal("plugin did not return to the running state")
}

func restartPlugin(t *testing.T, th *testhelper.TestHelper) {
	t.Helper()
	_, err := th.AdminClient.DisablePlugin(t.Context(), testhelper.PluginID())
	require.NoError(t, err)
	_, err = th.AdminClient.EnablePlugin(t.Context(), testhelper.PluginID())
	require.NoError(t, err)
	waitForPluginRunning(t, th)
}

func TestTaskIntegration(t *testing.T) {
	th := testhelper.Setup(t)

	task := createTaskIntegration(t, th, th.Client, map[string]any{
		"channelId":   th.Channel.Id,
		"title":       "Integration task",
		"description": "created by the integration test",
		"assigneeIds": []string{th.User.Id},
		"priority":    "high",
	})
	assert.Equal(t, "Integration task", task.Title)
	assert.Equal(t, th.Team.Id, task.TeamID)
	assert.Equal(t, th.Channel.Id, task.ChannelID)
	assert.Contains(t, task.AssigneeIDs, th.User.Id)

	// My Tasks aggregates the assignment.
	response, payload := pluginRequest(t, th, th.Client, http.MethodGet, "/tasks?scope=my", nil)
	require.Equal(t, http.StatusOK, response.StatusCode, string(payload))
	var list tasks.ListResult
	require.NoError(t, json.Unmarshal(payload, &list))
	require.Len(t, list.Items, 1)
	assert.Equal(t, task.ID, list.Items[0].ID)

	// A team-level task has no channel.
	teamTask := createTaskIntegration(t, th, th.Client, map[string]any{
		"teamId": th.Team.Id,
		"title":  "Team-level task",
	})
	assert.Empty(t, teamTask.ChannelID)

	// Status updates are visible through the API.
	response, payload = pluginRequest(t, th, th.Client, http.MethodPost, "/tasks/"+task.ID, map[string]any{"status": "done"})
	require.Equal(t, http.StatusOK, response.StatusCode, string(payload))
	var updated taskmodel.Task
	require.NoError(t, json.Unmarshal(payload, &updated))
	assert.Equal(t, taskmodel.TaskStatusDone, updated.Status)
	assert.NotZero(t, updated.CompletedAt)

	// KV records survive a plugin restart (deactivate/reactivate).
	restartPlugin(t, th)
	response, payload = pluginRequest(t, th, th.Client, http.MethodGet, "/tasks/"+task.ID, nil)
	require.Equal(t, http.StatusOK, response.StatusCode, string(payload))
	var restored taskmodel.Task
	require.NoError(t, json.Unmarshal(payload, &restored))
	assert.Equal(t, taskmodel.TaskStatusDone, restored.Status)

	// Deleting is reflected immediately.
	response, _ = pluginRequest(t, th, th.Client, http.MethodDelete, "/tasks/"+task.ID, nil)
	require.Equal(t, http.StatusNoContent, response.StatusCode)
	response, payload = pluginRequest(t, th, th.Client, http.MethodGet, "/tasks/"+task.ID, nil)
	assert.Equal(t, http.StatusNotFound, response.StatusCode, string(payload))
}

func TestAssignmentNotificationIntegration(t *testing.T) {
	th := testhelper.Setup(t)

	bot, _, err := th.AdminClient.GetUserByUsername(t.Context(), "tasks-bot", "")
	require.NoError(t, err, "the plugin bot should exist after activation")

	task := createTaskIntegration(t, th, th.AdminClient, map[string]any{
		"channelId":   th.Channel.Id,
		"title":       "Notify the assignee",
		"assigneeIds": []string{th.User.Id},
	})
	require.Equal(t, "Notify the assignee", task.Title)

	direct, _, err := th.Client.CreateDirectChannel(t.Context(), th.User.Id, bot.Id)
	require.NoError(t, err)

	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		posts, _, err := th.Client.GetPostsForChannel(t.Context(), direct.Id, 0, 50, "", false, false)
		if err == nil {
			for _, postID := range posts.Order {
				post := posts.Posts[postID]
				if post != nil && post.UserId == bot.Id && strings.Contains(post.Message, "Notify the assignee") {
					assert.Contains(t, post.Message, "#task-"+task.ID)
					return
				}
			}
		}
		time.Sleep(250 * time.Millisecond)
	}
	t.Fatal("assignment notification was not delivered")
}

func TestPrivateChannelIsolationIntegration(t *testing.T) {
	th := testhelper.Setup(t)
	privateChannel := th.CreateChannel(model.ChannelTypePrivate)

	// The admin created the private channel and may create a task in it.
	privateTask := createTaskIntegration(t, th, th.AdminClient, map[string]any{
		"channelId": privateChannel.Id,
		"title":     "Secret task",
	})

	// A regular user who is not a member must not see it, even with the ID.
	response, payload := pluginRequest(t, th, th.Client, http.MethodGet, "/tasks/"+privateTask.ID, nil)
	assert.Equal(t, http.StatusNotFound, response.StatusCode, string(payload))

	response, payload = pluginRequest(t, th, th.AdminClient, http.MethodGet, "/tasks?scope=team&team_id="+th.Team.Id, nil)
	require.Equal(t, http.StatusOK, response.StatusCode, string(payload))
	var adminList tasks.ListResult
	require.NoError(t, json.Unmarshal(payload, &adminList))
	foundPrivate := false
	for _, item := range adminList.Items {
		if item.ID == privateTask.ID {
			foundPrivate = true
		}
	}
	assert.True(t, foundPrivate, "the creator's team view includes their private task")

	response, payload = pluginRequest(t, th, th.Client, http.MethodGet, "/tasks?scope=team&team_id="+th.Team.Id, nil)
	require.Equal(t, http.StatusOK, response.StatusCode, string(payload))
	var list tasks.ListResult
	require.NoError(t, json.Unmarshal(payload, &list))
	for _, item := range list.Items {
		assert.NotEqual(t, privateTask.ID, item.ID)
	}

	// The unauthenticated plugin route is rejected before the service runs.
	response, _ = pluginRequest(t, th, nil, http.MethodGet, "/tasks?scope=my", nil)
	assert.Equal(t, http.StatusUnauthorized, response.StatusCode)
}

func TestTaskVisibilityIntegration(t *testing.T) {
	th := testhelper.Setup(t)

	privateTask := createTaskIntegration(t, th, th.AdminClient, map[string]any{
		"teamId":     th.Team.Id,
		"visibility": "private",
		"title":      "Admin only",
	})
	assert.Equal(t, "private", privateTask.Visibility)
	assert.Equal(t, []string{th.AdminUser.Id}, privateTask.AssigneeIDs)

	response, payload := pluginRequest(t, th, th.Client, http.MethodGet, "/tasks/"+privateTask.ID, nil)
	assert.Equal(t, http.StatusNotFound, response.StatusCode, string(payload))

	response, payload = pluginRequest(t, th, th.AdminClient, http.MethodGet, "/tasks?scope=team&team_id="+th.Team.Id, nil)
	require.Equal(t, http.StatusOK, response.StatusCode, string(payload))
	var adminList tasks.ListResult
	require.NoError(t, json.Unmarshal(payload, &adminList))
	foundPrivate := false
	for _, item := range adminList.Items {
		if item.ID == privateTask.ID {
			foundPrivate = true
		}
	}
	assert.True(t, foundPrivate, "the creator's team view includes their private task")

	teamTask := createTaskIntegration(t, th, th.AdminClient, map[string]any{
		"teamId":     th.Team.Id,
		"visibility": "team",
		"title":      "Visible to the team",
	})
	response, payload = pluginRequest(t, th, th.Client, http.MethodGet, "/tasks/"+teamTask.ID, nil)
	require.Equal(t, http.StatusOK, response.StatusCode, string(payload))

	response, payload = pluginRequest(t, th, th.Client, http.MethodGet, "/tasks?scope=team&team_id="+th.Team.Id, nil)
	require.Equal(t, http.StatusOK, response.StatusCode, string(payload))
	var list tasks.ListResult
	require.NoError(t, json.Unmarshal(payload, &list))
	foundTeamTask := false
	for _, item := range list.Items {
		assert.NotEqual(t, privateTask.ID, item.ID)
		if item.ID == teamTask.ID {
			foundTeamTask = true
		}
	}
	assert.True(t, foundTeamTask, "a team-visible task should be listed for a team member")
}
