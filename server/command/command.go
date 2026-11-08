// Package command implements the /task slash command. It is the fallback surface for mobile
// clients and keyboard users; it calls the same services as the REST API.
package command

import (
	"errors"
	"fmt"
	"net/url"
	"strings"

	mmodel "github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin"
	"github.com/mattermost/mattermost/server/public/pluginapi"

	"github.com/3tty0n/mattermost-tasks/server/bookmarks"
	"github.com/3tty0n/mattermost-tasks/server/model"
	"github.com/3tty0n/mattermost-tasks/server/tasks"
)

const trigger = "task"

// Command executes the plugin's slash command.
type Command interface {
	Handle(c *plugin.Context, args *mmodel.CommandArgs) (*mmodel.CommandResponse, error)
}

// Handler implements Command.
type Handler struct {
	client    *pluginapi.Client
	tasks     *tasks.Service
	bookmarks *bookmarks.Service
}

// NewCommandHandler registers the /task command and returns its handler.
func NewCommandHandler(client *pluginapi.Client, tasksService *tasks.Service, bookmarksService *bookmarks.Service) (Command, error) {
	autocomplete := mmodel.NewAutocompleteData(trigger, "[subcommand]", "Manage tasks and bookmarks")
	autocomplete.AddStaticListArgument("Subcommand", false, []mmodel.AutocompleteListItem{
		{Item: "list", HelpText: "Show tasks assigned to you"},
		{Item: "show", HelpText: "Show a task by ID"},
		{Item: "create", HelpText: "Create a task in this channel"},
		{Item: "done", HelpText: "Mark a task as done"},
		{Item: "bookmark", HelpText: "Save a URL bookmark in this channel"},
	})

	err := client.SlashCommand.Register(&mmodel.Command{
		Trigger:          trigger,
		AutoComplete:     true,
		AutoCompleteDesc: "Manage tasks and bookmarks",
		AutoCompleteHint: "[subcommand]",
		AutocompleteData: autocomplete,
	})
	if err != nil {
		return nil, fmt.Errorf("failed to register /%s command: %w", trigger, err)
	}
	return &Handler{client: client, tasks: tasksService, bookmarks: bookmarksService}, nil
}

// Handle is called from the ExecuteCommand hook for every command registered above.
func (h *Handler) Handle(c *plugin.Context, args *mmodel.CommandArgs) (*mmodel.CommandResponse, error) {
	fields := strings.Fields(args.Command)
	if len(fields) == 0 {
		return ephemeral(helpText()), nil
	}
	if strings.TrimPrefix(fields[0], "/") != trigger {
		return ephemeral("Unknown command."), nil
	}
	if len(fields) == 1 {
		return ephemeral(helpText()), nil
	}

	switch fields[1] {
	case "list":
		return h.list(args)
	case "show":
		return h.show(args, fields[2:])
	case "create":
		return h.create(c, args, fields[2:])
	case "done":
		return h.done(c, args, fields[2:])
	case "bookmark":
		return h.bookmark(c, args, fields[2:])
	case "help":
		return ephemeral(helpText()), nil
	default:
		return ephemeral("Unknown subcommand. Try `/task help`."), nil
	}
}

func helpText() string {
	return strings.Join([]string{
		"**Tasks & Bookmarks**",
		"- `/task list` — tasks assigned to you",
		"- `/task show <id>` — details for one task",
		"- `/task create <title>` — create a task in this channel, assigned to you",
		"- `/task done <id>` — mark a task done",
		"- `/task bookmark <url> [title]` — save a URL in this channel",
	}, "\n")
}

func (h *Handler) list(args *mmodel.CommandArgs) (*mmodel.CommandResponse, error) {
	result, err := h.tasks.List(args.UserId, model.TaskQuery{Scope: model.TaskScopeMy, PerPage: 10})
	if err != nil {
		return h.errorResponse(err, "Couldn't list your tasks.")
	}
	if len(result.Items) == 0 {
		return ephemeral("You have no open tasks. Create one with `/task create <title>`."), nil
	}
	lines := make([]string, 0, len(result.Items)+1)
	lines = append(lines, fmt.Sprintf("**Your tasks** (%d shown of %d)", len(result.Items), result.Total))
	for _, task := range result.Items {
		lines = append(lines, fmt.Sprintf("- `%s` **%s** — %s", task.ID, task.Title, statusLabel(task.Status)))
	}
	return ephemeral(strings.Join(lines, "\n")), nil
}

