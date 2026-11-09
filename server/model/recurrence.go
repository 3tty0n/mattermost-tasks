package model

import (
	"fmt"
	"slices"
	"strings"
	"time"
)

// Recurrence frequencies.
const (
	RecurrenceDaily   = "daily"
	RecurrenceWeekly  = "weekly"
	RecurrenceMonthly = "monthly"
	RecurrenceYearly  = "yearly"
	RecurrenceNone    = "none"
)

const (
	MaxRecurrenceInterval = 99
	maxRecurrenceDueAt    = 253402300799999 // 9999-12-31T23:59:59.999Z
	maxLoopIterations     = 100000
)

var recurrenceFrequencies = []string{RecurrenceDaily, RecurrenceWeekly, RecurrenceMonthly, RecurrenceYearly}

// Recurrence describes a repeating due date. The first occurrence is the task's due date.
// StartDate is the stable calendar date used for monthly/yearly cadence; it stays put when the
// task advances to its next occurrence, so a task due on the 31st keeps using month ends.
type Recurrence struct {
	Frequency string `json:"frequency"`
	Interval  int    `json:"interval,omitempty"`
	StartDate string `json:"startDate,omitempty"`
	Until     int64  `json:"until,omitempty"`
	TimeZone  string `json:"timezone,omitempty"`
}

// IsZero reports whether the recurrence is empty (no repeat).
func (r *Recurrence) IsZero() bool {
	return r == nil || r.Frequency == "" || r.Frequency == RecurrenceNone
}

// NormalizeRecurrence validates a recurrence and fills in its defaults. A missing or "none"
// recurrence normalizes to nil. The task must have a due date to repeat.
func NormalizeRecurrence(input *Recurrence, dueAt int64, dueHasTime bool) (*Recurrence, error) {
	if input.IsZero() {
		return nil, nil
	}
	if dueAt <= 0 || dueAt > maxRecurrenceDueAt {
		return nil, fmt.Errorf("%w: a repeat requires a due date", ErrInvalid)
	}

	frequency := strings.ToLower(strings.TrimSpace(input.Frequency))
	if !slices.Contains(recurrenceFrequencies, frequency) {
		return nil, fmt.Errorf("%w: unknown repeat frequency", ErrInvalid)
	}
	interval := input.Interval
	if interval == 0 {
		interval = 1
	}
	if interval < 1 || interval > MaxRecurrenceInterval {
		return nil, fmt.Errorf("%w: repeat interval must be between 1 and %d", ErrInvalid, MaxRecurrenceInterval)
	}

	timeZone := strings.TrimSpace(input.TimeZone)
	if timeZone == "" {
		timeZone = "UTC"
	}
	if len(timeZone) > 64 {
		return nil, fmt.Errorf("%w: invalid repeat timezone", ErrInvalid)
	}
	loc, err := time.LoadLocation(timeZone)
	if err != nil {
		return nil, fmt.Errorf("%w: unknown repeat timezone", ErrInvalid)
	}

	dueStart := recurrenceStartDate(dueAt, dueHasTime, loc)
	start := dueStart
	if input.StartDate != "" {
		// Keep the original cadence when only the title or other details change. The caller
		// clears StartDate when the due date itself moves.
		if parsed, parseErr := parseCivilDate(input.StartDate); parseErr == nil && parsed.compare(start) <= 0 {
			start = parsed
		}
	}

	var until int64
	if input.Until != 0 {
		if input.Until < 0 || input.Until > maxRecurrenceDueAt {
			return nil, fmt.Errorf("%w: invalid repeat end", ErrInvalid)
		}
		untilTime := time.UnixMilli(input.Until).UTC()
		untilDate := civilDate{year: untilTime.Year(), month: untilTime.Month(), day: untilTime.Day()}
		if untilDate.compare(dueStart) < 0 {
			return nil, fmt.Errorf("%w: repeat end must not be before the due date", ErrInvalid)
		}
		until = time.Date(untilDate.year, untilDate.month, untilDate.day, 0, 0, 0, 0, time.UTC).UnixMilli()
	}

	return &Recurrence{
		Frequency: frequency,
		Interval:  interval,
		StartDate: start.key(),
		Until:     until,
		TimeZone:  timeZone,
	}, nil
}

