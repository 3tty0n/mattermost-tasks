package kvstore

import (
	"encoding/json"
	"errors"
	"fmt"
	"slices"

	taskmodel "github.com/3tty0n/mattermost-tasks/server/model"
)

// EventStore is the persistence interface used by the event service.
type EventStore interface {
	GetEvent(id string) (*taskmodel.Event, error)
	CreateEvent(event *taskmodel.Event) error
	UpdateEvent(id string, mutate func(current *taskmodel.Event) (*taskmodel.Event, error)) (*taskmodel.Event, error)
	DeleteEvent(id string) error
	ListEventRefsByTeam(teamID string) ([]taskmodel.EventRef, error)
	ListEventRefsByChannel(channelID string) ([]taskmodel.EventRef, error)
	ListEventRefsByUser(userID string) ([]taskmodel.EventRef, error)
}

var _ EventStore = (*KVStore)(nil)

func eventKey(id string) string {
	return "event:" + id
}

func (s *KVStore) GetEvent(id string) (*taskmodel.Event, error) {
	var event taskmodel.Event
	if err := s.kv.Get(eventKey(id), &event); err != nil {
		return nil, err
	}
	if event.ID == "" {
		return nil, ErrNotFound
	}
	return &event, nil
}

func (s *KVStore) CreateEvent(event *taskmodel.Event) error {
	lock := s.lock(eventKey(event.ID))
	lock.Lock()
	defer lock.Unlock()

	var existing []byte
	if err := s.kv.Get(eventKey(event.ID), &existing); err != nil {
		return err
	}
	if len(existing) > 0 {
		return ErrExists
	}
	if event.Version == 0 {
		event.Version = 1
	}
	if _, err := s.kv.Set(eventKey(event.ID), event); err != nil {
		return err
	}
	if err := s.syncEventRefs(nil, event); err != nil {
		_ = s.kv.Delete(eventKey(event.ID))
		_ = s.syncEventRefs(event, nil)
		return fmt.Errorf("failed to update event indexes: %w", err)
	}
	return nil
}

