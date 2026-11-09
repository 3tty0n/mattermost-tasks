package model

import (
	"errors"
	"strings"
)

var (
	// ErrInvalid wraps user-correctable input errors. The API maps it to 400.
	ErrInvalid = errors.New("invalid input")

	// ErrForbidden is returned when the actor may not perform the operation.
	ErrForbidden = errors.New("forbidden")

	// ErrNotFound is returned when a record does not exist or must not be disclosed.
	ErrNotFound = errors.New("not found")

	// ErrConflict is returned when a compare-and-swap loop cannot make progress.
	ErrConflict = errors.New("conflict")
)

// ErrorMessage returns the user-facing part of a validation error.
func ErrorMessage(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	message = strings.TrimPrefix(message, ErrInvalid.Error()+": ")
	message = strings.TrimPrefix(message, ErrForbidden.Error()+": ")
	return message
}
