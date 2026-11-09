// Package model defines the plugin's persisted records and the data that is safe to send to
// clients. Records carry camelCase JSON because the webapp consumes them directly.
package model

import (
	"fmt"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/mattermost/mattermost/server/public/model"
)

// Task statuses.
const (
	TaskStatusTodo       = "todo"
	TaskStatusInProgress = "in_progress"
	TaskStatusDone       = "done"
)

// Task visibility levels. A private task is visible only to its creator, a team task to the whole
// team, and a channel task to members of its channel.
const (
	TaskVisibilityPrivate = "private"
	TaskVisibilityTeam    = "team"
	TaskVisibilityChannel = "channel"
)

// Task priorities, from lowest to highest.
const (
	TaskPriorityNone   = "none"
	TaskPriorityLow    = "low"
	TaskPriorityNormal = "normal"
	TaskPriorityHigh   = "high"
	TaskPriorityUrgent = "urgent"
)

var (
	TaskStatuses     = []string{TaskStatusTodo, TaskStatusInProgress, TaskStatusDone}
	TaskVisibilities = []string{TaskVisibilityPrivate, TaskVisibilityTeam, TaskVisibilityChannel}

	TaskPriorities = []string{
		TaskPriorityNone,
		TaskPriorityLow,
		TaskPriorityNormal,
		TaskPriorityHigh,
		TaskPriorityUrgent,
	}

	taskStatusSet     = toSet(TaskStatuses)
	taskPrioritySet   = toSet(TaskPriorities)
	taskVisibilitySet = toSet(TaskVisibilities)
)

func toSet(values []string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		set[value] = struct{}{}
	}
	return set
}

// IsValidTaskStatus reports whether status is one of the documented statuses.
func IsValidTaskStatus(status string) bool {
	_, ok := taskStatusSet[status]
	return ok
}

// IsValidTaskPriority reports whether priority is one of the documented priorities.
func IsValidTaskPriority(priority string) bool {
	_, ok := taskPrioritySet[priority]
	return ok
}

// IsValidTaskVisibility reports whether visibility is one of the documented levels.
func IsValidTaskVisibility(visibility string) bool {
	_, ok := taskVisibilitySet[visibility]
	return ok
}

// DefaultTaskVisibility derives the visibility for API clients that only send a scope. The webapp
// always sends an explicit value.
func DefaultTaskVisibility(channelID string) string {
	if channelID != "" {
		return TaskVisibilityChannel
	}
	return TaskVisibilityTeam
}

// EffectiveVisibility resolves records written before the visibility field existed. Old channel
// tasks are channel-visible; old team tasks are team-visible.
func (t *Task) EffectiveVisibility() string {
	if t.Visibility != "" {
		return t.Visibility
	}
	return DefaultTaskVisibility(t.ChannelID)
}

// EffectiveVisibility resolves a compact ref written before the visibility field existed.
func (r TaskRef) EffectiveVisibility() string {
	if r.Visibility != "" {
		return r.Visibility
	}
	return DefaultTaskVisibility(r.ChannelID)
}

// PriorityRank turns a priority into a comparable number. Unknown values sort as none.
func PriorityRank(priority string) int {
	switch priority {
	case TaskPriorityUrgent:
		return 4
	case TaskPriorityHigh:
		return 3
	case TaskPriorityNormal:
		return 2
	case TaskPriorityLow:
		return 1
	default:
		return 0
	}
}

// Task is the full record. It is never written to a WebSocket payload or a list response.
type Task struct {
	ID           string   `json:"id"`
	TeamID       string   `json:"teamId"`
	ChannelID    string   `json:"channelId,omitempty"`
	Visibility   string   `json:"visibility"`
	Title        string   `json:"title"`
	Description  string   `json:"description,omitempty"`
	CreatorID    string   `json:"creatorId"`
	AssigneeIDs  []string `json:"assigneeIds"`
	Status       string   `json:"status"`
	Priority     string   `json:"priority"`
	DueAt        int64    `json:"dueAt,omitempty"`
	DueHasTime   bool     `json:"dueHasTime,omitempty"`
	Position     float64  `json:"position,omitempty"`
	SourcePostID string   `json:"sourcePostId,omitempty"`
	ParentTaskID string   `json:"parentTaskId,omitempty"`
	CreatedAt    int64    `json:"createdAt"`
	UpdatedAt    int64    `json:"updatedAt"`
	CompletedAt  int64    `json:"completedAt,omitempty"`

	// Version increments on every write and lets index updates discard stale refs.
	Version int64 `json:"version"`
}

