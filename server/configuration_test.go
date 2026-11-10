package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestEventDurationMinutes(t *testing.T) {
	for value, want := range map[int]int{0: 60, -5: 60, 4: 60, 5: 5, 30: 30, 1440: 1440, 1441: 60} {
		assert.Equal(t, want, (&configuration{DefaultEventDurationMinutes: value}).eventDurationMinutes(), value)
	}
}
