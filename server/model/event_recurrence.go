package model

import (
	"fmt"
	"slices"
	"strings"
	"time"
)

// Event recurrence frequencies. Weekly recurrences may select several weekdays.
const (
	EventRecurrenceDaily   = "daily"
	EventRecurrenceWeekly  = "weekly"
	EventRecurrenceMonthly = "monthly"
	EventRecurrenceYearly  = "yearly"
	EventRecurrenceNone    = "none"
)

var eventRecurrenceFrequencies = []string{
	EventRecurrenceDaily,
	EventRecurrenceWeekly,
	EventRecurrenceMonthly,
	EventRecurrenceYearly,
}

// EventRecurrence describes how an event repeats. Weekdays are 0 (Sunday) through 6 (Saturday)
// and apply to weekly recurrences. Until is an inclusive YYYY-MM-DD date; empty means endless.
type EventRecurrence struct {
	Frequency string `json:"frequency"`
	Interval  int    `json:"interval,omitempty"`
	Weekdays  []int  `json:"weekdays,omitempty"`
	Until     string `json:"until,omitempty"`
}

// IsZero reports whether the recurrence is empty (no repeat).
func (r *EventRecurrence) IsZero() bool {
	return r == nil || r.Frequency == "" || r.Frequency == EventRecurrenceNone
}

// Clone returns a deep copy.
func (r *EventRecurrence) Clone() *EventRecurrence {
	if r == nil {
		return nil
	}
	clone := *r
	clone.Weekdays = slices.Clone(r.Weekdays)
	return &clone
}

// NormalizeEventRecurrence validates an event recurrence against the event's start.
func NormalizeEventRecurrence(input *EventRecurrence, startAt int64, timeZone string) (*EventRecurrence, error) {
	if input.IsZero() {
		return nil, nil
	}
	if startAt <= 0 || startAt > maxEventAt {
		return nil, fmt.Errorf("%w: a repeat requires a start time", ErrInvalid)
	}
	frequency := strings.ToLower(strings.TrimSpace(input.Frequency))
	if !slices.Contains(eventRecurrenceFrequencies, frequency) {
		return nil, fmt.Errorf("%w: unknown event repeat frequency", ErrInvalid)
	}
	interval := input.Interval
	if interval == 0 {
		interval = 1
	}
	if interval < 1 || interval > MaxRecurrenceInterval {
		return nil, fmt.Errorf("%w: event repeat interval must be between 1 and %d", ErrInvalid, MaxRecurrenceInterval)
	}

	weekdays := []int{}
	if frequency == EventRecurrenceWeekly {
		for _, weekday := range input.Weekdays {
			if weekday < 0 || weekday > 6 {
				return nil, fmt.Errorf("%w: invalid repeat weekday", ErrInvalid)
			}
			if !slices.Contains(weekdays, weekday) {
				weekdays = append(weekdays, weekday)
			}
		}
		slices.Sort(weekdays)
		if len(weekdays) == 0 {
			weekdays = []int{int(eventStartDate(startAt, timeZone).Weekday())}
		}
	}

	until := strings.TrimSpace(input.Until)
	if until != "" {
		parsed, err := time.Parse("2006-01-02", until)
		if err != nil {
			return nil, fmt.Errorf("%w: invalid repeat end date", ErrInvalid)
		}
		startDate := eventStartDate(startAt, timeZone)
		if parsed.Before(startDate) {
			return nil, fmt.Errorf("%w: repeat end must not be before the start date", ErrInvalid)
		}
		until = parsed.Format("2006-01-02")
	}

	return &EventRecurrence{
		Frequency: frequency,
		Interval:  interval,
		Weekdays:  weekdays,
		Until:     until,
	}, nil
}

func eventStartDate(startAt int64, timeZone string) time.Time {
	loc, err := time.LoadLocation(timeZone)
	if err != nil {
		loc = time.UTC
	}
	start := time.UnixMilli(startAt).In(loc)
	return time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
}