// Clone returns a deep copy, so a mutation function can be retried safely.
func (t *Task) Clone() *Task {
	clone := *t
	clone.AssigneeIDs = slices.Clone(t.AssigneeIDs)
	return &clone
}

// HasAssignee reports whether userID is assigned to the task.
func (t *Task) HasAssignee(userID string) bool {
	return slices.Contains(t.AssigneeIDs, userID)
}

// TaskRef is the compact record kept in each index shard. One-character JSON keys keep the hot
// index records small; they are internal and never sent to clients as-is.
type TaskRef struct {
	ID          string   `json:"i"`
	TeamID      string   `json:"t"`
	ChannelID   string   `json:"c,omitempty"`
	Visibility  string   `json:"z"`
	CreatorID   string   `json:"o"`
	Title       string   `json:"n"`
	Status      string   `json:"s"`
	Priority    string   `json:"p"`
	AssigneeIDs []string `json:"a,omitempty"`
	DueAt       int64    `json:"d,omitempty"`
	DueHasTime  bool     `json:"h,omitempty"`
	Position    float64  `json:"q,omitempty"`
	CreatedAt   int64    `json:"k"`
	UpdatedAt   int64    `json:"u"`
	Version     int64    `json:"v"`
}

// Ref builds the index reference for a task. The title is capped because index records are
// rewritten on every mutation; the full title remains in the task record.
func (t *Task) Ref() TaskRef {
	return TaskRef{
		ID:          t.ID,
		TeamID:      t.TeamID,
		ChannelID:   t.ChannelID,
		Visibility:  t.EffectiveVisibility(),
		CreatorID:   t.CreatorID,
		Title:       truncateRunes(t.Title, MaxTitleRunes),
		Status:      t.Status,
		Priority:    t.Priority,
		AssigneeIDs: slices.Clone(t.AssigneeIDs),
		DueAt:       t.DueAt,
		DueHasTime:  t.DueHasTime,
		Position:    t.Position,
		CreatedAt:   t.CreatedAt,
		UpdatedAt:   t.UpdatedAt,
		Version:     t.Version,
	}
}

// TaskSummary is the list representation sent to the webapp.
type TaskSummary struct {
	ID          string   `json:"id"`
	TeamID      string   `json:"teamId"`
	ChannelID   string   `json:"channelId,omitempty"`
	Visibility  string   `json:"visibility"`
	CreatorID   string   `json:"creatorId"`
	Title       string   `json:"title"`
	Status      string   `json:"status"`
	Priority    string   `json:"priority"`
	AssigneeIDs []string `json:"assigneeIds"`
	DueAt       int64    `json:"dueAt,omitempty"`
	DueHasTime  bool     `json:"dueHasTime,omitempty"`
	Position    float64  `json:"position,omitempty"`
	CreatedAt   int64    `json:"createdAt"`
	UpdatedAt   int64    `json:"updatedAt"`
}