func (s *KVStore) UpdateEvent(id string, mutate func(current *taskmodel.Event) (*taskmodel.Event, error)) (*taskmodel.Event, error) {
	lock := s.lock(eventKey(id))
	lock.Lock()
	defer lock.Unlock()

	for range casRetries {
		var raw []byte
		if err := s.kv.Get(eventKey(id), &raw); err != nil {
			return nil, err
		}
		if len(raw) == 0 {
			return nil, ErrNotFound
		}
		var current taskmodel.Event
		if err := json.Unmarshal(raw, &current); err != nil {
			return nil, fmt.Errorf("failed to decode event: %w", err)
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

		saved, err := s.kv.CompareAndSet(eventKey(id), raw, next)
		if err != nil {
			return nil, err
		}
		if !saved {
			continue
		}
		if err := s.syncEventRefs(&current, next); err != nil {
			return next, fmt.Errorf("failed to update event indexes: %w", err)
		}
		return next, nil
	}
	return nil, taskmodel.ErrConflict
}

func (s *KVStore) DeleteEvent(id string) error {
	lock := s.lock(eventKey(id))
	lock.Lock()
	defer lock.Unlock()

	var raw []byte
	if err := s.kv.Get(eventKey(id), &raw); err != nil {
		return err
	}
	if len(raw) == 0 {
		return ErrNotFound
	}
	var current taskmodel.Event
	if err := json.Unmarshal(raw, &current); err != nil {
		return fmt.Errorf("failed to decode event: %w", err)
	}
	if err := s.kv.Delete(eventKey(id)); err != nil {
		return err
	}
	if err := s.syncEventRefs(&current, nil); err != nil {
		return fmt.Errorf("failed to update event indexes: %w", err)
	}
	return nil
}

func (s *KVStore) ListEventRefsByTeam(teamID string) ([]taskmodel.EventRef, error) {
	return s.readEventRefs("event_team:", teamID)
}

func (s *KVStore) ListEventRefsByChannel(channelID string) ([]taskmodel.EventRef, error) {
	return s.readEventRefs("event_channel:", channelID)
}

func (s *KVStore) ListEventRefsByUser(userID string) ([]taskmodel.EventRef, error) {
	return s.readEventRefs("event_user:", userID)
}

func (s *KVStore) readEventRefs(prefix, scopeID string) ([]taskmodel.EventRef, error) {
	refs := make([]taskmodel.EventRef, 0, 64)
	for shard := range indexShards {
		var shardRefs []taskmodel.EventRef
		if err := s.kv.Get(indexKey(prefix, scopeID, shard), &shardRefs); err != nil {
			return nil, fmt.Errorf("failed to read event index shard: %w", err)
		}
		refs = append(refs, shardRefs...)
	}
	return refs, nil
}

func (s *KVStore) syncEventRefs(oldEvent, nextEvent *taskmodel.Event) error {
	var errs []error
	if oldEvent != nil && nextEvent != nil {
		oldValue, nextValue := oldEvent.Ref(), nextEvent.Ref()
		if eventRefFieldsEqual(&oldValue, &nextValue) {
			return nil
		}
	}

	oldTeam, newTeam := "", ""
	var oldRef, newRef taskmodel.EventRef
	if oldEvent != nil {
		oldTeam = oldEvent.TeamID
		oldRef = oldEvent.Ref()
	}
	if nextEvent != nil {
		newTeam = nextEvent.TeamID
		newRef = nextEvent.Ref()
	}
	oldTeamIndexed := indexedEventInTeam(oldEvent)
	newTeamIndexed := indexedEventInTeam(nextEvent)

	switch {
	case oldTeam != newTeam || oldTeamIndexed != newTeamIndexed:
		if oldTeamIndexed {
			if err := s.removeEventRef("event_team:", oldTeam, oldEvent.ID); err != nil {
				errs = append(errs, err)
			}
		}
		if newTeamIndexed {
			if err := s.upsertEventRef("event_team:", newTeam, newRef); err != nil {
				errs = append(errs, err)
			}
		}
	case oldTeamIndexed && oldEvent != nil && nextEvent != nil:
		if err := s.upsertEventRef("event_team:", newTeam, newRef); err != nil {
			errs = append(errs, err)
		}
	}

	oldChannel, newChannel := "", ""
	if oldEvent != nil {
		oldChannel = oldEvent.ChannelID
	}
	if nextEvent != nil {
		newChannel = nextEvent.ChannelID
	}
	oldChannelIndexed := indexedEventInChannel(oldEvent)
	newChannelIndexed := indexedEventInChannel(nextEvent)
	switch {
	case oldChannel != newChannel || oldChannelIndexed != newChannelIndexed:
		if oldChannelIndexed {
			if err := s.removeEventRef("event_channel:", oldChannel, oldEvent.ID); err != nil {
				errs = append(errs, err)
			}
		}
		if newChannelIndexed {
			if err := s.upsertEventRef("event_channel:", newChannel, newRef); err != nil {
				errs = append(errs, err)
			}
		}
	case oldChannelIndexed && oldEvent != nil && nextEvent != nil:
		if err := s.upsertEventRef("event_channel:", newChannel, newRef); err != nil {
			errs = append(errs, err)
		}
	}

	users := make(map[string]struct{}, len(oldRef.AssigneeIDs)+len(newRef.AssigneeIDs)+2)
	if oldRef.CreatorID != "" {
		users[oldRef.CreatorID] = struct{}{}
	}
	if newRef.CreatorID != "" {
		users[newRef.CreatorID] = struct{}{}
	}
	for _, userID := range oldRef.AssigneeIDs {
		users[userID] = struct{}{}
	}
	for _, userID := range newRef.AssigneeIDs {
		users[userID] = struct{}{}
	}
	for userID := range users {
		if userID == "" {
			continue
		}
		inOld := oldRef.CreatorID == userID || slices.Contains(oldRef.AssigneeIDs, userID)
		inNew := newRef.CreatorID == userID || slices.Contains(newRef.AssigneeIDs, userID)
		switch {
		case inOld && !inNew:
			if err := s.removeEventRef("event_user:", userID, oldRef.ID); err != nil {
				errs = append(errs, err)
			}
		case inNew:
			if err := s.upsertEventRef("event_user:", userID, newRef); err != nil {
				errs = append(errs, err)
			}
		}
	}
	return errors.Join(errs...)
}

func indexedEventInTeam(event *taskmodel.Event) bool {
	return event != nil && event.TeamID != "" && event.EffectiveVisibility() != taskmodel.TaskVisibilityPrivate
}

func indexedEventInChannel(event *taskmodel.Event) bool {
	return event != nil && event.ChannelID != "" && event.EffectiveVisibility() == taskmodel.TaskVisibilityChannel
}

func (s *KVStore) upsertEventRef(prefix, scopeID string, ref taskmodel.EventRef) error {
	if scopeID == "" {
		return nil
	}
	key := indexKey(prefix, scopeID, shardFor(ref.ID))
	return s.kv.Update(key, func(oldValue []byte) (any, error) {
		refs, err := decodeEventRefs(oldValue)
		if err != nil {
			return nil, err
		}
		for i := range refs {
			if refs[i].ID != ref.ID {
				continue
			}
			if refs[i].Version > ref.Version || eventRefFieldsEqual(&refs[i], &ref) {
				return nil, ErrNoChange
			}
			refs[i] = ref
			return refs, nil
		}
		refs = append(refs, ref)
		return refs, nil
	})
}

func (s *KVStore) removeEventRef(prefix, scopeID, eventID string) error {
	if scopeID == "" || eventID == "" {
		return nil
	}
	key := indexKey(prefix, scopeID, shardFor(eventID))
	return s.kv.Update(key, func(oldValue []byte) (any, error) {
		refs, err := decodeEventRefs(oldValue)
		if err != nil {
			return nil, err
		}
		for i := range refs {
			if refs[i].ID != eventID {
				continue
			}
			refs = append(refs[:i], refs[i+1:]...)
			return refs, nil
		}
		return nil, ErrNoChange
	})
}

func decodeEventRefs(raw []byte) ([]taskmodel.EventRef, error) {
	if len(raw) == 0 {
		return []taskmodel.EventRef{}, nil
	}
	var refs []taskmodel.EventRef
	if err := json.Unmarshal(raw, &refs); err != nil {
		return nil, fmt.Errorf("failed to decode event index shard: %w", err)
	}
	if refs == nil {
		refs = []taskmodel.EventRef{}
	}
	return refs, nil
}

func eventRefFieldsEqual(a, b *taskmodel.EventRef) bool {
	return a.TeamID == b.TeamID &&
		a.ChannelID == b.ChannelID &&
		a.Visibility == b.Visibility &&
		a.CreatorID == b.CreatorID &&
		slices.Equal(a.AssigneeIDs, b.AssigneeIDs) &&
		a.Title == b.Title &&
		a.StartAt == b.StartAt &&
		a.EndAt == b.EndAt &&
		a.AllDay == b.AllDay &&
		a.TimeZone == b.TimeZone &&
		eventRecurrenceEqual(a.Recurrence, b.Recurrence) &&
		slices.Equal(a.Reminders, b.Reminders) &&
		a.CreatedAt == b.CreatedAt
}

func eventRecurrenceEqual(a, b *taskmodel.EventRecurrence) bool {
	if a.IsZero() || b.IsZero() {
		return a.IsZero() && b.IsZero()
	}
	return a.Frequency == b.Frequency &&
		a.Interval == b.Interval &&
		slices.Equal(a.Weekdays, b.Weekdays) &&
		a.Until == b.Until
}
