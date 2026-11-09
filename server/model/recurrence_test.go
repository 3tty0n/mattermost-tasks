package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func utcMillis(year int, month time.Month, day, hour int) int64 {
	return time.Date(year, month, day, hour, 0, 0, 0, time.UTC).UnixMilli()
}

func TestNormalizeRecurrence(t *testing.T) {
	due := utcMillis(2026, time.January, 31, 0)

	t.Run("none is nil", func(t *testing.T) {
		normalized, err := NormalizeRecurrence(nil, due, false)
		require.NoError(t, err)
		assert.Nil(t, normalized)

		normalized, err = NormalizeRecurrence(&Recurrence{Frequency: RecurrenceNone}, due, false)
		require.NoError(t, err)
		assert.Nil(t, normalized)
	})

	t.Run("fills defaults", func(t *testing.T) {
		normalized, err := NormalizeRecurrence(&Recurrence{Frequency: RecurrenceMonthly, TimeZone: "UTC"}, due, false)
		require.NoError(t, err)
		require.NotNil(t, normalized)
		assert.Equal(t, RecurrenceMonthly, normalized.Frequency)
		assert.Equal(t, 1, normalized.Interval)
		assert.Equal(t, "2026-01-31", normalized.StartDate)
		assert.Equal(t, "UTC", normalized.TimeZone)
	})

	t.Run("keeps an existing start date after the series advances", func(t *testing.T) {
		advancedDue := utcMillis(2026, time.February, 28, 0)
		normalized, err := NormalizeRecurrence(&Recurrence{
			Frequency: RecurrenceMonthly,
			StartDate: "2026-01-31",
			TimeZone:  "UTC",
		}, advancedDue, false)
		require.NoError(t, err)
		require.NotNil(t, normalized)
		assert.Equal(t, "2026-01-31", normalized.StartDate)
	})

	t.Run("validates input", func(t *testing.T) {
		for _, recurrence := range []*Recurrence{
			{Frequency: RecurrenceDaily, Interval: MaxRecurrenceInterval + 1},
			{Frequency: "hourly"},
			{Frequency: RecurrenceDaily, TimeZone: "Not/AZone"},
			{Frequency: RecurrenceDaily, Until: utcMillis(2026, time.January, 30, 0)},
		} {
			_, err := NormalizeRecurrence(recurrence, due, false)
			assert.Error(t, err)
		}
		_, err := NormalizeRecurrence(&Recurrence{Frequency: RecurrenceDaily}, 0, false)
		assert.Error(t, err)
	})

	t.Run("keeps the local start date for timed tasks", func(t *testing.T) {
		// 2026-01-05 09:00 Asia/Tokyo is 2026-01-05 00:00 UTC.
		dueAt := utcMillis(2026, time.January, 5, 0)
		normalized, err := NormalizeRecurrence(&Recurrence{Frequency: RecurrenceDaily, TimeZone: "Asia/Tokyo"}, dueAt, true)
		require.NoError(t, err)
		require.NotNil(t, normalized)
		assert.Equal(t, "2026-01-05", normalized.StartDate)
	})
}

