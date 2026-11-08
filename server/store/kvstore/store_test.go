package kvstore

import (
	"fmt"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	taskmodel "github.com/3tty0n/mattermost-tasks/server/model"
)

func newTestStore() *KVStore {
	return NewStoreWithKV(NewMemoryKV(), WithClock(func() int64 { return 1000 }))
}

func testTask(id, teamID, channelID string, assignees ...string) *taskmodel.Task {
	return &taskmodel.Task{
		ID:          id,
		TeamID:      teamID,
		ChannelID:   channelID,
		Title:       "Task " + id,
		CreatorID:   "creator",
		AssigneeIDs: assignees,
		Status:      taskmodel.TaskStatusTodo,
		Priority:    taskmodel.TaskPriorityNormal,
		CreatedAt:   1,
		UpdatedAt:   1,
		Version:     1,
	}
}

func TestTaskStoreIndexLifecycle(t *testing.T) {
	store := newTestStore()
	task := testTask("task-1", "team-a", "channel-a", "user-1", "user-2")

	require.NoError(t, store.CreateTask(task))

	teamRefs, err := store.ListTaskRefsByTeam("team-a")
	require.NoError(t, err)
	require.Len(t, teamRefs, 1)
	assert.Equal(t, "task-1", teamRefs[0].ID)
	assert.Equal(t, "Task task-1", teamRefs[0].Title)

	channelRefs, err := store.ListTaskRefsByChannel("channel-a")
	require.NoError(t, err)
	require.Len(t, channelRefs, 1)

	for _, userID := range []string{"user-1", "user-2"} {
		userRefs, listErr := store.ListTaskRefsByUser(userID)
		require.NoError(t, listErr)
		require.Len(t, userRefs, 1, userID)
	}
	otherRefs, err := store.ListTaskRefsByUser("user-3")
	require.NoError(t, err)
	assert.Empty(t, otherRefs)

	// Updating display fields must update every index that stores them.
	updated, err := store.UpdateTask("task-1", func(current *taskmodel.Task) (*taskmodel.Task, error) {
		current.Title = "Renamed"
		current.Status = taskmodel.TaskStatusDone
		current.Priority = taskmodel.TaskPriorityUrgent
		return current, nil
	})
	require.NoError(t, err)
	assert.Equal(t, int64(2), updated.Version)
	assert.Equal(t, int64(1000), updated.UpdatedAt)

	teamRefs, err = store.ListTaskRefsByTeam("team-a")
	require.NoError(t, err)
	require.Len(t, teamRefs, 1)
	assert.Equal(t, "Renamed", teamRefs[0].Title)
	assert.Equal(t, taskmodel.TaskStatusDone, teamRefs[0].Status)
	assert.Equal(t, taskmodel.TaskPriorityUrgent, teamRefs[0].Priority)

	// Moving scope removes the old refs and adds the new ones.
	_, err = store.UpdateTask("task-1", func(current *taskmodel.Task) (*taskmodel.Task, error) {
		current.TeamID = "team-b"
		current.ChannelID = "channel-b"
		current.AssigneeIDs = []string{"user-2", "user-3"}
		return current, nil
	})
	require.NoError(t, err)

	oldTeam, err := store.ListTaskRefsByTeam("team-a")
	require.NoError(t, err)
	assert.Empty(t, oldTeam)
	oldChannel, err := store.ListTaskRefsByChannel("channel-a")
	require.NoError(t, err)
	assert.Empty(t, oldChannel)
	oldUser, err := store.ListTaskRefsByUser("user-1")
	require.NoError(t, err)
	assert.Empty(t, oldUser)

	newTeam, err := store.ListTaskRefsByTeam("team-b")
	require.NoError(t, err)
	require.Len(t, newTeam, 1)
	newChannel, err := store.ListTaskRefsByChannel("channel-b")
	require.NoError(t, err)
	require.Len(t, newChannel, 1)
	newUser, err := store.ListTaskRefsByUser("user-3")
	require.NoError(t, err)
	require.Len(t, newUser, 1)

	// Description-only changes do not rewrite index records.
	before, err := store.ListTaskRefsByTeam("team-b")
	require.NoError(t, err)
	_, err = store.UpdateTask("task-1", func(current *taskmodel.Task) (*taskmodel.Task, error) {
		current.Description = "details"
		return current, nil
	})
	require.NoError(t, err)
	after, err := store.ListTaskRefsByTeam("team-b")
	require.NoError(t, err)
	assert.Equal(t, before, after)

	// Deleting removes the full record and every ref.
	require.NoError(t, store.DeleteTask("task-1"))
	_, err = store.GetTask("task-1")
	assert.ErrorIs(t, err, ErrNotFound)
	newTeam, err = store.ListTaskRefsByTeam("team-b")
	require.NoError(t, err)
	assert.Empty(t, newTeam)
}

