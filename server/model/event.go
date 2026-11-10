package model

import (
	"fmt"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/mattermost/mattermost/server/public/model"
)

// Event is a calendar appointment. It is deliberately separate from Task: events do not have a
// completion state or priority, and their start/end describe reserved time rather than a deadline.
// Assignees are participants in the appointment, not people who complete it.
type Event struct {
	ID          string           `json:"id"`
	TeamID      string           `json:"teamId"`
	ChannelID   string           `json:"channelId,omitempty"`
	Visibility  string           `json:"visibility"`
	CreatorID   string           `json:"creatorId"`
	AssigneeIDs []string         `json:"assigneeIds"`
	Title       string           `json:"title"`
	Description string           `json:"description,omitempty"`
	StartAt     int64            `json:"startAt"`
	EndAt       int64            `json:"endAt"`
	AllDay      bool             `json:"allDay,omitempty"`
	TimeZone    string           `json:"timezone,omitempty"`
	Recurrence  *EventRecurrence `json:"recurrence,omitempty"`
	CreatedAt   int64            `json:"createdAt"`
	UpdatedAt   int64            `json:"updatedAt"`
	Version     int64            `json:"version"`
}

// Clone returns a deep copy for the store's CAS retry callback.
func (e *Event) Clone() *Event {
	clone := *e
	clone.AssigneeIDs = slices.Clone(e.AssigneeIDs)
	clone.Recurrence = e.Recurrence.Clone()
	return &clone
}

// HasAssignee reports whether userID is assigned to the event.
func (e *Event) HasAssignee(userID string) bool {
	return slices.Contains(e.AssigneeIDs, userID)
}

// EffectiveVisibility resolves records written before the visibility field existed.
func (e *Event) EffectiveVisibility() string {
	if e.Visibility != "" {
		return e.Visibility
	}
	return DefaultTaskVisibility(e.ChannelID)
}

// EventRef is the compact record kept in the event indexes.
type EventRef struct {
	ID          string           `json:"i"`
	TeamID      string           `json:"t"`
	ChannelID   string           `json:"c,omitempty"`
	Visibility  string           `json:"z"`
	CreatorID   string           `json:"o"`
	AssigneeIDs []string         `json:"a,omitempty"`
	Title       string           `json:"n"`
	StartAt     int64            `json:"s"`
	EndAt       int64            `json:"e"`
	AllDay      bool             `json:"d,omitempty"`
	TimeZone    string           `json:"tz,omitempty"`
	Recurrence  *EventRecurrence `json:"r,omitempty"`
	CreatedAt   int64            `json:"k"`
	UpdatedAt   int64            `json:"u"`
	Version     int64            `json:"v"`
}

// EffectiveVisibility resolves a compact ref written before the visibility field existed.
func (r EventRef) EffectiveVisibility() string {
	if r.Visibility != "" {
		return r.Visibility
	}
	return DefaultTaskVisibility(r.ChannelID)
}

// Ref builds the index reference for an event.
func (e *Event) Ref() EventRef {
	return EventRef{
		ID:          e.ID,
		TeamID:      e.TeamID,
		ChannelID:   e.ChannelID,
		Visibility:  e.EffectiveVisibility(),
		CreatorID:   e.CreatorID,
		AssigneeIDs: slices.Clone(e.AssigneeIDs),
		Title:       truncateRunes(e.Title, MaxTitleRunes),
		StartAt:     e.StartAt,
		EndAt:       e.EndAt,
		AllDay:      e.AllDay,
		TimeZone:    e.TimeZone,
		Recurrence:  e.Recurrence.Clone(),
		CreatedAt:   e.CreatedAt,
		UpdatedAt:   e.UpdatedAt,
		Version:     e.Version,
	}
}

// EventSummary is the calendar/list representation sent to the webapp.
type EventSummary struct {
	ID          string           `json:"id"`
	TeamID      string           `json:"teamId"`
	ChannelID   string           `json:"channelId,omitempty"`
	Visibility  string           `json:"visibility"`
	CreatorID   string           `json:"creatorId"`
	AssigneeIDs []string         `json:"assigneeIds"`
	Title       string           `json:"title"`
	StartAt     int64            `json:"startAt"`
	EndAt       int64            `json:"endAt"`
	AllDay      bool             `json:"allDay,omitempty"`
	TimeZone    string           `json:"timezone,omitempty"`
	Recurrence  *EventRecurrence `json:"recurrence,omitempty"`
	CreatedAt   int64            `json:"createdAt"`
	UpdatedAt   int64            `json:"updatedAt"`
}

// Summary converts an event index reference to its API representation.
func (r EventRef) Summary() EventSummary {
	return EventSummary{
		ID:         r.ID,
		TeamID:     r.TeamID,
		ChannelID:  r.ChannelID,
		Visibility: r.EffectiveVisibility(),
		CreatorID:  r.CreatorID,
		AssigneeIDs: func() []string {
			ids := slices.Clone(r.AssigneeIDs)
			if ids == nil {
				return []string{}
			}
			return ids
		}(),
		Title:     r.Title,
		StartAt:   r.StartAt,
		EndAt:     r.EndAt,
		AllDay:    r.AllDay,
		TimeZone:  r.TimeZone,
		CreatedAt: r.CreatedAt,
		UpdatedAt: r.UpdatedAt,
	}
}

