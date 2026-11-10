package model

import (
	"fmt"
	"slices"
	"time"
)

// ReminderOffsets are the allowed "minutes before the due/start time" choices:
// at the time, 5/10/15 minutes, 1 day, 1 week.
var ReminderOffsets = []int{0, 5, 10, 15, 24 * 60, 7 * 24 * 60}

// NormalizeReminders validates the offsets and returns them de-duplicated and sorted.
func NormalizeReminders(input []int) ([]int, error) {
	out := make([]int, 0, len(input))
	for _, offset := range input {
		if !slices.Contains(ReminderOffsets, offset) {
			return nil, fmt.Errorf("%w: unknown reminder offset", ErrInvalid)
		}
		if !slices.Contains(out, offset) {
			out = append(out, offset)
		}
	}
	slices.Sort(out)
	if len(out) == 0 {
		return nil, nil
	}
	return out, nil
}

// NextStart returns the first occurrence start strictly after the given time (Unix ms). It mirrors
// the webapp's calendar expansion, so reminders fire for the occurrences users see.
func (e *Event) NextStart(after int64) (int64, bool) {
	if e.Recurrence.IsZero() {
		return e.StartAt, e.StartAt > after
	}
	loc := time.UTC
	if !e.AllDay {
		if l, err := time.LoadLocation(e.TimeZone); err == nil {
			loc = l
		}
	}
	anchorTime := time.UnixMilli(e.StartAt).In(loc)
	anchor := utcMidnight(anchorTime)
	day := utcMidnight(time.UnixMilli(after).In(loc)).AddDate(0, 0, -2)
	if day.Before(anchor) {
		day = anchor
	}
	// shortcut: scans at most ~100 years of days per call, enough for the 99-year interval cap.
	for range 36600 {
		if e.Recurrence.Until != "" && day.Format("2006-01-02") > e.Recurrence.Until {
			return 0, false
		}
		if e.Recurrence.matches(day, anchor) {
			start := day.UnixMilli()
			if !e.AllDay {
				start = time.Date(day.Year(), day.Month(), day.Day(), anchorTime.Hour(), anchorTime.Minute(), 0, 0, loc).UnixMilli()
			}
			if start > after {
				return start, true
			}
		}
		day = day.AddDate(0, 0, 1)
	}
	return 0, false
}

func utcMidnight(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func (r *EventRecurrence) matches(day, anchor time.Time) bool {
	if day.Before(anchor) {
		return false
	}
	if day.Equal(anchor) {
		return true
	}
	interval := max(r.Interval, 1)
	dayDiff := int(day.Sub(anchor).Hours() / 24)
	switch r.Frequency {
	case EventRecurrenceDaily:
		return dayDiff%interval == 0
	case EventRecurrenceWeekly:
		weekdays := r.Weekdays
		if len(weekdays) == 0 {
			weekdays = []int{int(anchor.Weekday())}
		}
		if !slices.Contains(weekdays, int(day.Weekday())) {
			return false
		}
		weekDiff := int(day.Sub(anchor.AddDate(0, 0, -int(anchor.Weekday()))).Hours() / 24 / 7)
		return weekDiff >= 0 && weekDiff%interval == 0
	case EventRecurrenceMonthly:
		months := (day.Year()-anchor.Year())*12 + int(day.Month()-anchor.Month())
		return months >= 0 && months%interval == 0 && day.Day() == min(anchor.Day(), daysInMonth(day.Year(), day.Month()))
	case EventRecurrenceYearly:
		return (day.Year()-anchor.Year())%interval == 0 && day.Month() == anchor.Month() &&
			day.Day() == min(anchor.Day(), daysInMonth(day.Year(), day.Month()))
	}
	return false
}
