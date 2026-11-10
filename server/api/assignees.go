package api

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/mattermost/mattermost/server/public/model"

	taskmodel "github.com/3tty0n/mattermost-tasks/server/model"
)

const (
	maxAssigneeResults = 50
	maxAssigneeQuery   = 100
)

type assigneeResponse struct {
	ID                string `json:"id"`
	Username          string `json:"username"`
	Nickname          string `json:"nickname,omitempty"`
	FirstName         string `json:"firstName,omitempty"`
	LastName          string `json:"lastName,omitempty"`
	LastPictureUpdate int64  `json:"lastPictureUpdate"`
}

// handleListAssignees returns users eligible for assignment in a scope. It uses the existing
// Mattermost user search/membership APIs, and re-checks that the requesting user can see the
// scope before revealing any names.
func (h *Handler) handleListAssignees(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	teamID := firstValue(query, "team_id")
	channelID := firstValue(query, "channel_id")
	search := strings.TrimSpace(firstValue(query, "q"))
	if len(search) > maxAssigneeQuery {
		writeServiceError(w, r, fmt.Errorf("%w: search term is too long", taskmodel.ErrInvalid), "Failed to list assignees")
		return
	}

	scope, err := h.access.Resolve(actorID(r), teamID, channelID)
	if err != nil {
		writeServiceError(w, r, err, "Failed to list assignees")
		return
	}
	teamID = scope.TeamID

	var users []*model.User
	if search == "" {
		if channelID != "" {
			users, err = h.client.User.ListInChannel(channelID, "username", 0, maxAssigneeResults)
		} else {
			users, err = h.client.User.ListInTeam(teamID, 0, maxAssigneeResults)
		}
	} else {
		users, err = h.searchAssignees(teamID, channelID, search)
	}
	if err != nil {
		writeServiceError(w, r, err, "Failed to list assignees")
		return
	}

	result := make([]assigneeResponse, 0, len(users))
	for _, user := range users {
		if user == nil || user.DeleteAt > 0 || user.IsBot {
			continue
		}
		result = append(result, assigneeResponse{
			ID:                user.Id,
			Username:          user.Username,
			Nickname:          user.Nickname,
			FirstName:         user.FirstName,
			LastName:          user.LastName,
			LastPictureUpdate: user.LastPictureUpdate,
		})
	}
	writeJSON(w, r, http.StatusOK, result)
}

// searchAssignees uses Mattermost's user search, which matches username, first name, last name
// and nickname. If a custom server search returns nothing, fall back to the first page of scope
// members and match every token against those fields, so first/last name searches keep working.
func (h *Handler) searchAssignees(teamID, channelID, search string) ([]*model.User, error) {
	users, err := h.client.User.Search(&model.UserSearch{
		Term:          search,
		TeamId:        teamID,
		InChannelId:   channelID,
		AllowInactive: false,
		Limit:         maxAssigneeResults,
	})
	if err != nil || len(users) > 0 {
		return users, err
	}

	var members []*model.User
	if channelID != "" {
		members, err = h.client.User.ListInChannel(channelID, "username", 0, maxAssigneeResults)
	} else {
		members, err = h.client.User.ListInTeam(teamID, 0, maxAssigneeResults)
	}
	if err != nil {
		return nil, err
	}

	tokens := strings.Fields(strings.ToLower(search))
	result := make([]*model.User, 0, len(members))
	for _, user := range members {
		if user == nil || user.DeleteAt > 0 || user.IsBot {
			continue
		}
		haystack := strings.ToLower(strings.Join([]string{
			user.Username,
			user.FirstName,
			user.LastName,
			user.Nickname,
		}, " "))
		matches := true
		for _, token := range tokens {
			if !strings.Contains(haystack, token) {
				matches = false
				break
			}
		}
		if matches {
			result = append(result, user)
			if len(result) >= maxAssigneeResults {
				break
			}
		}
	}
	return result, nil
}