// CreateEventInput is the validated input to the event service.
type CreateEventInput struct {
	TeamID      string
	ChannelID   string
	Visibility  string
	Title       string
	Description string
	AssigneeIDs []string
	StartAt     int64
	EndAt       int64
	AllDay      bool
	TimeZone    string
	Recurrence  *EventRecurrence
}

// EventPatch is a partial event update. A nil pointer means "leave unchanged".
type EventPatch struct {
	TeamID      *string
	ChannelID   *string
	Visibility  *string
	Title       *string
	Description *string
	AssigneeIDs *[]string
	StartAt     *int64
	EndAt       *int64
	AllDay      *bool
	TimeZone    *string
	Recurrence  *EventRecurrence
}

// IsZero reports whether the patch changes nothing.
func (p EventPatch) IsZero() bool {
	return p.TeamID == nil && p.ChannelID == nil && p.Visibility == nil && p.Title == nil &&
		p.Description == nil && p.AssigneeIDs == nil && p.StartAt == nil && p.EndAt == nil && p.AllDay == nil && p.TimeZone == nil && p.Recurrence == nil
}

// EventQuery is a validated event list query. Events are fetched for a time range.
type EventQuery struct {
	Scope            TaskScope
	TeamID           string
	From             int64
	To               int64
	Page             int
	PerPage          int
	IncludeRecurring bool
}

// Normalize applies defaults and validates an event query.
func (q *EventQuery) Normalize() error {
	if q.Scope == "" {
		q.Scope = TaskScopeMy
	}
	switch q.Scope {
	case TaskScopeMy:
	case TaskScopeTeam:
		if !model.IsValidId(q.TeamID) {
			return fmt.Errorf("%w: a valid team is required", ErrInvalid)
		}
	default:
		return fmt.Errorf("%w: unknown event scope", ErrInvalid)
	}
	if q.TeamID != "" && !model.IsValidId(q.TeamID) {
		return fmt.Errorf("%w: invalid team", ErrInvalid)
	}
	if q.From <= 0 || q.To <= 0 || q.From >= q.To {
		return fmt.Errorf("%w: a valid event range is required", ErrInvalid)
	}
	if q.Page < 0 {
		return fmt.Errorf("%w: page must not be negative", ErrInvalid)
	}
	if q.PerPage == 0 {
		q.PerPage = DefaultPageSize
	}
	if q.PerPage < 1 || q.PerPage > MaxPageSize {
		return fmt.Errorf("%w: page size must be between 1 and %d", ErrInvalid, MaxPageSize)
	}
	return nil
}

// Match reports whether an event belongs in the requested range. Recurring series are included
// when requested even if their base start is outside the range; the client expands occurrences.
func (q *EventQuery) Match(ref EventRef) bool {
	if ref.StartAt < q.To && ref.EndAt > q.From {
		return true
	}
	return q.IncludeRecurring && ref.Recurrence != nil
}

// Sort sorts events by start time, then end time and ID for stable pagination.
func (q *EventQuery) Sort(refs []EventRef) {
	sort.Slice(refs, func(i, j int) bool {
		if refs[i].StartAt != refs[j].StartAt {
			return refs[i].StartAt < refs[j].StartAt
		}
		if refs[i].EndAt != refs[j].EndAt {
			return refs[i].EndAt < refs[j].EndAt
		}
		return refs[i].ID < refs[j].ID
	})
}

// NormalizeEventTimes validates and normalizes an event interval. All-day events use UTC
// midnight boundaries and an exclusive end, matching date-range conventions in the webapp.
func NormalizeEventTimes(startAt, endAt int64, allDay bool) (int64, int64, error) {
	if startAt <= 0 || startAt > maxEventAt {
		return 0, 0, fmt.Errorf("%w: invalid event start", ErrInvalid)
	}
	if endAt <= 0 || endAt > maxEventAt {
		return 0, 0, fmt.Errorf("%w: invalid event end", ErrInvalid)
	}
	if allDay {
		start := time.UnixMilli(startAt).UTC()
		end := time.UnixMilli(endAt).UTC()
		startAt = time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC).UnixMilli()
		endAt = time.Date(end.Year(), end.Month(), end.Day(), 0, 0, 0, 0, time.UTC).UnixMilli()
	}
	if endAt <= startAt {
		return 0, 0, fmt.Errorf("%w: event end must be after its start", ErrInvalid)
	}
	return startAt, endAt, nil
}

// NormalizeTimeZone validates an IANA timezone and returns UTC for an empty value.
func NormalizeTimeZone(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "UTC", nil
	}
	if len(value) > 64 {
		return "", fmt.Errorf("%w: invalid timezone", ErrInvalid)
	}
	if _, err := time.LoadLocation(value); err != nil {
		return "", fmt.Errorf("%w: unknown timezone", ErrInvalid)
	}
	return value, nil
}

const maxEventAt = 253402300799999 // largest JS Date

// Event visibility helpers.
func IsValidEventVisibility(value string) bool {
	return slices.Contains(TaskVisibilities, value)
}
