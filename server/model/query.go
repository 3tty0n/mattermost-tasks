package model

import (
	"fmt"
	"slices"
	"sort"

	"github.com/mattermost/mattermost/server/public/model"
)

// TaskScope is the set of tasks a list request covers.
type TaskScope string

const (
	TaskScopeMy      TaskScope = "my"
	TaskScopeTeam    TaskScope = "team"
	TaskScopeChannel TaskScope = "channel"
	TaskScopeAll     TaskScope = "all"
)

// TaskSort fields.
const (
	TaskSortDue      = "due"
	TaskSortCreated  = "created"
	TaskSortPriority = "priority"
	TaskSortManual   = "manual"
)

// Sort directions.
const (
	SortAsc  = "asc"
	SortDesc = "desc"
)

const (
	DefaultPageSize = 30
	MaxPageSize     = 100
)

// TaskQuery is a fully validated list query. The API layer converts strings to this struct.
type TaskQuery struct {
	Scope            TaskScope
	TeamID           string
	ChannelID        string
	Statuses         []string
	AssigneeID       string
	Priority         string
	DueBefore        *int64
	DueAfter         *int64
	HasDue           *bool
	IncludeRecurring bool
	SortBy           string
	Direction        string
	Page             int
	PerPage          int
}

// Normalize applies defaults and validates the query.
func (q *TaskQuery) Normalize() error {
	if q.Scope == "" {
		q.Scope = TaskScopeMy
	}
	switch q.Scope {
	case TaskScopeMy, TaskScopeAll:
	case TaskScopeTeam:
		if !model.IsValidId(q.TeamID) {
			return fmt.Errorf("%w: a valid team is required", ErrInvalid)
		}
	case TaskScopeChannel:
		if !model.IsValidId(q.ChannelID) {
			return fmt.Errorf("%w: a valid channel is required", ErrInvalid)
		}
	default:
		return fmt.Errorf("%w: unknown task scope", ErrInvalid)
	}

	if q.TeamID != "" && !model.IsValidId(q.TeamID) {
		return fmt.Errorf("%w: invalid team", ErrInvalid)
	}
	if q.ChannelID != "" && !model.IsValidId(q.ChannelID) {
		return fmt.Errorf("%w: invalid channel", ErrInvalid)
	}
	if q.AssigneeID != "" && !model.IsValidId(q.AssigneeID) {
		return fmt.Errorf("%w: invalid assignee", ErrInvalid)
	}
	if q.Priority != "" && !IsValidTaskPriority(q.Priority) {
		return fmt.Errorf("%w: unknown priority", ErrInvalid)
	}
	for _, status := range q.Statuses {
		if !IsValidTaskStatus(status) {
			return fmt.Errorf("%w: unknown status", ErrInvalid)
		}
	}
	q.Statuses = dedupeStrings(q.Statuses)

	if q.DueBefore != nil && *q.DueBefore < 0 {
		return fmt.Errorf("%w: invalid due-before", ErrInvalid)
	}
	if q.DueAfter != nil && *q.DueAfter < 0 {
		return fmt.Errorf("%w: invalid due-after", ErrInvalid)
	}
	if q.DueBefore != nil && q.DueAfter != nil && *q.DueAfter > *q.DueBefore {
		return fmt.Errorf("%w: due-after must not be later than due-before", ErrInvalid)
	}

	switch q.SortBy {
	case "":
		q.SortBy = TaskSortManual
	case TaskSortDue, TaskSortCreated, TaskSortPriority, TaskSortManual:
	default:
		return fmt.Errorf("%w: unknown sort field", ErrInvalid)
	}
	switch q.Direction {
	case "":
		q.Direction = SortAsc
	case SortAsc, SortDesc:
	default:
		return fmt.Errorf("%w: unknown sort direction", ErrInvalid)
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

func dedupeStrings(values []string) []string {
	out := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" || slices.Contains(out, value) {
			continue
		}
		out = append(out, value)
	}
	return out
}

