// Package tasks implements task use cases: validation, authorization, assignment, listing,
// audit records and notifications. Both the REST API and the slash commands call this package,
// so there is exactly one place where task permissions are enforced.
package tasks

import (
	"errors"
	"fmt"
	"math"
	"slices"
	"time"

	mmodel "github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/mattermost/mattermost/server/public/pluginapi"

	"github.com/3tty0n/mattermost-tasks/server/access"
	"github.com/3tty0n/mattermost-tasks/server/model"
	"github.com/3tty0n/mattermost-tasks/server/store/kvstore"
)

// Publisher sends WebSocket change events. The interface keeps the service testable without a
// live Mattermost server.
type Publisher interface {
	TaskChanged(action string, task *model.Task)
}

// Notifier sends assignment notifications. Implementations must return immediately.
type Notifier interface {
	NotifyAssignment(task *model.Task, assigneeIDs []string)
}

// Reminders schedules due-time reminders for a saved task. Implementations must return quickly.
type Reminders interface {
	ScheduleTask(task *model.Task)
}

// Service is the task application service.
type Service struct {
	client    *pluginapi.Client
	store     kvstore.Store
	access    *access.Checker
	publisher Publisher
	notifier  Notifier
	reminders Reminders
	now       func() int64
}

// Option configures a Service.
type Option func(*Service)

// WithClock replaces the timestamp source, for tests.
func WithClock(now func() int64) Option {
	return func(s *Service) {
		s.now = now
	}
}

// WithReminders sets the reminder scheduler notified after every create and update.
func WithReminders(r Reminders) Option {
	return func(s *Service) {
		s.reminders = r
	}
}

