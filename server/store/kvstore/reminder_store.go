package kvstore

import (
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
)

const reminderBucketMs = 3600_000 // one KV record per hour of fire times

// ReminderEntry is one pending reminder: the item, how many minutes before its start, and the
// Unix-ms fire time. It is a pointer, not a copy: the scheduler re-validates it against the live
// record when it fires, so edits and deletes never need to remove entries.
type ReminderEntry struct {
	Kind   string `json:"k"` // "task" or "event"
	ID     string `json:"i"`
	Offset int    `json:"o"`
	At     int64  `json:"a"`
}

// ReminderStore is the persistence used by the reminder scheduler.
type ReminderStore interface {
	AddReminders(entries []ReminderEntry) error
	PopDueReminders(hour, now int64) ([]ReminderEntry, error)
	GetReminderCursor() (int64, error)
	SetReminderCursor(at int64) error
}

var _ ReminderStore = (*KVStore)(nil)

const reminderCursorKey = "reminder_cursor"

// ReminderHour is the bucket an instant falls in.
func ReminderHour(at int64) int64 { return at / reminderBucketMs }

func reminderKey(hour int64) string { return "reminder:" + strconv.FormatInt(hour, 10) }

func decodeReminders(raw []byte) ([]ReminderEntry, error) {
	if len(raw) == 0 {
		return nil, nil
	}
	var entries []ReminderEntry
	if err := json.Unmarshal(raw, &entries); err != nil {
		return nil, fmt.Errorf("failed to decode reminder bucket: %w", err)
	}
	return entries, nil
}

// AddReminders adds entries to their hour buckets, skipping duplicates.
func (s *KVStore) AddReminders(entries []ReminderEntry) error {
	byHour := map[int64][]ReminderEntry{}
	for _, entry := range entries {
		hour := ReminderHour(entry.At)
		byHour[hour] = append(byHour[hour], entry)
	}
	for hour, add := range byHour {
		err := s.kv.Update(reminderKey(hour), func(old []byte) (any, error) {
			current, err := decodeReminders(old)
			if err != nil {
				return nil, err
			}
			changed := false
			for _, entry := range add {
				if !slices.Contains(current, entry) {
					current = append(current, entry)
					changed = true
				}
			}
			if !changed {
				return nil, ErrNoChange
			}
			return current, nil
		})
		if err != nil {
			return err
		}
	}
	return nil
}

// PopDueReminders removes and returns the entries of one bucket that are due at now. Delivery is
// at-most-once: a crash after the pop loses that batch rather than sending it twice.
func (s *KVStore) PopDueReminders(hour, now int64) ([]ReminderEntry, error) {
	var due []ReminderEntry
	err := s.kv.Update(reminderKey(hour), func(old []byte) (any, error) {
		due = nil
		current, err := decodeReminders(old)
		if err != nil {
			return nil, err
		}
		var rest []ReminderEntry
		for _, entry := range current {
			if entry.At <= now {
				due = append(due, entry)
			} else {
				rest = append(rest, entry)
			}
		}
		if len(due) == 0 {
			return nil, ErrNoChange
		}
		if len(rest) == 0 {
			return nil, nil // deletes the bucket
		}
		return rest, nil
	})
	return due, err
}

// GetReminderCursor returns the time up to which reminders were processed (0 if never).
func (s *KVStore) GetReminderCursor() (int64, error) {
	var at int64
	err := s.kv.Get(reminderCursorKey, &at)
	return at, err
}

// SetReminderCursor records the processed-up-to time.
func (s *KVStore) SetReminderCursor(at int64) error {
	_, err := s.kv.Set(reminderCursorKey, at)
	return err
}