// Summary converts an index reference to its API representation.
func (r TaskRef) Summary() TaskSummary {
	assignees := slices.Clone(r.AssigneeIDs)
	if assignees == nil {
		assignees = []string{}
	}
	return TaskSummary{
		ID:          r.ID,
		TeamID:      r.TeamID,
		ChannelID:   r.ChannelID,
		Visibility:  r.EffectiveVisibility(),
		CreatorID:   r.CreatorID,
		Title:       r.Title,
		Status:      r.Status,
		Priority:    r.Priority,
		AssigneeIDs: assignees,
		DueAt:       r.DueAt,
		DueHasTime:  r.DueHasTime,
		Position:    r.Position,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}

// CreateTaskInput is the validated input to Service.Create.
type CreateTaskInput struct {
	TeamID       string
	ChannelID    string
	Visibility   string
	Title        string
	Description  string
	AssigneeIDs  []string
	Status       string
	Priority     string
	DueAt        int64
	DueHasTime   bool
	Position     float64
	SourcePostID string
	ParentTaskID string
}

// TaskPatch is a partial update. A nil pointer means "leave unchanged"; ChannelID points to ""
// for a team-level task.
type TaskPatch struct {
	TeamID       *string
	ChannelID    *string
	Visibility   *string
	Title        *string
	Description  *string
	AssigneeIDs  *[]string
	Status       *string
	Priority     *string
	DueAt        *int64
	DueHasTime   *bool
	Position     *float64
	SourcePostID *string
	ParentTaskID *string
}

// IsZero reports whether the patch changes nothing.
func (p TaskPatch) IsZero() bool {
	return p.TeamID == nil && p.ChannelID == nil && p.Visibility == nil && p.Title == nil && p.Description == nil &&
		p.AssigneeIDs == nil && p.Status == nil && p.Priority == nil && p.DueAt == nil &&
		p.DueHasTime == nil && p.Position == nil && p.SourcePostID == nil && p.ParentTaskID == nil
}

// OnlyStatus reports whether the patch only changes the status. Assignees may change status
// without being allowed to edit task metadata.
func (p TaskPatch) OnlyStatus() bool {
	return p.Status != nil && p.TeamID == nil && p.ChannelID == nil && p.Visibility == nil && p.Title == nil &&
		p.Description == nil && p.AssigneeIDs == nil && p.Priority == nil && p.DueAt == nil &&
		p.DueHasTime == nil && p.Position == nil && p.SourcePostID == nil && p.ParentTaskID == nil
}

// OnlyPosition reports a pure manual-order change.
func (p TaskPatch) OnlyPosition() bool {
	return p.Position != nil && p.TeamID == nil && p.ChannelID == nil && p.Visibility == nil && p.Title == nil &&
		p.Description == nil && p.AssigneeIDs == nil && p.Status == nil && p.Priority == nil && p.DueAt == nil &&
		p.DueHasTime == nil && p.SourcePostID == nil && p.ParentTaskID == nil
}

// OnlyStatusOrPosition allows a board drag that changes a column and its manual position.
func (p TaskPatch) OnlyStatusOrPosition() bool {
	if p.Position == nil && p.Status == nil {
		return false
	}
	return p.TeamID == nil && p.ChannelID == nil && p.Visibility == nil && p.Title == nil &&
		p.Description == nil && p.AssigneeIDs == nil && p.Priority == nil && p.DueAt == nil &&
		p.DueHasTime == nil && p.SourcePostID == nil && p.ParentTaskID == nil
}

const (
	MaxTitleRunes         = 200
	MaxDescriptionRunes   = 8000
	MaxAssignees          = 50
	MaxTags               = 20
	MaxTagRunes           = 50
	MaxURLBytes           = 2048
	MaxBookmarkTitleRunes = 200
)

func truncateRunes(value string, limit int) string {
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit])
}

// NormalizeText trims surrounding whitespace and validates a title.
func NormalizeTitle(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("%w: title is required", ErrInvalid)
	}
	if utf8.RuneCountInString(value) > MaxTitleRunes {
		return "", fmt.Errorf("%w: title is longer than %d characters", ErrInvalid, MaxTitleRunes)
	}
	return value, nil
}

// NormalizeDescription trims a description and enforces its size limit.
func NormalizeDescription(value string) (string, error) {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > MaxDescriptionRunes {
		return "", fmt.Errorf("%w: description is longer than %d characters", ErrInvalid, MaxDescriptionRunes)
	}
	return value, nil
}

// NormalizeIDs validates, trims and de-duplicates a list of Mattermost IDs, preserving order.
func NormalizeIDs(ids []string, field string, max int) ([]string, error) {
	if len(ids) > max {
		return nil, fmt.Errorf("%w: too many %s", ErrInvalid, field)
	}
	seen := make(map[string]struct{}, len(ids))
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if !model.IsValidId(id) {
			return nil, fmt.Errorf("%w: invalid %s", ErrInvalid, field)
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		out = append(out, id)
	}
	if out == nil {
		out = []string{}
	}
	return out, nil
}

// ValidateSourcePost checks the ID shape of a source post.
func ValidateSourcePost(postID string) error {
	if postID != "" && !model.IsValidId(postID) {
		return fmt.Errorf("%w: invalid source post", ErrInvalid)
	}
	return nil
}