// NextDueAt returns the first occurrence strictly after the later of the current occurrence and
// today. It returns false once the series has passed its end date.
func (r *Recurrence) NextDueAt(dueAt int64, dueHasTime bool, now int64) (int64, bool) {
	if r.IsZero() || dueAt <= 0 {
		return 0, false
	}
	loc := recurrenceLocation(r.TimeZone)
	start, err := parseCivilDate(r.StartDate)
	if err != nil {
		return 0, false
	}
	currentTime := time.UnixMilli(dueAt)
	current := recurrenceCivil(currentTime, dueHasTime, loc)
	today := civilDateFromTime(time.UnixMilli(now).In(loc))
	base := current
	if today.compare(base) > 0 {
		base = today
	}

	next, ok := r.nextAfter(start, base)
	if !ok {
		return 0, false
	}
	if r.Until != 0 {
		until := time.UnixMilli(r.Until).UTC()
		untilDate := civilDate{year: until.Year(), month: until.Month(), day: until.Day()}
		if next.compare(untilDate) > 0 {
			return 0, false
		}
	}

	var nextAt int64
	if dueHasTime {
		clock := currentTime.In(loc)
		nextAt = time.Date(next.year, next.month, next.day, clock.Hour(), clock.Minute(), clock.Second(), clock.Nanosecond(), loc).UnixMilli()
	} else {
		nextAt = time.Date(next.year, next.month, next.day, 0, 0, 0, 0, time.UTC).UnixMilli()
	}
	if nextAt <= dueAt || nextAt > maxRecurrenceDueAt {
		return 0, false
	}
	return nextAt, true
}

// Overlaps reports whether the series can have an occurrence inside a query's due range. The
// calendar client filters the exact days; this only discards series that start after the range or
// ended before it.
func (r *Recurrence) Overlaps(dueAt, after, before int64) bool {
	if r.IsZero() || dueAt <= 0 {
		return false
	}
	if before != 0 && dueAt >= before {
		return false
	}
	if r.Until != 0 && after != 0 && r.Until < after {
		return false
	}
	return true
}

func (r *Recurrence) nextAfter(start, base civilDate) (civilDate, bool) {
	interval := max(1, r.Interval)
	switch r.Frequency {
	case RecurrenceDaily:
		diff := start.daysUntil(base)
		steps := (diff / interval) + 1
		return start.addDays(steps * interval), true
	case RecurrenceWeekly:
		diff := start.daysUntil(base)
		steps := (diff / (7 * interval)) + 1
		return start.addDays(steps * 7 * interval), true
	case RecurrenceMonthly:
		for steps := 1; steps <= maxLoopIterations; steps++ {
			candidate := start.addMonths(steps * interval)
			if candidate.compare(base) > 0 {
				return candidate, true
			}
		}
	case RecurrenceYearly:
		for steps := 1; steps <= maxLoopIterations; steps++ {
			candidate := start.addYears(steps * interval)
			if candidate.compare(base) > 0 {
				return candidate, true
			}
		}
	}
	return civilDate{}, false
}

func recurrenceLocation(name string) *time.Location {
	if name == "" {
		return time.UTC
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.UTC
	}
	return loc
}

func recurrenceStartDate(dueAt int64, dueHasTime bool, loc *time.Location) civilDate {
	return recurrenceCivil(time.UnixMilli(dueAt), dueHasTime, loc)
}

func recurrenceCivil(at time.Time, hasTime bool, loc *time.Location) civilDate {
	if hasTime {
		return civilDateFromTime(at.In(loc))
	}
	return civilDateFromTime(at.UTC())
}

type civilDate struct {
	year  int
	month time.Month
	day   int
}

func civilDateFromTime(t time.Time) civilDate {
	return civilDate{year: t.Year(), month: t.Month(), day: t.Day()}
}

func parseCivilDate(value string) (civilDate, error) {
	parsed, err := time.Parse("2006-01-02", value)
	if err != nil {
		return civilDate{}, fmt.Errorf("%w: invalid repeat start date", ErrInvalid)
	}
	return civilDateFromTime(parsed), nil
}

func (d civilDate) key() string {
	return fmt.Sprintf("%04d-%02d-%02d", d.year, d.month, d.day)
}

func (d civilDate) compare(other civilDate) int {
	if d.year != other.year {
		return d.year - other.year
	}
	if d.month != other.month {
		return int(d.month) - int(other.month)
	}
	return d.day - other.day
}

func (d civilDate) daysUntil(other civilDate) int {
	from := time.Date(d.year, d.month, d.day, 0, 0, 0, 0, time.UTC)
	to := time.Date(other.year, other.month, other.day, 0, 0, 0, 0, time.UTC)
	return int(to.Sub(from) / (24 * time.Hour))
}

func (d civilDate) addDays(days int) civilDate {
	return civilDateFromTime(time.Date(d.year, d.month, d.day+days, 0, 0, 0, 0, time.UTC))
}

func (d civilDate) addMonths(months int) civilDate {
	index := (d.year * 12) + int(d.month) - 1 + months
	year := index / 12
	month := time.Month((index % 12) + 1)
	day := d.day
	if limit := daysInMonth(year, month); day > limit {
		day = limit
	}
	return civilDate{year: year, month: month, day: day}
}

func (d civilDate) addYears(years int) civilDate {
	return d.addMonths(years * 12)
}

func daysInMonth(year int, month time.Month) int {
	return time.Date(year, month+1, 0, 0, 0, 0, 0, time.UTC).Day()
}
