package kvstore

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"sync"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/pluginapi"

	taskmodel "github.com/3tty0n/mattermost-tasks/server/model"
)

const (
	// indexShards bounds the size of each index record and spreads CAS contention. A list reads
	// all shards once; four small reads are cheaper than one huge record on a 1 vCPU server.
	indexShards = 4

	// lockStripes serializes record writes on this node. The plugin server also runs CAS, so this
	// is an optimization, not the correctness boundary.
	lockStripes = 64

	casRetries = 5
)

// Store is the persistence interface used by the task service.
type Store interface {
	GetTask(id string) (*taskmodel.Task, error)
	CreateTask(task *taskmodel.Task) error
	UpdateTask(id string, mutate func(current *taskmodel.Task) (*taskmodel.Task, error)) (*taskmodel.Task, error)
	DeleteTask(id string) error
	ListTaskRefsByTeam(teamID string) ([]taskmodel.TaskRef, error)
	ListTaskRefsByChannel(channelID string) ([]taskmodel.TaskRef, error)
	ListTaskRefsByUser(userID string) ([]taskmodel.TaskRef, error)
}

// Option configures a Store.
type Option func(*KVStore)

// WithClock replaces the timestamp source, for tests.
func WithClock(now func() int64) Option {
	return func(s *KVStore) {
		s.now = now
	}
}

// KVStore is the plugin-KV implementation of Store.
type KVStore struct {
	kv    KV
	now   func() int64
	locks [lockStripes]sync.Mutex
}

// NewStore returns a Store backed by the live Mattermost plugin KV store.
func NewStore(client *pluginapi.Client) *KVStore {
	return NewStoreWithKV(pluginKV{client: client})
}

// NewStoreWithKV returns a Store backed by an arbitrary KV implementation.
func NewStoreWithKV(kv KV, opts ...Option) *KVStore {
	s := &KVStore{kv: kv, now: model.GetMillis}
	for _, opt := range opts {
		opt(s)
	}
	return s
}

// Ensure Store implements the interface.
var _ Store = (*KVStore)(nil)

func taskKey(id string) string {
	return "task:" + id
}

func indexKey(prefix, scopeID string, shard int) string {
	return prefix + scopeID + ":" + strconv.Itoa(shard)
}

func shardFor(id string) int {
	return int(fnv32a(id) % indexShards)
}

func fnv32a(value string) uint32 {
	const (
		offset32 = 2166136261
		prime32  = 16777619
	)
	hash := uint32(offset32)
	for i := 0; i < len(value); i++ {
		hash ^= uint32(value[i])
		hash *= prime32
	}
	return hash
}

func (s *KVStore) lock(key string) *sync.Mutex {
	return &s.locks[fnv32a(key)%lockStripes]
}

func (s *KVStore) GetTask(id string) (*taskmodel.Task, error) {
	var task taskmodel.Task
	if err := s.kv.Get(taskKey(id), &task); err != nil {
		return nil, err
	}
	if task.ID == "" {
		return nil, ErrNotFound
	}
	if task.AssigneeIDs == nil {
		task.AssigneeIDs = []string{}
	}
	return &task, nil
}

func (s *KVStore) CreateTask(task *taskmodel.Task) error {
	lock := s.lock(taskKey(task.ID))
	lock.Lock()
	defer lock.Unlock()

	var existing []byte
	if err := s.kv.Get(taskKey(task.ID), &existing); err != nil {
		return err
	}
	if len(existing) > 0 {
		return ErrExists
	}
	if task.Version == 0 {
		task.Version = 1
	}
	if _, err := s.kv.Set(taskKey(task.ID), task); err != nil {
		return err
	}
	if err := s.syncTaskRefs(nil, task); err != nil {
		// Best-effort rollback so a failed index write does not leave an unlisted task.
		_ = s.kv.Delete(taskKey(task.ID))
		_ = s.syncTaskRefs(task, nil)
		return fmt.Errorf("failed to update task indexes: %w", err)
	}
	return nil
}