func (h *Handler) show(args *mmodel.CommandArgs, params []string) (*mmodel.CommandResponse, error) {
	if len(params) == 0 {
		return ephemeral("Usage: `/task show <id>`"), nil
	}
	task, err := h.tasks.Get(args.UserId, params[0])
	if err != nil {
		return h.errorResponse(err, "Couldn't load that task.")
	}
	lines := []string{
		fmt.Sprintf("**%s**", task.Title),
		fmt.Sprintf("- **ID:** `%s`", task.ID),
		fmt.Sprintf("- **Status:** %s", statusLabel(task.Status)),
		fmt.Sprintf("- **Priority:** %s", task.Priority),
	}
	if task.DueAt != 0 {
		lines = append(lines, fmt.Sprintf("- **Due:** %s", tasks.FormatDue(task.DueAt)))
	}
	if task.Description != "" {
		lines = append(lines, "", task.Description)
	}
	return ephemeral(strings.Join(lines, "\n")), nil
}

func (h *Handler) create(c *plugin.Context, args *mmodel.CommandArgs, params []string) (*mmodel.CommandResponse, error) {
	if len(params) == 0 {
		return ephemeral("Usage: `/task create <title>`"), nil
	}
	task, err := h.tasks.Create(c, "/"+trigger+" create", args.UserId, model.CreateTaskInput{
		TeamID:      args.TeamId,
		ChannelID:   args.ChannelId,
		Title:       strings.Join(params, " "),
		AssigneeIDs: []string{args.UserId},
		Status:      model.TaskStatusTodo,
		Priority:    model.TaskPriorityNormal,
	})
	if err != nil {
		return h.errorResponse(err, "Couldn't create the task.")
	}
	return ephemeral(fmt.Sprintf("Created task **%s** (`%s`).", task.Title, task.ID)), nil
}

func (h *Handler) done(c *plugin.Context, args *mmodel.CommandArgs, params []string) (*mmodel.CommandResponse, error) {
	if len(params) == 0 {
		return ephemeral("Usage: `/task done <id>`"), nil
	}
	status := model.TaskStatusDone
	task, err := h.tasks.Update(c, "/"+trigger+" done", args.UserId, params[0], model.TaskPatch{Status: &status})
	if err != nil {
		return h.errorResponse(err, "Couldn't update that task.")
	}
	return ephemeral(fmt.Sprintf("Marked **%s** as done.", task.Title)), nil
}

func (h *Handler) bookmark(c *plugin.Context, args *mmodel.CommandArgs, params []string) (*mmodel.CommandResponse, error) {
	if len(params) == 0 {
		return ephemeral("Usage: `/task bookmark <url> [title]`"), nil
	}
	rawURL := params[0]
	if !strings.Contains(rawURL, "://") {
		rawURL = "https://" + rawURL
	}
	title := rawURL
	if len(params) > 1 {
		title = strings.Join(params[1:], " ")
	} else if parsed, err := url.Parse(rawURL); err == nil && parsed.Host != "" {
		title = parsed.Host
	}
	bookmark, err := h.bookmarks.Create(c, "/"+trigger+" bookmark", args.UserId, model.CreateBookmarkInput{
		TeamID:    args.TeamId,
		ChannelID: args.ChannelId,
		URL:       rawURL,
		Title:     title,
	})
	if err != nil {
		return h.errorResponse(err, "Couldn't save the bookmark.")
	}
	return ephemeral(fmt.Sprintf("Saved bookmark **%s** (`%s`).", bookmark.Title, bookmark.ID)), nil
}

func (h *Handler) errorResponse(err error, fallback string) (*mmodel.CommandResponse, error) {
	switch {
	case errors.Is(err, model.ErrForbidden):
		return ephemeral("You don't have permission to do that."), nil
	case errors.Is(err, model.ErrNotFound):
		return ephemeral("Not found."), nil
	case errors.Is(err, model.ErrInvalid):
		return ephemeral(model.ErrorMessage(err)), nil
	default:
		h.client.Log.Error("Slash command failed", "error", err.Error())
		return ephemeral(fallback), nil
	}
}

func statusLabel(status string) string {
	switch status {
	case model.TaskStatusInProgress:
		return "In progress"
	case model.TaskStatusDone:
		return "Done"
	default:
		return "To do"
	}
}

func ephemeral(text string) *mmodel.CommandResponse {
	return &mmodel.CommandResponse{
		ResponseType: mmodel.CommandResponseTypeEphemeral,
		Text:         text,
	}
}
