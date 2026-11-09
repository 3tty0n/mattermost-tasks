package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	taskmodel "github.com/3tty0n/mattermost-tasks/server/model"
)

type createTaskRequest struct {
	TeamID       string   `json:"teamId"`
	ChannelID    string   `json:"channelId"`
	Visibility   string   `json:"visibility"`
	Title        string   `json:"title"`
	Description  string   `json:"description"`
	AssigneeIDs  []string `json:"assigneeIds"`
	Status       string   `json:"status"`
	Priority     string   `json:"priority"`
	DueAt        int64    `json:"dueAt"`
	DueHasTime   bool     `json:"dueHasTime"`
	SourcePostID string   `json:"sourcePostId"`
	ParentTaskID string   `json:"parentTaskId"`
}

func (req createTaskRequest) input() taskmodel.CreateTaskInput {
	return taskmodel.CreateTaskInput{
		TeamID:       req.TeamID,
		ChannelID:    req.ChannelID,
		Visibility:   req.Visibility,
		Title:        req.Title,
		Description:  req.Description,
		AssigneeIDs:  req.AssigneeIDs,
		Status:       req.Status,
		Priority:     req.Priority,
		DueAt:        req.DueAt,
		DueHasTime:   req.DueHasTime,
		SourcePostID: req.SourcePostID,
		ParentTaskID: req.ParentTaskID,
	}
}

type updateTaskRequest struct {
	TeamID       *string   `json:"teamId"`
	ChannelID    *string   `json:"channelId"`
	Visibility   *string   `json:"visibility"`
	Title        *string   `json:"title"`
	Description  *string   `json:"description"`
	AssigneeIDs  *[]string `json:"assigneeIds"`
	Status       *string   `json:"status"`
	Priority     *string   `json:"priority"`
	DueAt        *int64    `json:"dueAt"`
	DueHasTime   *bool     `json:"dueHasTime"`
	SourcePostID *string   `json:"sourcePostId"`
	ParentTaskID *string   `json:"parentTaskId"`
}

func (req updateTaskRequest) patch() taskmodel.TaskPatch {
	return taskmodel.TaskPatch{
		TeamID:       req.TeamID,
		ChannelID:    req.ChannelID,
		Visibility:   req.Visibility,
		Title:        req.Title,
		Description:  req.Description,
		AssigneeIDs:  req.AssigneeIDs,
		Status:       req.Status,
		Priority:     req.Priority,
		DueAt:        req.DueAt,
		DueHasTime:   req.DueHasTime,
		SourcePostID: req.SourcePostID,
		ParentTaskID: req.ParentTaskID,
	}
}

func (h *Handler) handleListTasks(w http.ResponseWriter, r *http.Request) {
	query, err := taskQueryFromRequest(r)
	if err != nil {
		writeServiceError(w, r, err, "Failed to list tasks")
		return
	}
	result, err := h.tasks.List(actorID(r), query)
	if err != nil {
		writeServiceError(w, r, err, "Failed to list tasks")
		return
	}
	writeJSON(w, r, http.StatusOK, result)
}

func (h *Handler) handleCreateTask(w http.ResponseWriter, r *http.Request) {
	var req createTaskRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusBadRequest, "Invalid request body", nil)
		return
	}
	task, err := h.tasks.Create(pluginContext(r), r.URL.Path, actorID(r), req.input())
	if err != nil {
		writeServiceError(w, r, err, "Failed to create the task")
		return
	}
	writeJSON(w, r, http.StatusCreated, task)
}

func (h *Handler) handleGetTask(w http.ResponseWriter, r *http.Request) {
	id, ok := taskIDFromPath(w, r)
	if !ok {
		return
	}
	task, err := h.tasks.Get(actorID(r), id)
	if err != nil {
		writeServiceError(w, r, err, "Failed to load the task")
		return
	}
	writeJSON(w, r, http.StatusOK, task)
}

func (h *Handler) handleUpdateTask(w http.ResponseWriter, r *http.Request) {
	id, ok := taskIDFromPath(w, r)
	if !ok {
		return
	}
	var req updateTaskRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusBadRequest, "Invalid request body", nil)
		return
	}
	task, err := h.tasks.Update(pluginContext(r), r.URL.Path, actorID(r), id, req.patch())
	if err != nil {
		writeServiceError(w, r, err, "Failed to update the task")
		return
	}
	writeJSON(w, r, http.StatusOK, task)
}

func (h *Handler) handleDeleteTask(w http.ResponseWriter, r *http.Request) {
	id, ok := taskIDFromPath(w, r)
	if !ok {
		return
	}
	if err := h.tasks.Delete(pluginContext(r), r.URL.Path, actorID(r), id); err != nil {
		writeServiceError(w, r, err, "Failed to delete the task")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func taskQueryFromRequest(r *http.Request) (taskmodel.TaskQuery, error) {
	query := r.URL.Query()
	page, perPage, err := parsePage(query)
	if err != nil {
		return taskmodel.TaskQuery{}, err
	}
	dueBefore, err := parseOptionalInt64(query, "due_before")
	if err != nil {
		return taskmodel.TaskQuery{}, err
	}
	dueAfter, err := parseOptionalInt64(query, "due_after")
	if err != nil {
		return taskmodel.TaskQuery{}, err
	}
	var hasDue *bool
	if value := firstValue(query, "has_due"); value != "" {
		parsed, err := strconv.ParseBool(value)
		if err != nil {
			return taskmodel.TaskQuery{}, fmt.Errorf("%w: invalid has-due", taskmodel.ErrInvalid)
		}
		hasDue = &parsed
	}

	return taskmodel.TaskQuery{
		Scope:      taskmodel.TaskScope(firstValue(query, "scope")),
		TeamID:     firstValue(query, "team_id"),
		ChannelID:  firstValue(query, "channel_id"),
		Statuses:   csvValues(query, "status"),
		AssigneeID: firstValue(query, "assignee_id"),
		Priority:   firstValue(query, "priority"),
		DueBefore:  dueBefore,
		DueAfter:   dueAfter,
		HasDue:     hasDue,
		SortBy:     firstValue(query, "sort"),
		Direction:  firstValue(query, "direction"),
		Page:       page,
		PerPage:    perPage,
	}, nil
}

func firstValue(query map[string][]string, name string) string {
	values := query[name]
	if len(values) == 0 {
		return ""
	}
	return strings.TrimSpace(values[0])
}

func csvValues(query map[string][]string, name string) []string {
	values := query[name]
	if len(values) == 0 {
		return nil
	}
	out := make([]string, 0, len(values))
	for _, value := range values {
		for part := range strings.SplitSeq(value, ",") {
			part = strings.TrimSpace(part)
			if part != "" {
				out = append(out, part)
			}
		}
	}
	return out
}