// Match reports whether a task reference satisfies the filters.
func (q *TaskQuery) Match(ref TaskRef) bool {
	if len(q.Statuses) > 0 && !slices.Contains(q.Statuses, ref.Status) {
		return false
	}
	if q.Priority != "" && ref.Priority != q.Priority {
		return false
	}
	if q.AssigneeID != "" && !slices.Contains(ref.AssigneeIDs, q.AssigneeID) {
		return false
	}
	if q.HasDue != nil {
		if *q.HasDue && ref.DueAt == 0 {
			return false
		}
		if !*q.HasDue && ref.DueAt != 0 {
			return false
		}
	}
	if q.IncludeRecurring && ref.Recurrence != nil {
		// A recurring task's anchor can be older than the visible range, so only discard series
		// that start after it or ended before it. The calendar filters exact occurrence days.
		if q.DueBefore != nil && ref.DueAt >= *q.DueBefore {
			return false
		}
		if q.DueAfter != nil && ref.Recurrence.Until != 0 && ref.Recurrence.Until < *q.DueAfter {
			return false
		}
		return true
	}
	// Due filters never match tasks without a due date.
	if q.DueBefore != nil && (ref.DueAt == 0 || ref.DueAt >= *q.DueBefore) {
		return false
	}
	if q.DueAfter != nil && (ref.DueAt == 0 || ref.DueAt <= *q.DueAfter) {
		return false
	}
	return true
}

// Sort sorts refs in place according to the query. Ties are broken by ID so pagination is stable
// even when several tasks share a timestamp.
func (q *TaskQuery) Sort(refs []TaskRef) {
	less := func(a, b TaskRef) bool {
		switch q.SortBy {
		case TaskSortManual:
			// Tasks created before manual ordering have position 0; use their creation time so
			// a midpoint calculated by the client and the server sort agree.
			aPosition, bPosition := a.Position, b.Position
			if aPosition == 0 {
				aPosition = float64(a.CreatedAt)
			}
			if bPosition == 0 {
				bPosition = float64(b.CreatedAt)
			}
			if aPosition != bPosition {
				return ordered(aPosition < bPosition, q.Direction)
			}
			if a.CreatedAt != b.CreatedAt {
				return ordered(a.CreatedAt < b.CreatedAt, q.Direction)
			}
		case TaskSortCreated:
			if a.CreatedAt != b.CreatedAt {
				return ordered(a.CreatedAt < b.CreatedAt, q.Direction)
			}
		case TaskSortPriority:
			ra, rb := PriorityRank(a.Priority), PriorityRank(b.Priority)
			if ra != rb {
				return ordered(ra < rb, q.Direction)
			}
			// Within the same priority, the closest due date is the most useful order.
			if a.DueAt != b.DueAt {
				return q.lessDue(a.DueAt, b.DueAt)
			}
		default:
			if a.DueAt != b.DueAt {
				return q.lessDue(a.DueAt, b.DueAt)
			}
			if a.CreatedAt != b.CreatedAt {
				return ordered(a.CreatedAt < b.CreatedAt, q.Direction)
			}
		}
		return a.ID < b.ID
	}
	sort.Slice(refs, func(i, j int) bool { return less(refs[i], refs[j]) })
}

// lessDue keeps tasks without a due date last regardless of direction.
func (q *TaskQuery) lessDue(a, b int64) bool {
	if a == 0 {
		return false
	}
	if b == 0 {
		return true
	}
	return ordered(a < b, q.Direction)
}

func ordered(ascending bool, direction string) bool {
	if direction == SortDesc {
		return !ascending
	}
	return ascending
}

// Paginate returns the requested page and whether more items follow.
func Paginate[T any](items []T, page, perPage int) ([]T, bool) {
	start := page * perPage
	if start >= len(items) {
		return []T{}, false
	}
	end := min(start+perPage, len(items))
	return items[start:end], end < len(items)
}
