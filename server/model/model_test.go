package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTaskQueryNormalize(t *testing.T) {
	t.Run("defaults", func(t *testing.T) {
		q := TaskQuery{}
		require.NoError(t, q.Normalize())
		assert.Equal(t, TaskScopeMy, q.Scope)
		assert.Equal(t, TaskSortDue, q.SortBy)
		assert.Equal(t, SortAsc, q.Direction)
		assert.Equal(t, DefaultPageSize, q.PerPage)
	})

	t.Run("validates required scope IDs", func(t *testing.T) {
		for _, q := range []TaskQuery{
			{Scope: TaskScopeTeam},
			{Scope: TaskScopeChannel},
			{Scope: "unknown"},
			{Scope: TaskScopeTeam, TeamID: "not-an-id"},
			{Scope: TaskScopeChannel, ChannelID: "not-an-id"},
		} {
			assert.Error(t, q.Normalize())
		}
	})

	t.Run("validates filters", func(t *testing.T) {
		before := int64(100)
		after := int64(200)
		for _, q := range []TaskQuery{
			{Statuses: []string{"blocked"}},
			{Priority: "whenever"},
			{SortBy: "assignee"},
			{Direction: "sideways"},
			{DueBefore: &before, DueAfter: &after},
			{Page: -1},
			{PerPage: MaxPageSize + 1},
		} {
			assert.Error(t, q.Normalize())
		}
	})

	t.Run("deduplicates statuses and applies page bounds", func(t *testing.T) {
		q := TaskQuery{Statuses: []string{TaskStatusTodo, TaskStatusTodo, TaskStatusDone}, PerPage: MaxPageSize}
		require.NoError(t, q.Normalize())
		assert.Equal(t, []string{TaskStatusTodo, TaskStatusDone}, q.Statuses)
		assert.Equal(t, MaxPageSize, q.PerPage)
	})
}

func ref(id, status string, due, created int64, priority string) TaskRef {
	return TaskRef{ID: id, Status: status, DueAt: due, CreatedAt: created, Priority: priority}
}

func TestTaskQueryMatch(t *testing.T) {
	dueBefore := int64(1000)
	dueAfter := int64(100)
	hasDue := true
	noDue := false
	assignee := "user-id"
	query := TaskQuery{
		Statuses:   []string{TaskStatusTodo},
		Priority:   TaskPriorityHigh,
		AssigneeID: assignee,
		DueAfter:   &dueAfter,
		DueBefore:  &dueBefore,
	}

	task := TaskRef{
		Status:      TaskStatusTodo,
		Priority:    TaskPriorityHigh,
		AssigneeIDs: []string{assignee},
		DueAt:       500,
	}
	assert.True(t, query.Match(task))
	assert.False(t, query.Match(TaskRef{Status: TaskStatusDone, Priority: TaskPriorityHigh, AssigneeIDs: []string{assignee}, DueAt: 500}))
	assert.False(t, query.Match(TaskRef{Status: TaskStatusTodo, Priority: TaskPriorityLow, AssigneeIDs: []string{assignee}, DueAt: 500}))
	assert.False(t, query.Match(TaskRef{Status: TaskStatusTodo, Priority: TaskPriorityHigh, AssigneeIDs: []string{"other"}, DueAt: 500}))
	assert.False(t, query.Match(TaskRef{Status: TaskStatusTodo, Priority: TaskPriorityHigh, AssigneeIDs: []string{assignee}}))
	assert.False(t, query.Match(TaskRef{Status: TaskStatusTodo, Priority: TaskPriorityHigh, AssigneeIDs: []string{assignee}, DueAt: 2000}))

	withDue := TaskQuery{HasDue: &hasDue}
	assert.False(t, withDue.Match(TaskRef{}))
	withoutDue := TaskQuery{HasDue: &noDue}
	assert.True(t, withoutDue.Match(TaskRef{}))
	assert.False(t, withoutDue.Match(TaskRef{DueAt: 5}))
}

func TestTaskQuerySort(t *testing.T) {
	refs := []TaskRef{
		ref("c", TaskStatusTodo, 0, 30, TaskPriorityLow),
		ref("a", TaskStatusTodo, 200, 10, TaskPriorityUrgent),
		ref("b", TaskStatusTodo, 100, 20, TaskPriorityNormal),
	}
	copyRefs := func() []TaskRef {
		return append([]TaskRef(nil), refs...)
	}

	t.Run("due ascending keeps no-due last", func(t *testing.T) {
		items := copyRefs()
		q := TaskQuery{SortBy: TaskSortDue, Direction: SortAsc}
		q.Sort(items)
		assert.Equal(t, []string{"b", "a", "c"}, ids(items))
	})

	t.Run("due descending", func(t *testing.T) {
		items := copyRefs()
		q := TaskQuery{SortBy: TaskSortDue, Direction: SortDesc}
		q.Sort(items)
		assert.Equal(t, []string{"a", "b", "c"}, ids(items))
	})

	t.Run("created", func(t *testing.T) {
		items := copyRefs()
		q := TaskQuery{SortBy: TaskSortCreated, Direction: SortAsc}
		q.Sort(items)
		assert.Equal(t, []string{"a", "b", "c"}, ids(items))
	})

	t.Run("priority", func(t *testing.T) {
		items := copyRefs()
		q := TaskQuery{SortBy: TaskSortPriority, Direction: SortDesc}
		q.Sort(items)
		assert.Equal(t, []string{"a", "b", "c"}, ids(items))
	})

	t.Run("priority ascending", func(t *testing.T) {
		items := copyRefs()
		q := TaskQuery{SortBy: TaskSortPriority, Direction: SortAsc}
		q.Sort(items)
		assert.Equal(t, []string{"c", "b", "a"}, ids(items))
	})
}

