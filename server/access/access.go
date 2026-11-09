// Package access centralizes the Mattermost permission checks used by tasks and the
// slash commands. Every entry point uses these functions so a route can not accidentally skip a
// membership check.
package access

import (
	"errors"
	"fmt"

	"github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/pluginapi"

	taskmodel "github.com/3tty0n/mattermost-tasks/server/model"
)

// Scope is a resolved team/channel pair. Channel is nil for team-level records.
type Scope struct {
	TeamID    string
	ChannelID string
	Channel   *model.Channel
	Team      *model.Team
}

// Checker wraps a plugin API client.
type Checker struct {
	client *pluginapi.Client
}

// NewChecker returns a Checker for the given client.
func NewChecker(client *pluginapi.Client) *Checker {
	return &Checker{client: client}
}

// CanViewTeam reports whether the user may see team-level records.
func (c *Checker) CanViewTeam(userID, teamID string) bool {
	return c.client.User.HasPermissionToTeam(userID, teamID, model.PermissionViewTeam)
}

// CanViewChannel reports whether the user may see records in a channel. This is the check that
// keeps private channel tasks inside their channel; being assigned to a task is
// never accepted as a substitute.
func (c *Checker) CanViewChannel(userID, channelID string) bool {
	return c.client.User.HasPermissionToChannel(userID, channelID, model.PermissionReadChannel)
}

// CanView reports access to a stored team/channel pair without fetching metadata.
func (c *Checker) CanView(userID, teamID, channelID string) bool {
	if channelID != "" {
		return c.CanViewChannel(userID, channelID)
	}
	if teamID == "" {
		return false
	}
	return c.CanViewTeam(userID, teamID)
}

// IsAdmin reports whether the user has the system administration permission.
func (c *Checker) IsAdmin(userID string) bool {
	return c.client.User.HasPermissionTo(userID, model.PermissionManageSystem)
}

// Resolve validates a requested scope, normalizes the team from the channel, and checks that the
// user may create or view records in it. Only open and private channels are valid scopes: tasks
// in DMs or group messages would not have a team to belong to.
func (c *Checker) Resolve(userID, teamID, channelID string) (*Scope, error) {
	if teamID != "" && !model.IsValidId(teamID) {
		return nil, fmt.Errorf("%w: invalid team", taskmodel.ErrInvalid)
	}
	if channelID != "" && !model.IsValidId(channelID) {
		return nil, fmt.Errorf("%w: invalid channel", taskmodel.ErrInvalid)
	}

	if channelID == "" {
		if teamID == "" {
			return nil, fmt.Errorf("%w: a team or channel is required", taskmodel.ErrInvalid)
		}
		team, err := c.getTeam(teamID)
		if err != nil {
			return nil, err
		}
		if !c.CanViewTeam(userID, teamID) {
			return nil, taskmodel.ErrForbidden
		}
		return &Scope{TeamID: teamID, Team: team}, nil
	}

	channel, err := c.getChannel(channelID)
	if err != nil {
		return nil, err
	}
	if channel.Type != model.ChannelTypeOpen && channel.Type != model.ChannelTypePrivate {
		return nil, fmt.Errorf("%w: tasks can only belong to public or private channels", taskmodel.ErrInvalid)
	}
	if teamID != "" && channel.TeamId != teamID {
		return nil, fmt.Errorf("%w: channel does not belong to the team", taskmodel.ErrInvalid)
	}
	if !c.CanViewChannel(userID, channelID) {
		return nil, taskmodel.ErrForbidden
	}
	return &Scope{TeamID: channel.TeamId, ChannelID: channel.Id, Channel: channel}, nil
}

// CanAssign reports whether a user is eligible to be assigned in a resolved scope.
func (c *Checker) CanAssign(assigneeID string, scope *Scope) bool {
	if scope == nil {
		return false
	}
	if scope.ChannelID != "" {
		return c.CanViewChannel(assigneeID, scope.ChannelID)
	}
	return c.CanViewTeam(assigneeID, scope.TeamID)
}

// ResolvePost loads a post and the scope it belongs to, checking read access. It is used when a
// task is created from a post so the client can not attach a record to a channel the
// user can not read.
func (c *Checker) ResolvePost(userID, postID string) (*Scope, error) {
	if !model.IsValidId(postID) {
		return nil, fmt.Errorf("%w: invalid post", taskmodel.ErrInvalid)
	}
	post, err := c.client.Post.GetPost(postID)
	if err != nil {
		if errors.Is(err, pluginapi.ErrNotFound) {
			return nil, taskmodel.ErrNotFound
		}
		return nil, fmt.Errorf("failed to get source post: %w", err)
	}
	if post.DeleteAt > 0 {
		return nil, taskmodel.ErrNotFound
	}
	channel, err := c.getChannel(post.ChannelId)
	if err != nil {
		return nil, err
	}
	if channel.Type != model.ChannelTypeOpen && channel.Type != model.ChannelTypePrivate {
		return nil, fmt.Errorf("%w: posts in direct messages can not be turned into tasks", taskmodel.ErrInvalid)
	}
	if !c.CanViewChannel(userID, channel.Id) {
		return nil, taskmodel.ErrForbidden
	}
	return &Scope{TeamID: channel.TeamId, ChannelID: channel.Id, Channel: channel}, nil
}

func (c *Checker) getTeam(teamID string) (*model.Team, error) {
	team, err := c.client.Team.Get(teamID)
	if err != nil {
		if errors.Is(err, pluginapi.ErrNotFound) {
			return nil, taskmodel.ErrNotFound
		}
		return nil, fmt.Errorf("failed to get team: %w", err)
	}
	return team, nil
}

func (c *Checker) getChannel(channelID string) (*model.Channel, error) {
	channel, err := c.client.Channel.Get(channelID)
	if err != nil {
		if errors.Is(err, pluginapi.ErrNotFound) {
			return nil, taskmodel.ErrNotFound
		}
		return nil, fmt.Errorf("failed to get channel: %w", err)
	}
	return channel, nil
}

// ResolveTeamName fetches a team name for notification links.
func (c *Checker) ResolveTeamName(teamID string) (string, error) {
	team, err := c.getTeam(teamID)
	if err != nil {
		return "", err
	}
	return team.Name, nil
}

// ResolveChannelName fetches a channel name for notification links.
func (c *Checker) ResolveChannelName(channelID string) (string, error) {
	channel, err := c.getChannel(channelID)
	if err != nil {
		return "", err
	}
	return channel.Name, nil
}
