package events

import (
	"errors"
	"fmt"
	"slices"

	mmodel "github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/mattermost/mattermost/server/public/pluginapi"

	"github.com/3tty0n/mattermost-tasks/server/access"
	"github.com/3tty0n/mattermost-tasks/server/model"
	"github.com/3tty0n/mattermost-tasks/server/store/kvstore"
)

// EventPublisher sends WebSocket change events for calendar events.
type EventPublisher interface {
	EventChanged(action string, event *model.Event)
}

// EventService implements event use cases. Events share visibility and access rules with tasks
// but have no completion state, priority or assignees.
type EventService struct {
	client    *pluginapi.Client
	store     kvstore.EventStore
	access    *access.Checker
	publisher EventPublisher
	now       func() int64
}

// EventOption configures an EventService.
type EventOption func(*EventService)

// WithEventClock replaces the timestamp source, for tests.
func WithEventClock(now func() int64) EventOption {
	return func(s *EventService) {
		s.now = now
	}
}

// NewEventService returns an event service.
func NewEventService(client *pluginapi.Client, store kvstore.EventStore, checker *access.Checker, publisher EventPublisher, opts ...EventOption) *EventService {
	s := &EventService{
		client:    client,
		store:     store,
		access:    checker,
		publisher: publisher,
		now:       mmodel.GetMillis,
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// EventListResult is a page of event summaries.
type EventListResult struct {
	Items   []model.EventSummary `json:"items"`
	Total   int                  `json:"total"`
	Page    int                  `json:"page"`
	PerPage int                  `json:"perPage"`
	HasMore bool                 `json:"hasMore"`
}

// Create validates and stores an event.
func (s *EventService) Create(c *plugin.Context, path, actorID string, input model.CreateEventInput) (*model.Event, error) {
	if !mmodel.IsValidId(actorID) {
		return nil, model.ErrForbidden
	}
	rec := s.audit(c, "createEvent", actorID, path)
	defer s.recordAudit(rec)

	title, err := model.NormalizeTitle(input.Title)
	if err != nil {
		return nil, err
	}
	description, err := model.NormalizeDescription(input.Description)
	if err != nil {
		return nil, err
	}
	visibility := input.Visibility
	if visibility == "" {
		visibility = model.DefaultTaskVisibility(input.ChannelID)
	}
	if !model.IsValidEventVisibility(visibility) {
		return nil, fmt.Errorf("%w: unknown visibility", model.ErrInvalid)
	}
	startAt, endAt, err := model.NormalizeEventTimes(input.StartAt, input.EndAt, input.AllDay)
	if err != nil {
		return nil, err
	}
	timeZone, err := model.NormalizeTimeZone(input.TimeZone)
	if err != nil {
		return nil, err
	}
	assigneeIDs, err := model.NormalizeIDs(input.AssigneeIDs, "assignees", model.MaxAssignees)
	if err != nil {
		return nil, err
	}

	teamID, channelID := input.TeamID, input.ChannelID
	if visibility != model.TaskVisibilityChannel {
		channelID = ""
	}
	if visibility == model.TaskVisibilityChannel && channelID == "" {
		return nil, fmt.Errorf("%w: channel visibility requires a channel", model.ErrInvalid)
	}
	scope, err := s.access.Resolve(actorID, teamID, channelID)
	if err != nil {
		return nil, err
	}
	teamID = scope.TeamID
	if visibility == model.TaskVisibilityChannel {
		channelID = scope.ChannelID
	} else {
		channelID = ""
	}
	if visibility == model.TaskVisibilityPrivate {
		assigneeIDs = []string{actorID}
	}
	if err := s.validateAssignees(scope, assigneeIDs); err != nil {
		return nil, err
	}

	now := s.now()
	event := &model.Event{
		ID:          mmodel.NewId(),
		TeamID:      teamID,
		ChannelID:   channelID,
		Visibility:  visibility,
		CreatorID:   actorID,
		AssigneeIDs: assigneeIDs,
		Title:       title,
		Description: description,
		StartAt:     startAt,
		EndAt:       endAt,
		AllDay:      input.AllDay,
		TimeZone:    timeZone,
		CreatedAt:   now,
		UpdatedAt:   now,
		Version:     1,
	}
	addEventAuditIDs(rec, event)
	if err := s.store.CreateEvent(event); err != nil {
		if errors.Is(err, kvstore.ErrExists) {
			return nil, model.ErrConflict
		}
		return nil, err
	}
	rec.Success()
	s.publish("created", event)
	return event, nil
}

// Get returns an event the actor may view.
func (s *EventService) Get(actorID, eventID string) (*model.Event, error) {
	if !mmodel.IsValidId(eventID) {
		return nil, model.ErrNotFound
	}
	event, err := s.store.GetEvent(eventID)
	if err != nil {
		return nil, mapEventStoreError(err)
	}
	if !s.canViewEvent(actorID, event) {
		return nil, model.ErrNotFound
	}
	return event, nil
}

// List returns events overlapping the requested range.
func (s *EventService) List(actorID string, query model.EventQuery) (*EventListResult, error) {
	if err := query.Normalize(); err != nil {
		return nil, err
	}
	if !mmodel.IsValidId(actorID) {
		return nil, model.ErrForbidden
	}

	cache := s.access.Cache()
	var refs []model.EventRef
	switch query.Scope {
	case model.TaskScopeMy:
		loaded, err := s.store.ListEventRefsByUser(actorID)
		if err != nil {
			return nil, err
		}
		refs = filterEventRefs(loaded, func(ref model.EventRef) bool {
			if ref.CreatorID != actorID && !slices.Contains(ref.AssigneeIDs, actorID) {
				return false
			}
			if ref.EffectiveVisibility() == model.TaskVisibilityPrivate {
				return ref.CreatorID == actorID
			}
			return cache.CanView(actorID, ref.TeamID, ref.ChannelID)
		})

	case model.TaskScopeTeam:
		if !cache.CanViewTeam(actorID, query.TeamID) {
			return nil, model.ErrForbidden
		}
		loaded, err := s.store.ListEventRefsByTeam(query.TeamID)
		if err != nil {
			return nil, err
		}
		refs = filterEventRefs(loaded, func(ref model.EventRef) bool {
			if ref.TeamID != query.TeamID || ref.EffectiveVisibility() == model.TaskVisibilityPrivate {
				return false
			}
			return cache.CanView(actorID, ref.TeamID, ref.ChannelID)
		})
		privateRefs, privateErr := s.store.ListEventRefsByUser(actorID)
		if privateErr != nil {
			return nil, privateErr
		}
		refs = append(refs, filterEventRefs(privateRefs, func(ref model.EventRef) bool {
			return ref.TeamID == query.TeamID &&
				ref.EffectiveVisibility() == model.TaskVisibilityPrivate &&
				ref.CreatorID == actorID
		})...)
	}

	filtered := refs[:0]
	seen := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		if _, ok := seen[ref.ID]; ok {
			continue
		}
		if !query.Match(ref) {
			continue
		}
		seen[ref.ID] = struct{}{}
		filtered = append(filtered, ref)
	}
	query.Sort(filtered)
	page, hasMore := model.Paginate(filtered, query.Page, query.PerPage)

	items := make([]model.EventSummary, len(page))
	for i, ref := range page {
		items[i] = ref.Summary()
	}
	return &EventListResult{
		Items:   items,
		Total:   len(filtered),
		Page:    query.Page,
		PerPage: query.PerPage,
		HasMore: hasMore,
	}, nil
}

// Update applies a partial event patch. Only the creator or an administrator may edit an event.
func (s *EventService) Update(c *plugin.Context, path, actorID, eventID string, patch model.EventPatch) (*model.Event, error) {
	if !mmodel.IsValidId(actorID) {
		return nil, model.ErrForbidden
	}
	if !mmodel.IsValidId(eventID) {
		return nil, model.ErrNotFound
	}
	if patch.IsZero() {
		return nil, fmt.Errorf("%w: no changes", model.ErrInvalid)
	}

	rec := s.audit(c, "updateEvent", actorID, path)
	defer s.recordAudit(rec)
	mmodel.AddEventParameterToAuditRec(rec, "event_id", eventID)

	next, err := s.store.UpdateEvent(eventID, func(current *model.Event) (*model.Event, error) {
		if !s.canViewEvent(actorID, current) {
			return nil, model.ErrNotFound
		}
		if current.CreatorID != actorID && !s.access.IsAdmin(actorID) {
			return nil, model.ErrForbidden
		}

		oldVisibility := current.EffectiveVisibility()
		newVisibility := oldVisibility
		if patch.Visibility != nil {
			if !model.IsValidEventVisibility(*patch.Visibility) {
				return nil, fmt.Errorf("%w: unknown visibility", model.ErrInvalid)
			}
			newVisibility = *patch.Visibility
		}
		newTeam, newChannel := current.TeamID, current.ChannelID
		if patch.TeamID != nil {
			newTeam = *patch.TeamID
		}
		if patch.ChannelID != nil {
			newChannel = *patch.ChannelID
		}
		if newVisibility != model.TaskVisibilityChannel {
			newChannel = ""
		}
		if newVisibility == model.TaskVisibilityChannel && newChannel == "" {
			return nil, fmt.Errorf("%w: channel visibility requires a channel", model.ErrInvalid)
		}

		scopeChanged := newTeam != current.TeamID || newChannel != current.ChannelID || newVisibility != oldVisibility
		var scope *access.Scope
		if scopeChanged || patch.AssigneeIDs != nil {
			var resolveErr error
			scope, resolveErr = s.access.Resolve(actorID, newTeam, newChannel)
			if resolveErr != nil {
				return nil, resolveErr
			}
			newTeam = scope.TeamID
			if newVisibility == model.TaskVisibilityChannel {
				newChannel = scope.ChannelID
			} else {
				newChannel = ""
			}
		}
		assigneeIDs := slices.Clone(current.AssigneeIDs)
		if patch.AssigneeIDs != nil {
			normalized, normalizeErr := model.NormalizeIDs(*patch.AssigneeIDs, "assignees", model.MaxAssignees)
			if normalizeErr != nil {
				return nil, normalizeErr
			}
			assigneeIDs = normalized
		}
		if newVisibility == model.TaskVisibilityPrivate {
			assigneeIDs = []string{current.CreatorID}
		}
		if scopeChanged || patch.AssigneeIDs != nil {
			if scope == nil {
				scope = &access.Scope{TeamID: newTeam, ChannelID: newChannel}
			}
			if err := s.validateAssignees(scope, assigneeIDs); err != nil {
				return nil, err
			}
		}

		startAt, endAt := current.StartAt, current.EndAt
		allDay := current.AllDay
		if patch.StartAt != nil {
			startAt = *patch.StartAt
		}
		if patch.EndAt != nil {
			endAt = *patch.EndAt
		}
		if patch.AllDay != nil {
			allDay = *patch.AllDay
		}
		startAt, endAt, timeErr := model.NormalizeEventTimes(startAt, endAt, allDay)
		if timeErr != nil {
			return nil, timeErr
		}
		timeZone := current.TimeZone
		if patch.TimeZone != nil {
			timeZone = *patch.TimeZone
		}
		timeZone, timeZoneErr := model.NormalizeTimeZone(timeZone)
		if timeZoneErr != nil {
			return nil, timeZoneErr
		}

		if patch.Title != nil {
			title, titleErr := model.NormalizeTitle(*patch.Title)
			if titleErr != nil {
				return nil, titleErr
			}
			current.Title = title
		}
		if patch.Description != nil {
			description, descriptionErr := model.NormalizeDescription(*patch.Description)
			if descriptionErr != nil {
				return nil, descriptionErr
			}
			current.Description = description
		}
		current.Visibility = newVisibility
		current.TeamID = newTeam
		current.ChannelID = newChannel
		current.AssigneeIDs = assigneeIDs
		current.StartAt = startAt
		current.EndAt = endAt
		current.AllDay = allDay
		current.TimeZone = timeZone
		return current, nil
	})
	if err != nil {
		return nil, mapEventStoreError(err)
	}

	addEventAuditIDs(rec, next)
	rec.Success()
	s.publish("updated", next)
	return next, nil
}

// Delete removes an event. Only its creator or an administrator may do so.
func (s *EventService) Delete(c *plugin.Context, path, actorID, eventID string) error {
	if !mmodel.IsValidId(actorID) {
		return model.ErrForbidden
	}
	if !mmodel.IsValidId(eventID) {
		return model.ErrNotFound
	}
	rec := s.audit(c, "deleteEvent", actorID, path)
	defer s.recordAudit(rec)
	mmodel.AddEventParameterToAuditRec(rec, "event_id", eventID)

	current, err := s.store.GetEvent(eventID)
	if err != nil {
		return mapEventStoreError(err)
	}
	if !s.canViewEvent(actorID, current) {
		return model.ErrNotFound
	}
	if current.CreatorID != actorID && !s.access.IsAdmin(actorID) {
		return model.ErrForbidden
	}
	addEventAuditIDs(rec, current)
	if err := s.store.DeleteEvent(eventID); err != nil {
		return mapEventStoreError(err)
	}
	rec.Success()
	s.publish("deleted", current)
	return nil
}

func (s *EventService) canViewEvent(actorID string, event *model.Event) bool {
	if event.EffectiveVisibility() == model.TaskVisibilityPrivate {
		return event.CreatorID == actorID
	}
	return s.access.CanView(actorID, event.TeamID, event.ChannelID)
}

func (s *EventService) validateAssignees(scope *access.Scope, assigneeIDs []string) error {
	if scope == nil {
		return nil
	}
	for _, assigneeID := range assigneeIDs {
		if !s.access.CanAssign(assigneeID, scope) {
			return fmt.Errorf("%w: every assignee must be a member of the event's scope", model.ErrInvalid)
		}
	}
	return nil
}

func filterEventRefs(refs []model.EventRef, keep func(model.EventRef) bool) []model.EventRef {
	out := refs[:0]
	for _, ref := range refs {
		if keep(ref) {
			out = append(out, ref)
		}
	}
	return out
}

func (s *EventService) audit(c *plugin.Context, event, actorID, path string) *mmodel.AuditRecord {
	if c == nil {
		c = &plugin.Context{}
	}
	return plugin.MakeAuditRecordWithContext(event, mmodel.AuditStatusFail, c, actorID, path)
}

func (s *EventService) recordAudit(rec *mmodel.AuditRecord) {
	s.client.Audit.Record(rec)
}

func addEventAuditIDs(rec *mmodel.AuditRecord, event *model.Event) {
	mmodel.AddEventParameterToAuditRec(rec, "event_id", event.ID)
	mmodel.AddEventParameterToAuditRec(rec, "team_id", event.TeamID)
	mmodel.AddEventParameterToAuditRec(rec, "channel_id", event.ChannelID)
}

func (s *EventService) publish(action string, event *model.Event) {
	if s.publisher != nil {
		s.publisher.EventChanged(action, event)
	}
}

func mapEventStoreError(err error) error {
	switch {
	case errors.Is(err, kvstore.ErrNotFound):
		return model.ErrNotFound
	case errors.Is(err, model.ErrConflict):
		return model.ErrConflict
	default:
		return err
	}
}