// NewService returns a task service.
func NewService(client *pluginapi.Client, store kvstore.Store, checker *access.Checker, publisher Publisher, notifier Notifier, opts ...Option) *Service {
	s := &Service{
		client:    client,
		store:     store,
		access:    checker,
		publisher: publisher,
		notifier:  notifier,
		now:       mmodel.GetMillis,
	}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// ListResult is a page of task summaries.
type ListResult struct {
	Items   []model.TaskSummary `json:"items"`
	Total   int                 `json:"total"`
	Page    int                 `json:"page"`
	PerPage int                 `json:"perPage"`
	HasMore bool                `json:"hasMore"`
}

// Create validates and stores a task, then notifies newly assigned users.
func (s *Service) Create(c *plugin.Context, path, actorID string, input model.CreateTaskInput) (*model.Task, error) {
	if !mmodel.IsValidId(actorID) {
		return nil, model.ErrForbidden
	}
	rec := s.audit(c, "createTask", actorID, path)
	defer s.recordAudit(rec)

	title, err := model.NormalizeTitle(input.Title)
	if err != nil {
		return nil, err
	}
	description, err := model.NormalizeDescription(input.Description)
	if err != nil {
		return nil, err
	}
	status := input.Status
	if status == "" {
		status = model.TaskStatusTodo
	}
	if !model.IsValidTaskStatus(status) {
		return nil, fmt.Errorf("%w: unknown status", model.ErrInvalid)
	}
	priority := input.Priority
	if priority == "" {
		priority = model.TaskPriorityNormal
	}
	if !model.IsValidTaskPriority(priority) {
		return nil, fmt.Errorf("%w: unknown priority", model.ErrInvalid)
	}
	if input.DueAt < 0 || input.DueAt > maxDueAt {
		return nil, fmt.Errorf("%w: invalid due date", model.ErrInvalid)
	}
	if input.DueHasTime && input.DueAt == 0 {
		return nil, fmt.Errorf("%w: a due time requires a due date", model.ErrInvalid)
	}
	timeZoneInput := input.TimeZone
	if timeZoneInput == "" && input.Recurrence != nil {
		timeZoneInput = input.Recurrence.TimeZone
	}
	timeZone, err := model.NormalizeTimeZone(timeZoneInput)
	if err != nil {
		return nil, err
	}
	recurrenceInput := input.Recurrence
	if recurrenceInput != nil {
		copied := *recurrenceInput
		copied.TimeZone = timeZone
		recurrenceInput = &copied
	}
	recurrence, err := model.NormalizeRecurrence(recurrenceInput, input.DueAt, input.DueHasTime)
	if err != nil {
		return nil, err
	}
	reminders, err := model.NormalizeReminders(input.Reminders)
	if err != nil {
		return nil, err
	}
	visibility := input.Visibility
	if visibility == "" {
		visibility = model.DefaultTaskVisibility(input.ChannelID)
	}
	if !model.IsValidTaskVisibility(visibility) {
		return nil, fmt.Errorf("%w: unknown visibility", model.ErrInvalid)
	}
	assigneeIDs, err := model.NormalizeIDs(input.AssigneeIDs, "assignees", model.MaxAssignees)
	if err != nil {
		return nil, err
	}
	if err = model.ValidateSourcePost(input.SourcePostID); err != nil {
		return nil, err
	}
	if input.ParentTaskID != "" && !mmodel.IsValidId(input.ParentTaskID) {
		return nil, fmt.Errorf("%w: invalid parent task", model.ErrInvalid)
	}

	teamID, channelID := input.TeamID, input.ChannelID
	if input.SourcePostID != "" {
		postScope, resolveErr := s.access.ResolvePost(actorID, input.SourcePostID)
		if resolveErr != nil {
			return nil, resolveErr
		}
		if channelID != "" && channelID != postScope.ChannelID {
			return nil, fmt.Errorf("%w: the task scope must match the post's channel", model.ErrInvalid)
		}
		if teamID != "" && teamID != postScope.TeamID {
			return nil, fmt.Errorf("%w: the task team must match the post's team", model.ErrInvalid)
		}
		teamID, channelID = postScope.TeamID, postScope.ChannelID
		visibility = model.TaskVisibilityChannel
	}
	if visibility != model.TaskVisibilityChannel {
		channelID = ""
	}
	if visibility == model.TaskVisibilityChannel && channelID == "" {
		return nil, fmt.Errorf("%w: channel visibility requires a channel", model.ErrInvalid)
	}
	if visibility == model.TaskVisibilityPrivate {
		if teamID == "" {
			return nil, fmt.Errorf("%w: a private task requires a team", model.ErrInvalid)
		}
		assigneeIDs = []string{actorID}
	}

	scope, err := s.access.Resolve(actorID, teamID, channelID)
	if err != nil {
		return nil, err
	}
	assigneeIDs, err = s.validateAssignees(scope, assigneeIDs)
	if err != nil {
		return nil, err
	}
	if input.ParentTaskID != "" {
		if err := s.validateParent(actorID, "", input.ParentTaskID, scope.TeamID); err != nil {
			return nil, err
		}
	}

	now := s.now()
	position := input.Position
	if math.IsNaN(position) || math.IsInf(position, 0) || position < 0 {
		return nil, fmt.Errorf("%w: invalid position", model.ErrInvalid)
	}
	if position == 0 {
		position = float64(now)
	}
	task := &model.Task{
		ID:           mmodel.NewId(),
		TeamID:       scope.TeamID,
		ChannelID:    scope.ChannelID,
		Visibility:   visibility,
		Title:        title,
		Description:  description,
		CreatorID:    actorID,
		AssigneeIDs:  assigneeIDs,
		Status:       status,
		Priority:     priority,
		DueAt:        input.DueAt,
		DueHasTime:   input.DueHasTime && input.DueAt != 0,
		TimeZone:     timeZone,
		Recurrence:   recurrence,
		Reminders:    reminders,
		Position:     position,
		SourcePostID: input.SourcePostID,
		ParentTaskID: input.ParentTaskID,
		CreatedAt:    now,
		UpdatedAt:    now,
		Version:      1,
	}
	if status == model.TaskStatusDone {
		task.CompletedAt = now
	}

	addAuditIDs(rec, task)
	if err := s.store.CreateTask(task); err != nil {
		if errors.Is(err, kvstore.ErrExists) {
			return nil, model.ErrConflict
		}
		return nil, err
	}
	rec.Success()

	s.notifyAssignees(task, task.AssigneeIDs, actorID)
	s.remind(task)
	s.publish("created", task)
	return task, nil
}

// Get returns a task the actor may view.
func (s *Service) Get(actorID, taskID string) (*model.Task, error) {
	if !mmodel.IsValidId(taskID) {
		return nil, model.ErrNotFound
	}
	task, err := s.store.GetTask(taskID)
	if err != nil {
		return nil, mapStoreError(err)
	}
	if !s.canViewTask(actorID, task) {
		// Do not reveal that a task exists in a channel the user can not read.
		return nil, model.ErrNotFound
	}
	task.Visibility = task.EffectiveVisibility()
	return task, nil
}

// List returns a filtered, sorted and paginated page of tasks for one of the task scopes.
func (s *Service) List(actorID string, query model.TaskQuery) (*ListResult, error) {
	if err := query.Normalize(); err != nil {
		return nil, err
	}
	if !mmodel.IsValidId(actorID) {
		return nil, model.ErrForbidden
	}

	cache := s.access.Cache()
	var refs []model.TaskRef

	switch query.Scope {
	case model.TaskScopeMy:
		loaded, err := s.store.ListTaskRefsByUser(actorID)
		if err != nil {
			return nil, err
		}
		refs = filterRefs(loaded, func(ref model.TaskRef) bool {
			if ref.EffectiveVisibility() == model.TaskVisibilityPrivate {
				return ref.CreatorID == actorID
			}
			return slices.Contains(ref.AssigneeIDs, actorID) && cache.CanView(actorID, ref.TeamID, ref.ChannelID)
		})

	case model.TaskScopeTeam:
		if !cache.CanViewTeam(actorID, query.TeamID) {
			return nil, model.ErrForbidden
		}
		loaded, err := s.store.ListTaskRefsByTeam(query.TeamID)
		if err != nil {
			return nil, err
		}
		refs = filterRefs(loaded, func(ref model.TaskRef) bool {
			if ref.TeamID != query.TeamID || ref.EffectiveVisibility() == model.TaskVisibilityPrivate {
				return false
			}
			return cache.CanView(actorID, ref.TeamID, ref.ChannelID)
		})
		// The single team view also includes the actor's own private tasks. Other members never
		// receive them because private refs are only in the creator's user index.
		privateRefs, privateErr := s.store.ListTaskRefsByUser(actorID)
		if privateErr != nil {
			return nil, privateErr
		}
		refs = append(refs, filterRefs(privateRefs, func(ref model.TaskRef) bool {
			return ref.TeamID == query.TeamID &&
				ref.EffectiveVisibility() == model.TaskVisibilityPrivate &&
				ref.CreatorID == actorID
		})...)

	case model.TaskScopeChannel:
		scope, err := s.access.Resolve(actorID, "", query.ChannelID)
		if err != nil {
			return nil, err
		}
		cache.Seed(scope.TeamID, scope.ChannelID, true)
		loaded, err := s.store.ListTaskRefsByChannel(query.ChannelID)
		if err != nil {
			return nil, err
		}
		refs = filterRefs(loaded, func(ref model.TaskRef) bool {
			return ref.ChannelID == query.ChannelID &&
				ref.TeamID == scope.TeamID &&
				ref.EffectiveVisibility() == model.TaskVisibilityChannel
		})

	case model.TaskScopeAll:
		teams, err := s.client.Team.List(pluginapi.FilterTeamsByUser(actorID))
		if err != nil {
			return nil, err
		}
		refs = make([]model.TaskRef, 0, 64)
		for _, team := range teams {
			cache.Seed(team.Id, "", true)
			loaded, loadErr := s.store.ListTaskRefsByTeam(team.Id)
			if loadErr != nil {
				return nil, loadErr
			}
			refs = append(refs, filterRefs(loaded, func(ref model.TaskRef) bool {
				return ref.TeamID == team.Id &&
					ref.EffectiveVisibility() != model.TaskVisibilityPrivate &&
					cache.CanView(actorID, ref.TeamID, ref.ChannelID)
			})...)
		}
		privateRefs, err := s.store.ListTaskRefsByUser(actorID)
		if err != nil {
			return nil, err
		}
		refs = append(refs, filterRefs(privateRefs, func(ref model.TaskRef) bool {
			return ref.EffectiveVisibility() == model.TaskVisibilityPrivate && ref.CreatorID == actorID
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

	items := make([]model.TaskSummary, len(page))
	for i, ref := range page {
		items[i] = ref.Summary()
	}
	return &ListResult{
		Items:   items,
		Total:   len(filtered),
		Page:    query.Page,
		PerPage: query.PerPage,
		HasMore: hasMore,
	}, nil
}

// Update applies a partial patch. Permission checks run inside the store's compare-and-swap
// callback, so a concurrent reassignment can not be bypassed with a stale permission decision.
func (s *Service) Update(c *plugin.Context, path, actorID, taskID string, patch model.TaskPatch) (*model.Task, error) {
	if !mmodel.IsValidId(actorID) {
		return nil, model.ErrForbidden
	}
	if !mmodel.IsValidId(taskID) {
		return nil, model.ErrNotFound
	}
	if patch.IsZero() {
		return nil, fmt.Errorf("%w: no changes", model.ErrInvalid)
	}

	normalized, err := normalizePatch(patch)
	if err != nil {
		return nil, err
	}

	rec := s.audit(c, "updateTask", actorID, path)
	defer s.recordAudit(rec)
	mmodel.AddEventParameterToAuditRec(rec, "task_id", taskID)

	var before *model.Task
	next, err := s.store.UpdateTask(taskID, func(current *model.Task) (*model.Task, error) {
		before = current.Clone()

		if !s.canViewTask(actorID, current) {
			return nil, model.ErrNotFound
		}
		isAdmin := s.access.IsAdmin(actorID)
		isCreator := current.CreatorID == actorID
		isAssignee := current.HasAssignee(actorID)
		switch {
		case patch.OnlyPosition():
			// Manual ordering is a view operation; a viewer may reorder a shared task.
		case patch.OnlyStatusOrPosition():
			if !isAdmin && !isCreator && !isAssignee {
				return nil, model.ErrForbidden
			}
		default:
			if !isAdmin && !isCreator {
				return nil, model.ErrForbidden
			}
		}

		oldVisibility := current.EffectiveVisibility()
		current.Visibility = oldVisibility
		newVisibility := oldVisibility
		if normalized.visibility != nil {
			newVisibility = *normalized.visibility
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
		scopeChanged := newTeam != current.TeamID ||
			newChannel != current.ChannelID ||
			newVisibility != oldVisibility

		var scope *access.Scope
		if scopeChanged || patch.AssigneeIDs != nil || patch.SourcePostID != nil {
			scope, err = s.access.Resolve(actorID, newTeam, newChannel)
			if err != nil {
				return nil, err
			}
			newTeam = scope.TeamID
			if newVisibility == model.TaskVisibilityChannel {
				newChannel = scope.ChannelID
			} else {
				newChannel = ""
			}
		}

		if patch.SourcePostID != nil && *patch.SourcePostID != "" {
			postScope, resolveErr := s.access.ResolvePost(actorID, *patch.SourcePostID)
			if resolveErr != nil {
				return nil, resolveErr
			}
			if postScope.TeamID != newTeam || postScope.ChannelID != newChannel {
				return nil, fmt.Errorf("%w: the post must be in the task's channel", model.ErrInvalid)
			}
		}
		if current.SourcePostID != "" || (patch.SourcePostID != nil && *patch.SourcePostID != "") {
			if newVisibility != model.TaskVisibilityChannel {
				return nil, fmt.Errorf("%w: a task with a source post must be channel-visible", model.ErrInvalid)
			}
		}
		if scopeChanged && current.SourcePostID != "" && (patch.SourcePostID == nil || *patch.SourcePostID != "") {
			postScope, resolveErr := s.access.ResolvePost(actorID, current.SourcePostID)
			if resolveErr != nil {
				return nil, resolveErr
			}
			if postScope.TeamID != newTeam || postScope.ChannelID != newChannel {
				return nil, fmt.Errorf("%w: a task with a source post can not move away from it", model.ErrInvalid)
			}
		}

		if normalized.title != nil {
			current.Title = *normalized.title
		}
		if normalized.description != nil {
			current.Description = *normalized.description
		}
		if normalized.status != nil {
			status := *normalized.status
			if status != current.Status {
				if status == model.TaskStatusDone {
					current.CompletedAt = s.now()
				} else {
					current.CompletedAt = 0
				}
			}
			current.Status = status
		}
		if normalized.priority != nil {
			current.Priority = *normalized.priority
		}
		if normalized.dueAt != nil {
			current.DueAt = *normalized.dueAt
			if current.DueAt == 0 {
				current.DueHasTime = false
			}
		}
		if normalized.dueHasTime != nil {
			if *normalized.dueHasTime && current.DueAt == 0 {
				return nil, fmt.Errorf("%w: a due time requires a due date", model.ErrInvalid)
			}
			current.DueHasTime = *normalized.dueHasTime
		}
		if current.DueAt == 0 {
			current.DueHasTime = false
		}
		if patch.TimeZone != nil {
			timeZone, timeZoneErr := model.NormalizeTimeZone(*patch.TimeZone)
			if timeZoneErr != nil {
				return nil, timeZoneErr
			}
			current.TimeZone = timeZone
		}
		if current.TimeZone == "" && current.Recurrence != nil {
			current.TimeZone = current.Recurrence.TimeZone
		}
		dueChanged := patch.DueAt != nil || patch.DueHasTime != nil
		if patch.Recurrence != nil {
			recurrence := *patch.Recurrence
			if current.TimeZone != "" {
				recurrence.TimeZone = current.TimeZone
			}
			if dueChanged {
				recurrence.StartDate = ""
			} else if recurrence.StartDate == "" && current.Recurrence != nil {
				recurrence.StartDate = current.Recurrence.StartDate
			}
			current.Recurrence = &recurrence
		}
		if dueChanged && current.Recurrence != nil && patch.Recurrence == nil {
			recurrence := *current.Recurrence
			recurrence.StartDate = ""
			current.Recurrence = &recurrence
		}
		if current.DueAt == 0 {
			current.Recurrence = nil
		}
		if current.Recurrence != nil {
			recurrenceInput := *current.Recurrence
			if current.TimeZone != "" {
				recurrenceInput.TimeZone = current.TimeZone
			}
			recurrence, recErr := model.NormalizeRecurrence(&recurrenceInput, current.DueAt, current.DueHasTime)
			if recErr != nil {
				return nil, recErr
			}
			current.Recurrence = recurrence
		}
		if normalized.position != nil {
			current.Position = *normalized.position
		}
		if normalized.reminders != nil {
			current.Reminders = *normalized.reminders
		}
		if normalized.assignees != nil {
			current.AssigneeIDs = *normalized.assignees
		}
		if normalized.sourcePostID != nil {
			current.SourcePostID = *normalized.sourcePostID
		}
		current.Visibility = newVisibility
		if current.Visibility == model.TaskVisibilityPrivate {
			for _, assigneeID := range current.AssigneeIDs {
				if assigneeID != current.CreatorID {
					return nil, fmt.Errorf("%w: a private task can only be assigned to its creator", model.ErrInvalid)
				}
			}
			current.AssigneeIDs = []string{current.CreatorID}
		}
		if normalized.parentTaskID != nil {
			current.ParentTaskID = *normalized.parentTaskID
		}
		if normalized.status != nil && *normalized.status == model.TaskStatusDone && current.Recurrence != nil &&
			(before == nil || before.Status != model.TaskStatusDone) {
			if next, ok := current.Recurrence.NextDueAt(current.DueAt, current.DueHasTime, s.now()); ok {
				current.DueAt = next
				current.Status = model.TaskStatusTodo
				current.CompletedAt = 0
			}
		}

		if scopeChanged || patch.AssigneeIDs != nil {
			if _, err = s.validateAssignees(scope, current.AssigneeIDs); err != nil {
				return nil, err
			}
			current.TeamID = scope.TeamID
			if current.Visibility == model.TaskVisibilityChannel {
				current.ChannelID = scope.ChannelID
			} else {
				current.ChannelID = ""
			}
		}
		if normalized.parentTaskID != nil && current.ParentTaskID != "" {
			if err = s.validateParent(actorID, current.ID, current.ParentTaskID, current.TeamID); err != nil {
				return nil, err
			}
		}
		return current, nil
	})
	if err != nil {
		return nil, mapStoreError(err)
	}

	addAuditIDs(rec, next)
	rec.Success()

	if before != nil {
		s.notifyAssignees(next, addedAssignees(before.AssigneeIDs, next.AssigneeIDs), actorID)
	}
	s.remind(next)
	s.publish("updated", next)
	return next, nil
}

// Delete removes a task. Only its creator or a system administrator may do so, and the actor must
// still be able to read the task's scope.
func (s *Service) Delete(c *plugin.Context, path, actorID, taskID string) error {
	if !mmodel.IsValidId(actorID) {
		return model.ErrForbidden
	}
	if !mmodel.IsValidId(taskID) {
		return model.ErrNotFound
	}

	rec := s.audit(c, "deleteTask", actorID, path)
	defer s.recordAudit(rec)
	mmodel.AddEventParameterToAuditRec(rec, "task_id", taskID)

	current, err := s.store.GetTask(taskID)
	if err != nil {
		return mapStoreError(err)
	}
	if !s.canViewTask(actorID, current) {
		return model.ErrNotFound
	}
	if current.CreatorID != actorID && !s.access.IsAdmin(actorID) {
		return model.ErrForbidden
	}

	addAuditIDs(rec, current)
	if err := s.store.DeleteTask(taskID); err != nil {
		return mapStoreError(err)
	}
	rec.Success()
	s.publish("deleted", current)
	return nil
}

type normalizedPatch struct {
	title        *string
	description  *string
	status       *string
	priority     *string
	dueAt        *int64
	dueHasTime   *bool
	position     *float64
	reminders    *[]int
	visibility   *string
	assignees    *[]string
	sourcePostID *string
	parentTaskID *string
}

func normalizePatch(patch model.TaskPatch) (*normalizedPatch, error) {
	out := &normalizedPatch{}
	if patch.Title != nil {
		value, err := model.NormalizeTitle(*patch.Title)
		if err != nil {
			return nil, err
		}
		out.title = &value
	}
	if patch.Description != nil {
		value, err := model.NormalizeDescription(*patch.Description)
		if err != nil {
			return nil, err
		}
		out.description = &value
	}
	if patch.Reminders != nil {
		value, err := model.NormalizeReminders(*patch.Reminders)
		if err != nil {
			return nil, err
		}
		out.reminders = &value
	}
	if patch.Status != nil {
		if !model.IsValidTaskStatus(*patch.Status) {
			return nil, fmt.Errorf("%w: unknown status", model.ErrInvalid)
		}
		value := *patch.Status
		out.status = &value
	}
	if patch.Priority != nil {
		if !model.IsValidTaskPriority(*patch.Priority) {
			return nil, fmt.Errorf("%w: unknown priority", model.ErrInvalid)
		}
		value := *patch.Priority
		out.priority = &value
	}
	if patch.DueAt != nil {
		if *patch.DueAt < 0 || *patch.DueAt > maxDueAt {
			return nil, fmt.Errorf("%w: invalid due date", model.ErrInvalid)
		}
		value := *patch.DueAt
		out.dueAt = &value
	}
	if patch.DueHasTime != nil {
		value := *patch.DueHasTime
		out.dueHasTime = &value
	}
	if patch.Position != nil {
		if math.IsNaN(*patch.Position) || math.IsInf(*patch.Position, 0) || *patch.Position < 0 {
			return nil, fmt.Errorf("%w: invalid position", model.ErrInvalid)
		}
		value := *patch.Position
		out.position = &value
	}
	if patch.Visibility != nil {
		if !model.IsValidTaskVisibility(*patch.Visibility) {
			return nil, fmt.Errorf("%w: unknown visibility", model.ErrInvalid)
		}
		value := *patch.Visibility
		out.visibility = &value
	}
	if patch.AssigneeIDs != nil {
		value, err := model.NormalizeIDs(*patch.AssigneeIDs, "assignees", model.MaxAssignees)
		if err != nil {
			return nil, err
		}
		out.assignees = &value
	}
	if patch.SourcePostID != nil {
		if err := model.ValidateSourcePost(*patch.SourcePostID); err != nil {
			return nil, err
		}
		value := *patch.SourcePostID
		out.sourcePostID = &value
	}
	if patch.ParentTaskID != nil {
		if *patch.ParentTaskID != "" && !mmodel.IsValidId(*patch.ParentTaskID) {
			return nil, fmt.Errorf("%w: invalid parent task", model.ErrInvalid)
		}
		value := *patch.ParentTaskID
		out.parentTaskID = &value
	}
	return out, nil
}

func (s *Service) validateAssignees(scope *access.Scope, assigneeIDs []string) ([]string, error) {
	if scope == nil {
		return assigneeIDs, nil
	}
	for _, assigneeID := range assigneeIDs {
		if !s.access.CanAssign(assigneeID, scope) {
			return nil, fmt.Errorf("%w: every assignee must be a member of the task's scope", model.ErrInvalid)
		}
	}
	return assigneeIDs, nil
}

func (s *Service) validateParent(actorID, taskID, parentID, teamID string) error {
	if parentID == taskID {
		return fmt.Errorf("%w: a task can not be its own parent", model.ErrInvalid)
	}
	parent, err := s.store.GetTask(parentID)
	if err != nil {
		if errors.Is(err, kvstore.ErrNotFound) {
			return fmt.Errorf("%w: parent task not found", model.ErrInvalid)
		}
		return err
	}
	if parent.TeamID != teamID {
		return fmt.Errorf("%w: parent task must be in the same team", model.ErrInvalid)
	}
	if !s.access.CanView(actorID, parent.TeamID, parent.ChannelID) {
		return fmt.Errorf("%w: parent task not found", model.ErrInvalid)
	}
	return nil
}

func filterRefs(refs []model.TaskRef, keep func(model.TaskRef) bool) []model.TaskRef {
	out := make([]model.TaskRef, 0, len(refs))
	for _, ref := range refs {
		if keep(ref) {
			out = append(out, ref)
		}
	}
	return out
}

func addedAssignees(oldAssignees, newAssignees []string) []string {
	added := make([]string, 0, len(newAssignees))
	for _, userID := range newAssignees {
		if !slices.Contains(oldAssignees, userID) && !slices.Contains(added, userID) {
			added = append(added, userID)
		}
	}
	return added
}

func (s *Service) notifyAssignees(task *model.Task, assigneeIDs []string, actorID string) {
	if s.notifier == nil || len(assigneeIDs) == 0 {
		return
	}
	recipients := make([]string, 0, len(assigneeIDs))
	for _, userID := range assigneeIDs {
		if userID != actorID && !slices.Contains(recipients, userID) {
			recipients = append(recipients, userID)
		}
	}
	if len(recipients) == 0 {
		return
	}
	s.notifier.NotifyAssignment(task, recipients)
}

func (s *Service) remind(task *model.Task) {
	if s.reminders != nil {
		s.reminders.ScheduleTask(task)
	}
}

func (s *Service) publish(action string, task *model.Task) {
	if s.publisher != nil {
		s.publisher.TaskChanged(action, task)
	}
}

func (s *Service) audit(c *plugin.Context, event, actorID, path string) *mmodel.AuditRecord {
	if c == nil {
		c = &plugin.Context{}
	}
	return plugin.MakeAuditRecordWithContext(event, mmodel.AuditStatusFail, c, actorID, path)
}

func (s *Service) recordAudit(rec *mmodel.AuditRecord) {
	s.client.Audit.Record(rec)
}

func addAuditIDs(rec *mmodel.AuditRecord, task *model.Task) {
	mmodel.AddEventParameterToAuditRec(rec, "task_id", task.ID)
	mmodel.AddEventParameterToAuditRec(rec, "team_id", task.TeamID)
	mmodel.AddEventParameterToAuditRec(rec, "channel_id", task.ChannelID)
}

func mapStoreError(err error) error {
	switch {
	case errors.Is(err, kvstore.ErrNotFound):
		return model.ErrNotFound
	case errors.Is(err, model.ErrConflict):
		return model.ErrConflict
	default:
		return err
	}
}

const maxDueAt = 253402300799999 // 9999-12-31T23:59:59.999Z, the largest JS Date

// Now returns the service clock, exposed so tests can build expected timestamps.
func (s *Service) Now() int64 {
	return s.now()
}

func (s *Service) canViewTask(actorID string, task *model.Task) bool {
	if task.EffectiveVisibility() == model.TaskVisibilityPrivate {
		return task.CreatorID == actorID
	}
	return s.access.CanView(actorID, task.TeamID, task.ChannelID)
}

// FormatDue renders a due date for notifications and slash commands.
func FormatDue(dueAt int64, hasTime bool) string {
	if dueAt == 0 {
		return ""
	}
	if !hasTime {
		return time.UnixMilli(dueAt).UTC().Format("Jan 2, 2006")
	}
	return time.UnixMilli(dueAt).UTC().Format("Jan 2, 2006 15:04 MST")
}
