package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNormalizeEventRecurrence(t *testing.T) {
	start := time.Date(2026, time.January, 7, 9, 0, 0, 0, time.UTC).UnixMilli()

	recurrence, err := NormalizeEventRecurrence(&EventRecurrence{
		Frequency: EventRecurrenceWeekly,
		Weekdays:  []int{5, 1, 5},
		Until:     "2026-02-01",
	}, start, "UTC")
	require.NoError(t, err)
	require.NotNil(t, recurrence)
	assert.Equal(t, EventRecurrenceWeekly, recurrence.Frequency)
	assert.Equal(t, 1, recurrence.Interval)
	assert.Equal(t, []int{1, 5}, recurrence.Weekdays)
	assert.Equal(t, "2026-02-01", recurrence.Until)

	weekly, err := NormalizeEventRecurrence(&EventRecurrence{Frequency: EventRecurrenceWeekly}, start, "UTC")
	require.NoError(t, err)
	require.NotNil(t, weekly)
	assert.Empty(t, weekly.Weekdays)

	daily, err := NormalizeEventRecurrence(&EventRecurrence{Frequency: EventRecurrenceDaily, Interval: 2}, start, "UTC")
	require.NoError(t, err)
	require.NotNil(t, daily)
	assert.Equal(t, 2, daily.Interval)
	assert.Empty(t, daily.Weekdays)

	_, err = NormalizeEventRecurrence(&EventRecurrence{Frequency: EventRecurrenceWeekly, Until: "2026-01-01"}, start, "UTC")
	assert.ErrorIs(t, err, ErrInvalid)

	_, err = NormalizeEventRecurrence(&EventRecurrence{Frequency: EventRecurrenceWeekly, Weekdays: []int{9}}, start, "UTC")
	assert.ErrorIs(t, err, ErrInvalid)

	cleared, err := NormalizeEventRecurrence(&EventRecurrence{Frequency: EventRecurrenceNone}, start, "UTC")
	require.NoError(t, err)
	assert.Nil(t, cleared)
}
