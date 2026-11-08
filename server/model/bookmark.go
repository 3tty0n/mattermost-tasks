package model

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"unicode/utf8"

	"github.com/mattermost/mattermost/server/public/model"
)

var (
	// ErrInvalid wraps all user-correctable input errors. The API maps it to 400.
	ErrInvalid = errors.New("invalid input")

	// ErrForbidden is returned when the actor may not perform the operation. Services return it
	// instead of exposing the underlying permission check.
	ErrForbidden = errors.New("forbidden")

	// ErrNotFound is returned when a record does not exist or the actor must not learn that it
	// exists. It is intentionally indistinguishable from a forbidden private record.
	ErrNotFound = errors.New("not found")

	// ErrConflict is returned when a compare-and-swap loop cannot make progress.
	ErrConflict = errors.New("conflict")
)

// ErrorMessage returns the user-facing part of a validation error, without the sentinel prefix.
func ErrorMessage(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	message = strings.TrimPrefix(message, ErrInvalid.Error()+": ")
	message = strings.TrimPrefix(message, ErrForbidden.Error()+": ")
	return message
}

// Bookmark is the full bookmark record.
type Bookmark struct {
	ID           string   `json:"id"`
	TeamID       string   `json:"teamId"`
	ChannelID    string   `json:"channelId,omitempty"`
	URL          string   `json:"url"`
	Title        string   `json:"title"`
	Description  string   `json:"description,omitempty"`
	Tags         []string `json:"tags"`
	CreatorID    string   `json:"creatorId"`
	SourcePostID string   `json:"sourcePostId,omitempty"`
	CreatedAt    int64    `json:"createdAt"`
	UpdatedAt    int64    `json:"updatedAt"`
	Version      int64    `json:"version"`
}

// Clone returns a deep copy.
func (b *Bookmark) Clone() *Bookmark {
	clone := *b
	clone.Tags = append([]string(nil), b.Tags...)
	return &clone
}

// BookmarkRef is the compact index representation.
type BookmarkRef struct {
	ID           string   `json:"i"`
	TeamID       string   `json:"t"`
	ChannelID    string   `json:"c,omitempty"`
	URL          string   `json:"l"`
	Title        string   `json:"n"`
	Tags         []string `json:"g,omitempty"`
	CreatorID    string   `json:"o"`
	SourcePostID string   `json:"x,omitempty"`
	CreatedAt    int64    `json:"k"`
	UpdatedAt    int64    `json:"u"`
	Version      int64    `json:"v"`
}

// Ref builds the index reference for a bookmark.
func (b *Bookmark) Ref() BookmarkRef {
	return BookmarkRef{
		ID:           b.ID,
		TeamID:       b.TeamID,
		ChannelID:    b.ChannelID,
		URL:          b.URL,
		Title:        truncateRunes(b.Title, MaxBookmarkTitleRunes),
		Tags:         append([]string(nil), b.Tags...),
		CreatorID:    b.CreatorID,
		SourcePostID: b.SourcePostID,
		CreatedAt:    b.CreatedAt,
		UpdatedAt:    b.UpdatedAt,
		Version:      b.Version,
	}
}

// BookmarkSummary is the list representation sent to the webapp. It intentionally omits the
// description, which can be large and is only needed in the editor.
type BookmarkSummary struct {
	ID           string   `json:"id"`
	TeamID       string   `json:"teamId"`
	ChannelID    string   `json:"channelId,omitempty"`
	URL          string   `json:"url"`
	Title        string   `json:"title"`
	Tags         []string `json:"tags"`
	CreatorID    string   `json:"creatorId"`
	SourcePostID string   `json:"sourcePostId,omitempty"`
	CreatedAt    int64    `json:"createdAt"`
	UpdatedAt    int64    `json:"updatedAt"`
}

// Summary converts an index reference to its API representation.
func (r BookmarkRef) Summary() BookmarkSummary {
	tags := append([]string{}, r.Tags...)
	return BookmarkSummary{
		ID:           r.ID,
		TeamID:       r.TeamID,
		ChannelID:    r.ChannelID,
		URL:          r.URL,
		Title:        r.Title,
		Tags:         tags,
		CreatorID:    r.CreatorID,
		SourcePostID: r.SourcePostID,
		CreatedAt:    r.CreatedAt,
		UpdatedAt:    r.UpdatedAt,
	}
}

// CreateBookmarkInput is the validated input to bookmarks.Service.Create.
type CreateBookmarkInput struct {
	TeamID       string
	ChannelID    string
	URL          string
	Title        string
	Description  string
	Tags         []string
	SourcePostID string
}

// BookmarkPatch is a partial update. A nil pointer means "leave unchanged".
type BookmarkPatch struct {
	TeamID       *string
	ChannelID    *string
	Title        *string
	Description  *string
	URL          *string
	Tags         *[]string
	SourcePostID *string
}

// IsZero reports whether the patch changes nothing.
func (p BookmarkPatch) IsZero() bool {
	return p.TeamID == nil && p.ChannelID == nil && p.Title == nil && p.Description == nil &&
		p.URL == nil && p.Tags == nil && p.SourcePostID == nil
}

// NormalizeURL validates a bookmark URL. Only http(s) URLs are accepted; credentials in the URL
// are rejected so a bookmark can never smuggle a password into a rendered link.
func NormalizeURL(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("%w: URL is required", ErrInvalid)
	}
	if len(value) > MaxURLBytes {
		return "", fmt.Errorf("%w: URL is longer than %d bytes", ErrInvalid, MaxURLBytes)
	}
	parsed, err := url.Parse(value)
	if err != nil {
		return "", fmt.Errorf("%w: URL is not valid", ErrInvalid)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("%w: only http and https URLs are supported", ErrInvalid)
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("%w: URL must include a host", ErrInvalid)
	}
	if parsed.User != nil {
		return "", fmt.Errorf("%w: URLs with credentials are not allowed", ErrInvalid)
	}
	return parsed.String(), nil
}

// NormalizeTitleAndDescription validates bookmark text fields.
func NormalizeBookmarkTitle(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("%w: title is required", ErrInvalid)
	}
	if utf8.RuneCountInString(value) > MaxBookmarkTitleRunes {
		return "", fmt.Errorf("%w: title is longer than %d characters", ErrInvalid, MaxBookmarkTitleRunes)
	}
	return value, nil
}

// NormalizeTags trims, de-duplicates (case-insensitively) and validates tags.
func NormalizeTags(tags []string) ([]string, error) {
	if len(tags) > MaxTags {
		return nil, fmt.Errorf("%w: too many tags", ErrInvalid)
	}
	seen := make(map[string]struct{}, len(tags))
	out := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if utf8.RuneCountInString(tag) > MaxTagRunes {
			return nil, fmt.Errorf("%w: tags are limited to %d characters", ErrInvalid, MaxTagRunes)
		}
		key := strings.ToLower(tag)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, tag)
	}
	if out == nil {
		out = []string{}
	}
	return out, nil
}

// ValidateSourcePost checks the ID shape of a source post.
func ValidateSourcePost(postID string) error {
	if postID != "" && !model.IsValidId(postID) {
		return fmt.Errorf("%w: invalid source post", ErrInvalid)
	}
	return nil
}
