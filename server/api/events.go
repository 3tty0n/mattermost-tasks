package api

import (
	"fmt"
	"net/http"

	"github.com/gorilla/mux"
	"github.com/mattermost/mattermost/server/public/model"

	taskmodel "github.com/3tty0n/mattermost-tasks/server/model"
)

type createEventRequest struct {
	TeamID      string                     `json:"teamId"`
	ChannelID   string                     `json:"channelId"`
	Visibility  string                     `json:"visibility"`
	Title       string                     `json:"title"`
	Description string                     `json:"description"`
	Location    string                     `json:"location"`
	AssigneeIDs []string                   `json:"assigneeIds"`
	StartAt     int64                      `json:"startAt"`
	EndAt       int64                      `json:"endAt"`
	AllDay      bool                       `json:"allDay"`
	TimeZone    string                     `json:"timezone"`
	Recurrence  *taskmodel.EventRecurrence `json:"recurrence"`
	Reminders   []int                      `json:"reminders"`
}

func (req createEventRequest) input() taskmodel.CreateEventInput {
	return taskmodel.CreateEventInput{
		TeamID:      req.TeamID,
		ChannelID:   req.ChannelID,
		Visibility:  req.Visibility,
		Title:       req.Title,
		Description: req.Description,
		Location:    req.Location,
		AssigneeIDs: req.AssigneeIDs,
		StartAt:     req.StartAt,
		EndAt:       req.EndAt,
		AllDay:      req.AllDay,
		TimeZone:    req.TimeZone,
		Recurrence:  req.Recurrence,
		Reminders:   req.Reminders,
	}
}

type updateEventRequest struct {
	TeamID      *string                    `json:"teamId"`
	ChannelID   *string                    `json:"channelId"`
	Visibility  *string                    `json:"visibility"`
	Title       *string                    `json:"title"`
	Description *string                    `json:"description"`
	Location    *string                    `json:"location"`
	AssigneeIDs *[]string                  `json:"assigneeIds"`
	StartAt     *int64                     `json:"startAt"`
	EndAt       *int64                     `json:"endAt"`
	AllDay      *bool                      `json:"allDay"`
	TimeZone    *string                    `json:"timezone"`
	Recurrence  *taskmodel.EventRecurrence `json:"recurrence"`
	Reminders   *[]int                     `json:"reminders"`
}

func (req updateEventRequest) patch() taskmodel.EventPatch {
	return taskmodel.EventPatch{
		TeamID:      req.TeamID,
		ChannelID:   req.ChannelID,
		Visibility:  req.Visibility,
		Title:       req.Title,
		Description: req.Description,
		Location:    req.Location,
		AssigneeIDs: req.AssigneeIDs,
		StartAt:     req.StartAt,
		EndAt:       req.EndAt,
		AllDay:      req.AllDay,
		TimeZone:    req.TimeZone,
		Recurrence:  req.Recurrence,
		Reminders:   req.Reminders,
	}
}

func (h *Handler) handleListEvents(w http.ResponseWriter, r *http.Request) {
	query, err := eventQueryFromRequest(r)
	if err != nil {
		writeServiceError(w, r, err, "Failed to list events")
		return
	}
	result, err := h.events.List(actorID(r), query)
	if err != nil {
		writeServiceError(w, r, err, "Failed to list events")
		return
	}
	writeJSON(w, r, http.StatusOK, result)
}

func (h *Handler) handleCreateEvent(w http.ResponseWriter, r *http.Request) {
	var req createEventRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusBadRequest, "Invalid request body", nil)
		return
	}
	event, err := h.events.Create(pluginContext(r), r.URL.Path, actorID(r), req.input())
	if err != nil {
		writeServiceError(w, r, err, "Failed to create the event")
		return
	}
	writeJSON(w, r, http.StatusCreated, event)
}

func (h *Handler) handleGetEvent(w http.ResponseWriter, r *http.Request) {
	id, ok := eventIDFromPath(w, r)
	if !ok {
		return
	}
	event, err := h.events.Get(actorID(r), id)
	if err != nil {
		writeServiceError(w, r, err, "Failed to load the event")
		return
	}
	writeJSON(w, r, http.StatusOK, event)
}

func (h *Handler) handleUpdateEvent(w http.ResponseWriter, r *http.Request) {
	id, ok := eventIDFromPath(w, r)
	if !ok {
		return
	}
	var req updateEventRequest
	if err := decodeJSON(r, &req); err != nil {
		writeError(w, r, http.StatusBadRequest, "Invalid request body", nil)
		return
	}
	event, err := h.events.Update(pluginContext(r), r.URL.Path, actorID(r), id, req.patch())
	if err != nil {
		writeServiceError(w, r, err, "Failed to update the event")
		return
	}
	writeJSON(w, r, http.StatusOK, event)
}

func (h *Handler) handleDeleteEvent(w http.ResponseWriter, r *http.Request) {
	id, ok := eventIDFromPath(w, r)
	if !ok {
		return
	}
	if err := h.events.Delete(pluginContext(r), r.URL.Path, actorID(r), id); err != nil {
		writeServiceError(w, r, err, "Failed to delete the event")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func eventQueryFromRequest(r *http.Request) (taskmodel.EventQuery, error) {
	query := r.URL.Query()
	page, perPage, err := parsePage(query)
	if err != nil {
		return taskmodel.EventQuery{}, err
	}
	from, err := parseOptionalInt64(query, "from")
	if err != nil {
		return taskmodel.EventQuery{}, err
	}
	to, err := parseOptionalInt64(query, "to")
	if err != nil {
		return taskmodel.EventQuery{}, err
	}
	if from == nil || to == nil {
		return taskmodel.EventQuery{}, fmt.Errorf("%w: from and to are required", taskmodel.ErrInvalid)
	}
	return taskmodel.EventQuery{
		Scope:            taskmodel.TaskScope(firstValue(query, "scope")),
		TeamID:           firstValue(query, "team_id"),
		From:             *from,
		To:               *to,
		Page:             page,
		PerPage:          perPage,
		IncludeRecurring: firstValue(query, "include_recurring") == "true",
	}, nil
}

func eventIDFromPath(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := mux.Vars(r)["event_id"]
	if !model.IsValidId(id) {
		writeError(w, r, http.StatusNotFound, "Not found", nil)
		return "", false
	}
	return id, true
}