func TestRecurrenceNextDueAt(t *testing.T) {
	normalized := func(t *testing.T, frequency string, interval int, due int64, timeZone string, until int64) *Recurrence {
		t.Helper()
		recurrence, err := NormalizeRecurrence(&Recurrence{Frequency: frequency, Interval: interval, TimeZone: timeZone, Until: until}, due, false)
		require.NoError(t, err)
		require.NotNil(t, recurrence)
		return recurrence
	}

	t.Run("daily", func(t *testing.T) {
		due := utcMillis(2026, time.January, 5, 0)
		recurrence := normalized(t, RecurrenceDaily, 1, due, "UTC", 0)

		next, ok := recurrence.NextDueAt(due, false, due)
		require.True(t, ok)
		assert.Equal(t, utcMillis(2026, time.January, 6, 0), next)

		next, ok = recurrence.NextDueAt(due, false, utcMillis(2026, time.January, 10, 0))
		require.True(t, ok)
		assert.Equal(t, utcMillis(2026, time.January, 11, 0), next)

		everyTwo := normalized(t, RecurrenceDaily, 2, due, "UTC", 0)
		next, ok = everyTwo.NextDueAt(due, false, due)
		require.True(t, ok)
		assert.Equal(t, utcMillis(2026, time.January, 7, 0), next)
	})

	t.Run("weekly", func(t *testing.T) {
		due := utcMillis(2026, time.January, 5, 0) // Monday
		recurrence := normalized(t, RecurrenceWeekly, 1, due, "UTC", 0)

		next, ok := recurrence.NextDueAt(due, false, due)
		require.True(t, ok)
		assert.Equal(t, utcMillis(2026, time.January, 12, 0), next)

		next, ok = recurrence.NextDueAt(due, false, utcMillis(2026, time.January, 7, 0))
		require.True(t, ok)
		assert.Equal(t, utcMillis(2026, time.January, 12, 0), next)

		everyTwo := normalized(t, RecurrenceWeekly, 2, due, "UTC", 0)
		next, ok = everyTwo.NextDueAt(due, false, due)
		require.True(t, ok)
		assert.Equal(t, utcMillis(2026, time.January, 19, 0), next)
	})

	t.Run("monthly clamps to the end of the month", func(t *testing.T) {
		due := utcMillis(2026, time.January, 31, 0)
		recurrence := normalized(t, RecurrenceMonthly, 1, due, "UTC", 0)

		next, ok := recurrence.NextDueAt(due, false, due)
		require.True(t, ok)
		assert.Equal(t, utcMillis(2026, time.February, 28, 0), next)

		next, ok = recurrence.NextDueAt(next, false, next)
		require.True(t, ok)
		assert.Equal(t, utcMillis(2026, time.March, 31, 0), next)
	})

	t.Run("yearly handles leap days", func(t *testing.T) {
		due := utcMillis(2024, time.February, 29, 0)
		recurrence := normalized(t, RecurrenceYearly, 1, due, "UTC", 0)

		next, ok := recurrence.NextDueAt(due, false, due)
		require.True(t, ok)
		assert.Equal(t, utcMillis(2025, time.February, 28, 0), next)

		next, ok = recurrence.NextDueAt(next, false, next)
		require.True(t, ok)
		assert.Equal(t, utcMillis(2026, time.February, 28, 0), next)

		everyFour := normalized(t, RecurrenceYearly, 4, due, "UTC", 0)
		next, ok = everyFour.NextDueAt(due, false, due)
		require.True(t, ok)
		assert.Equal(t, utcMillis(2028, time.February, 29, 0), next)
	})

	t.Run("stops after the end date", func(t *testing.T) {
		due := utcMillis(2026, time.January, 5, 0)
		recurrence := normalized(t, RecurrenceDaily, 1, due, "UTC", utcMillis(2026, time.January, 7, 0))

		next, ok := recurrence.NextDueAt(due, false, utcMillis(2026, time.January, 6, 0))
		require.True(t, ok)
		assert.Equal(t, utcMillis(2026, time.January, 7, 0), next)

		_, ok = recurrence.NextDueAt(next, false, next)
		assert.False(t, ok)
	})

	t.Run("preserves the local time", func(t *testing.T) {
		due := time.Date(2026, time.January, 5, 9, 0, 0, 0, time.FixedZone("JST", 9*60*60)).UnixMilli()
		recurrence, err := NormalizeRecurrence(&Recurrence{Frequency: RecurrenceDaily, TimeZone: "Asia/Tokyo"}, due, true)
		require.NoError(t, err)
		require.NotNil(t, recurrence)

		next, ok := recurrence.NextDueAt(due, true, due)
		require.True(t, ok)
		assert.Equal(t, time.Date(2026, time.January, 6, 9, 0, 0, 0, time.FixedZone("JST", 9*60*60)).UnixMilli(), next)
	})
}

func TestRecurrenceOverlaps(t *testing.T) {
	recurrence := &Recurrence{Frequency: RecurrenceDaily, Interval: 1, StartDate: "2026-01-01", TimeZone: "UTC"}
	assert.True(t, recurrence.Overlaps(utcMillis(2026, time.January, 1, 0), utcMillis(2025, time.December, 1, 0), utcMillis(2026, time.January, 10, 0)))
	assert.False(t, recurrence.Overlaps(utcMillis(2026, time.January, 20, 0), 0, utcMillis(2026, time.January, 10, 0)))

	ended := &Recurrence{Frequency: RecurrenceDaily, Interval: 1, StartDate: "2026-01-01", Until: utcMillis(2026, time.January, 5, 0)}
	assert.False(t, ended.Overlaps(utcMillis(2026, time.January, 1, 0), utcMillis(2026, time.January, 6, 0), utcMillis(2026, time.January, 10, 0)))
	assert.True(t, ended.Overlaps(utcMillis(2026, time.January, 1, 0), utcMillis(2026, time.January, 5, 0), utcMillis(2026, time.January, 10, 0)))
}