func (s *KVStore) UpdateTask(id string, mutate func(current *taskmodel.Task) (*taskmodel.Task, error)) (*taskmodel.Task, error) {
	lock := s.lock(taskKey(id))
	lock.Lock()
	defer lock.Unlock()

	for range casRetries {
		var raw []byte
		if err := s.kv.Get(taskKey(id), &raw); err != nil {
			return nil, err
		}
		if len(raw) == 0 {
			return nil, ErrNotFound
		}
		var current taskmodel.Task
		if err := json.Unmarshal(raw, &current); err != nil {
			return nil, fmt.Errorf("failed to decode task: %w", err)
		}
		next, err := mutate(current.Clone())
		if err != nil {
			return nil, err
		}
		if next == nil {
			return nil, ErrNotFound
		}
		next.ID = current.ID
		next.CreatorID = current.CreatorID
		next.CreatedAt = current.CreatedAt
		next.Version = current.Version + 1
		next.UpdatedAt = s.now()
		if next.AssigneeIDs == nil {
			next.AssigneeIDs = []string{}
		}

		saved, err := s.kv.CompareAndSet(taskKey(id), raw, next)
		if err != nil {
			return nil, err
		}
		if !saved {
			continue
		}
		if err := s.syncTaskRefs(&current, next); err != nil {
			return next, fmt.Errorf("failed to update task indexes: %w", err)
		}
		return next, nil
	}
	return nil, taskmodel.ErrConflict
}

func (s *KVStore) DeleteTask(id string) error {
	lock := s.lock(taskKey(id))
	lock.Lock()
	defer lock.Unlock()

	var raw []byte
	if err := s.kv.Get(taskKey(id), &raw); err != nil {
		return err
	}
	if len(raw) == 0 {
		return ErrNotFound
	}
	var current taskmodel.Task
	if err := json.Unmarshal(raw, &current); err != nil {
		return fmt.Errorf("failed to decode task: %w", err)
	}
	if err := s.kv.Delete(taskKey(id)); err != nil {
		return err
	}
	if err := s.syncTaskRefs(&current, nil); err != nil {
		return fmt.Errorf("failed to update task indexes: %w", err)
	}
	return nil
}

func (s *KVStore) ListTaskRefsByTeam(teamID string) ([]taskmodel.TaskRef, error) {
	return s.readTaskRefs("task_team:", teamID)
}

func (s *KVStore) ListTaskRefsByChannel(channelID string) ([]taskmodel.TaskRef, error) {
	return s.readTaskRefs("task_channel:", channelID)
}

func (s *KVStore) ListTaskRefsByUser(userID string) ([]taskmodel.TaskRef, error) {
	return s.readTaskRefs("task_user:", userID)
}

func (s *KVStore) readTaskRefs(prefix, scopeID string) ([]taskmodel.TaskRef, error) {
	refs := make([]taskmodel.TaskRef, 0, 64)
	for shard := range indexShards {
		var shardRefs []taskmodel.TaskRef
		if err := s.kv.Get(indexKey(prefix, scopeID, shard), &shardRefs); err != nil {
			return nil, fmt.Errorf("failed to read task index shard: %w", err)
		}
		refs = append(refs, shardRefs...)
	}
	return refs, nil
}

func (s *KVStore) syncTaskRefs(oldTask, nextTask *taskmodel.Task) error {
	var errs []error
	if oldTask != nil && nextTask != nil {
		oldValue, nextValue := oldTask.Ref(), nextTask.Ref()
		if taskRefFieldsEqual(&oldValue, &nextValue) {
			return nil
		}
	}

	oldTeam, newTeam := "", ""
	var oldRef, newRef taskmodel.TaskRef
	if oldTask != nil {
		oldTeam = oldTask.TeamID
		oldRef = oldTask.Ref()
	}
	if nextTask != nil {
		newTeam = nextTask.TeamID
		newRef = nextTask.Ref()
	}
	oldTeamIndexed := indexedInTeam(oldTask)
	newTeamIndexed := indexedInTeam(nextTask)

	switch {
	case oldTeam != newTeam || oldTeamIndexed != newTeamIndexed:
		if oldTeamIndexed {
			if err := s.removeTaskRef("task_team:", oldTeam, oldTask.ID); err != nil {
				errs = append(errs, err)
			}
		}
		if newTeamIndexed {
			if err := s.upsertTaskRef("task_team:", newTeam, newRef); err != nil {
				errs = append(errs, err)
			}
		}
	case oldTeamIndexed && oldTask != nil && nextTask != nil:
		if err := s.upsertTaskRef("task_team:", newTeam, newRef); err != nil {
			errs = append(errs, err)
		}
	}

	oldChannel, newChannel := "", ""
	if oldTask != nil {
		oldChannel = oldTask.ChannelID
	}
	if nextTask != nil {
		newChannel = nextTask.ChannelID
	}
	oldChannelIndexed := indexedInChannel(oldTask)
	newChannelIndexed := indexedInChannel(nextTask)
	switch {
	case oldChannel != newChannel || oldChannelIndexed != newChannelIndexed:
		if oldChannelIndexed {
			if err := s.removeTaskRef("task_channel:", oldChannel, oldTask.ID); err != nil {
				errs = append(errs, err)
			}
		}
		if newChannelIndexed {
			if err := s.upsertTaskRef("task_channel:", newChannel, newRef); err != nil {
				errs = append(errs, err)
			}
		}
	case oldChannelIndexed && oldTask != nil && nextTask != nil:
		if err := s.upsertTaskRef("task_channel:", newChannel, newRef); err != nil {
			errs = append(errs, err)
		}
	}

	users := make(map[string]struct{}, len(oldRef.AssigneeIDs)+len(newRef.AssigneeIDs))
	for _, userID := range oldRef.AssigneeIDs {
		users[userID] = struct{}{}
	}
	for _, userID := range newRef.AssigneeIDs {
		users[userID] = struct{}{}
	}
	for userID := range users {
		inOld := slices.Contains(oldRef.AssigneeIDs, userID)
		inNew := slices.Contains(newRef.AssigneeIDs, userID)
		switch {
		case inOld && !inNew:
			if err := s.removeTaskRef("task_user:", userID, oldRef.ID); err != nil {
				errs = append(errs, err)
			}
		case inNew:
			if err := s.upsertTaskRef("task_user:", userID, newRef); err != nil {
				errs = append(errs, err)
			}
		}
	}
	return errors.Join(errs...)
}