func ids(refs []TaskRef) []string {
	out := make([]string, len(refs))
	for i, ref := range refs {
		out[i] = ref.ID
	}
	return out
}

func TestPaginate(t *testing.T) {
	items := []int{1, 2, 3, 4, 5}
	page, more := Paginate(items, 0, 2)
	assert.Equal(t, []int{1, 2}, page)
	assert.True(t, more)

	page, more = Paginate(items, 2, 2)
	assert.Equal(t, []int{5}, page)
	assert.False(t, more)

	page, more = Paginate(items, 3, 2)
	assert.Empty(t, page)
	assert.NotNil(t, page)
	assert.False(t, more)
}

func TestNormalizeURL(t *testing.T) {
	tests := []struct {
		name    string
		input   string
		want    string
		wantErr bool
	}{
		{name: "https", input: "https://example.com/path?q=1", want: "https://example.com/path?q=1"},
		{name: "http", input: "http://example.com", want: "http://example.com"},
		{name: "empty", input: "", wantErr: true},
		{name: "javascript", input: "javascript:alert(1)", wantErr: true},
		{name: "file", input: "file:///etc/passwd", wantErr: true},
		{name: "credentials", input: "https://user" + ":pass@example.com", wantErr: true}, //nolint:gosec // test fixture for the credential rejection path
		{name: "no host", input: "https:///path", wantErr: true},
		{name: "too long", input: "https://example.com/" + string(make([]byte, MaxURLBytes)), wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeURL(tt.input)
			if tt.wantErr {
				require.Error(t, err)
				assert.ErrorIs(t, err, ErrInvalid)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}
}

func TestNormalizeIDs(t *testing.T) {
	valid := "0123456789abcdefghijklmnop"
	got, err := NormalizeIDs([]string{valid, " " + valid + " "}, "assignees", 10)
	require.NoError(t, err)
	assert.Equal(t, []string{valid}, got)

	got, err = NormalizeIDs(nil, "assignees", 10)
	require.NoError(t, err)
	assert.NotNil(t, got)
	assert.Empty(t, got)

	_, err = NormalizeIDs([]string{"bad"}, "assignees", 10)
	assert.ErrorIs(t, err, ErrInvalid)

	_, err = NormalizeIDs([]string{valid, valid}, "assignees", 1)
	assert.ErrorIs(t, err, ErrInvalid)
}

func TestNormalizeTags(t *testing.T) {
	tags, err := NormalizeTags([]string{"Work", " work ", "urgent"})
	require.NoError(t, err)
	assert.Equal(t, []string{"Work", "urgent"}, tags)

	tags, err = NormalizeTags(nil)
	require.NoError(t, err)
	assert.NotNil(t, tags)
	assert.Empty(t, tags)

	_, err = NormalizeTags([]string{string(make([]rune, MaxTagRunes+1))})
	assert.ErrorIs(t, err, ErrInvalid)
}

func TestBookmarkQueryMatchAndSort(t *testing.T) {
	query := BookmarkQuery{Search: "docs", Tag: "work", PerPage: 10}
	require.NoError(t, query.Normalize())
	ref := BookmarkRef{Title: "Team docs", URL: "https://example.com", Tags: []string{"Work"}}
	assert.True(t, query.Match(ref))
	assert.False(t, query.Match(BookmarkRef{Title: "Team docs", URL: "https://example.com", Tags: []string{"home"}}))

	refs := []BookmarkRef{
		{ID: "a", CreatedAt: 1, Title: "a"},
		{ID: "b", CreatedAt: 3, Title: "b"},
		{ID: "c", CreatedAt: 2, Title: "c"},
	}
	SortBookmarks(refs)
	assert.Equal(t, []string{"b", "c", "a"}, []string{refs[0].ID, refs[1].ID, refs[2].ID})
}

func TestTaskRefSummaryDoesNotExposeVersion(t *testing.T) {
	task := &Task{ID: "id", TeamID: "team", Title: "Title", Status: TaskStatusTodo, AssigneeIDs: []string{"u"}, Version: 7}
	ref := task.Ref()
	assert.Equal(t, int64(7), ref.Version)
	summary := ref.Summary()
	assert.Equal(t, "Title", summary.Title)
	assert.Equal(t, []string{"u"}, summary.AssigneeIDs)
}

func TestSummariesUseEmptySlicesForMissingLists(t *testing.T) {
	taskSummary := TaskRef{ID: "id"}.Summary()
	assert.NotNil(t, taskSummary.AssigneeIDs)
	assert.Empty(t, taskSummary.AssigneeIDs)

	bookmarkSummary := BookmarkRef{ID: "id"}.Summary()
	assert.NotNil(t, bookmarkSummary.Tags)
	assert.Empty(t, bookmarkSummary.Tags)
}

func TestTruncateRunes(t *testing.T) {
	assert.Equal(t, "abc", truncateRunes("abc", 3))
	assert.Equal(t, "あい", truncateRunes("あいう", 2))
}