func TestTaskStoreRejectsDuplicate(t *testing.T) {
	store := newTestStore()
	task := testTask("task-1", "team", "", "user")
	require.NoError(t, store.CreateTask(task))
	assert.ErrorIs(t, store.CreateTask(task), ErrExists)
}

func TestTaskStoreUpdateAndDeleteNotFound(t *testing.T) {
	store := newTestStore()
	_, err := store.UpdateTask("missing", func(current *taskmodel.Task) (*taskmodel.Task, error) {
		return current, nil
	})
	assert.ErrorIs(t, err, ErrNotFound)
	assert.ErrorIs(t, store.DeleteTask("missing"), ErrNotFound)
}

func TestTaskStoreConcurrentUpdates(t *testing.T) {
	store := newTestStore()
	task := testTask("task-1", "team", "channel", "user")
	require.NoError(t, store.CreateTask(task))

	const updates = 20
	var wg sync.WaitGroup
	errs := make(chan error, updates)
	for i := range updates {
		wg.Go(func() {
			_, err := store.UpdateTask("task-1", func(current *taskmodel.Task) (*taskmodel.Task, error) {
				current.Title = fmt.Sprintf("Title %d", i)
				return current, nil
			})
			errs <- err
		})
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		require.NoError(t, err)
	}

	final, err := store.GetTask("task-1")
	require.NoError(t, err)
	assert.Equal(t, int64(updates+1), final.Version)

	refs, err := store.ListTaskRefsByTeam("team")
	require.NoError(t, err)
	require.Len(t, refs, 1)
	assert.Equal(t, final.Title, refs[0].Title)
}

func TestBookmarkStoreLifecycle(t *testing.T) {
	store := newTestStore()
	bookmark := &taskmodel.Bookmark{
		ID:        "bookmark-1",
		TeamID:    "team-a",
		ChannelID: "channel-a",
		URL:       "https://example.com",
		Title:     "Example",
		Tags:      []string{"docs"},
		CreatorID: "creator",
		CreatedAt: 1,
		UpdatedAt: 1,
		Version:   1,
	}
	require.NoError(t, store.CreateBookmark(bookmark))

	teamRefs, err := store.ListBookmarkRefsByTeam("team-a")
	require.NoError(t, err)
	require.Len(t, teamRefs, 1)
	assert.Equal(t, "https://example.com", teamRefs[0].URL)

	_, err = store.UpdateBookmark("bookmark-1", func(current *taskmodel.Bookmark) (*taskmodel.Bookmark, error) {
		current.Title = "Changed"
		current.Tags = []string{"work"}
		return current, nil
	})
	require.NoError(t, err)
	channelRefs, err := store.ListBookmarkRefsByChannel("channel-a")
	require.NoError(t, err)
	require.Len(t, channelRefs, 1)
	assert.Equal(t, "Changed", channelRefs[0].Title)
	assert.Equal(t, []string{"work"}, channelRefs[0].Tags)

	require.NoError(t, store.DeleteBookmark("bookmark-1"))
	_, err = store.GetBookmark("bookmark-1")
	assert.ErrorIs(t, err, ErrNotFound)
	teamRefs, err = store.ListBookmarkRefsByTeam("team-a")
	require.NoError(t, err)
	assert.Empty(t, teamRefs)
}

func TestMemoryKVCompareAndSet(t *testing.T) {
	kv := NewMemoryKV()
	saved, err := kv.CompareAndSet("key", nil, map[string]string{"a": "b"})
	require.NoError(t, err)
	assert.True(t, saved)

	saved, err = kv.CompareAndSet("key", []byte(`{"a":"c"}`), map[string]string{"a": "d"})
	require.NoError(t, err)
	assert.False(t, saved)

	var value map[string]string
	require.NoError(t, kv.Get("key", &value))
	assert.Equal(t, map[string]string{"a": "b"}, value)
}

func TestMemoryKVUpdateNoChange(t *testing.T) {
	kv := NewMemoryKV()
	require.NoError(t, kv.Update("key", func([]byte) (any, error) {
		return nil, ErrNoChange
	}))
	var raw []byte
	require.NoError(t, kv.Get("key", &raw))
	assert.Empty(t, raw)
}