func indexedInTeam(task *taskmodel.Task) bool {
	return task != nil && task.TeamID != "" && task.EffectiveVisibility() != taskmodel.TaskVisibilityPrivate
}

func indexedInChannel(task *taskmodel.Task) bool {
	return task != nil && task.ChannelID != "" && task.EffectiveVisibility() == taskmodel.TaskVisibilityChannel
}

func (s *KVStore) upsertTaskRef(prefix, scopeID string, ref taskmodel.TaskRef) error {
	if scopeID == "" {
		return nil
	}
	key := indexKey(prefix, scopeID, shardFor(ref.ID))
	return s.kv.Update(key, func(oldValue []byte) (any, error) {
		refs, err := decodeTaskRefs(oldValue)
		if err != nil {
			return nil, err
		}
		for i := range refs {
			if refs[i].ID != ref.ID {
				continue
			}
			if refs[i].Version > ref.Version || taskRefFieldsEqual(&refs[i], &ref) {
				return nil, ErrNoChange
			}
			refs[i] = ref
			return refs, nil
		}
		refs = append(refs, ref)
		return refs, nil
	})
}

func (s *KVStore) removeTaskRef(prefix, scopeID, taskID string) error {
	if scopeID == "" || taskID == "" {
		return nil
	}
	key := indexKey(prefix, scopeID, shardFor(taskID))
	return s.kv.Update(key, func(oldValue []byte) (any, error) {
		refs, err := decodeTaskRefs(oldValue)
		if err != nil {
			return nil, err
		}
		for i := range refs {
			if refs[i].ID != taskID {
				continue
			}
			refs = append(refs[:i], refs[i+1:]...)
			return refs, nil
		}
		return nil, ErrNoChange
	})
}

func decodeTaskRefs(raw []byte) ([]taskmodel.TaskRef, error) {
	if len(raw) == 0 {
		return []taskmodel.TaskRef{}, nil
	}
	var refs []taskmodel.TaskRef
	if err := json.Unmarshal(raw, &refs); err != nil {
		return nil, fmt.Errorf("failed to decode task index: %w", err)
	}
	if refs == nil {
		refs = []taskmodel.TaskRef{}
	}
	return refs, nil
}

func recurrenceEqual(a, b *taskmodel.Recurrence) bool {
	if a == nil || b == nil {
		return a == b
	}
	return *a == *b
}

func taskRefFieldsEqual(a, b *taskmodel.TaskRef) bool {
	return a.TeamID == b.TeamID &&
		a.ChannelID == b.ChannelID &&
		a.Visibility == b.Visibility &&
		a.CreatorID == b.CreatorID &&
		a.Title == b.Title &&
		a.Status == b.Status &&
		a.Priority == b.Priority &&
		a.DueAt == b.DueAt &&
		a.DueHasTime == b.DueHasTime &&
		recurrenceEqual(a.Recurrence, b.Recurrence) &&
		a.Position == b.Position &&
		a.CreatedAt == b.CreatedAt &&
		slices.Equal(a.AssigneeIDs, b.AssigneeIDs)
}
