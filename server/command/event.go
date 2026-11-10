package command

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	mmodel "github.com/mattermost/mattermost/server/public/model"

	"github.com/3tty0n/mattermost-tasks/server/model"
)

const eventTrigger = "event"

const (
	listDays     = 7
	listMaxShown = 10
)

var durationToken = regexp.MustCompile(`^(\d{1,4})([mh])$`)

func registerEventCommand(client interface {
	Register(*mmodel.Command) error
}) error {
	autocomplete := mmodel.NewAutocompleteData(eventTrigger, "[subcommand]", "Manage calendar events")
	autocomplete.AddStaticListArgument("Subcommand", false, []mmodel.AutocompleteListItem{
		{Item: "list", HelpText: "Show your events for the next 7 days"},
		{Item: "show", HelpText: "Show an event by ID"},
		{Item: "create", HelpText: "Create an event: <today|tomorrow|YYYY-MM-DD> [HH:MM] [30m|1h] <title>"},
		{Item: "delete", HelpText: "Delete an event by ID"},
	})
	if err := client.Register(&mmodel.Command{
		Trigger:          eventTrigger,
		AutoComplete:     true,
		AutoCompleteDesc: "Manage calendar events",
		AutoCompleteHint: "[subcommand]",
		AutocompleteData: autocomplete,
	}); err != nil {
		return fmt.Errorf("failed to register /%s command: %w", eventTrigger, err)
	}
	return nil
}

func eventHelpText() string {
	return strings.Join([]string{
		"**Events**",
		"- `/event list` — your events for the next 7 days",
		"- `/event show <id>` — details for one event",
		"- `/event create <today|tomorrow|YYYY-MM-DD> [HH:MM] [30m|1h] <title>` — create an event in this channel; without a time it is all-day",
		"- `/event delete <id>` — delete an event",
		"",
		"Times use your Mattermost time zone.",
	}, "\n")
}

func (h *Handler) handleEvent(args *mmodel.CommandArgs, params []string) (*mmodel.CommandResponse, error) {
	if len(params) == 0 {
		return ephemeral(eventHelpText()), nil
	}
	switch params[0] {
	case "list":
		return h.eventList(args)
	case "show":
		return h.eventShow(args, params[1:])
	case "create":
		return h.eventCreate(args, params[1:])
	case "delete":
		return h.eventDelete(args, params[1:])
	case "help":
		return ephemeral(eventHelpText()), nil
	default:
		return ephemeral("Unknown subcommand. Try `/event help`."), nil
	}
}

// userLocation is the actor's configured time zone, or UTC when it cannot be loaded.
func (h *Handler) userLocation(userID string) *time.Location {
	user, err := h.client.User.Get(userID)
	if err != nil || user == nil {
		return time.UTC
	}
	return user.GetTimezoneLocation()
}

func formatEventRange(startAt, endAt int64, allDay bool, loc *time.Location) string {
	if allDay {
		start := time.UnixMilli(startAt).UTC()
		last := time.UnixMilli(endAt).UTC().AddDate(0, 0, -1)
		if !last.After(start) {
			return start.Format("Mon Jan 2") + " (all day)"
		}
		return start.Format("Mon Jan 2") + " – " + last.Format("Mon Jan 2") + " (all day)"
	}
	start := time.UnixMilli(startAt).In(loc)
	end := time.UnixMilli(endAt).In(loc)
	if start.YearDay() == end.YearDay() && start.Year() == end.Year() {
		return start.Format("Mon Jan 2 15:04") + "–" + end.Format("15:04")
	}
	return start.Format("Mon Jan 2 15:04") + " – " + end.Format("Mon Jan 2 15:04")
}

func (h *Handler) eventList(args *mmodel.CommandArgs) (*mmodel.CommandResponse, error) {
	now := time.Now()
	from, to := now.UnixMilli(), now.AddDate(0, 0, listDays).UnixMilli()
	result, err := h.events.List(args.UserId, model.EventQuery{
		Scope: model.TaskScopeMy, From: from, To: to, PerPage: model.MaxPageSize, IncludeRecurring: true,
	})
	if err != nil {
		return h.errorResponse(err, "Couldn't list your events.")
	}

	type occurrence struct {
		item  model.EventSummary
		start int64
	}
	upcoming := make([]occurrence, 0, len(result.Items))
	for _, item := range result.Items {
		probe := &model.Event{StartAt: item.StartAt, EndAt: item.EndAt, AllDay: item.AllDay, TimeZone: item.TimeZone, Recurrence: item.Recurrence}
		start := item.StartAt
		if item.EndAt <= from || !probe.Recurrence.IsZero() {
			// Ended already, or a series: show its next occurrence if it falls in the window.
			next, ok := probe.NextStart(from - 1)
			if !ok || next >= to {
				continue
			}
			start = next
		}
		upcoming = append(upcoming, occurrence{item: item, start: start})
	}
	if len(upcoming) == 0 {
		return ephemeral("You have no events in the next 7 days. Create one with `/event create <date> [time] <title>`."), nil
	}
	sort.SliceStable(upcoming, func(i, j int) bool { return upcoming[i].start < upcoming[j].start })

	loc := h.userLocation(args.UserId)
	shown := min(len(upcoming), listMaxShown)
	lines := []string{fmt.Sprintf("**Your events, next %d days** (%d shown of %d)", listDays, shown, len(upcoming))}
	for _, o := range upcoming[:shown] {
		lines = append(lines, fmt.Sprintf("- `%s` **%s** — %s", o.item.ID, o.item.Title, formatEventRange(o.start, o.start+(o.item.EndAt-o.item.StartAt), o.item.AllDay, loc)))
	}
	return ephemeral(strings.Join(lines, "\n")), nil
}

func (h *Handler) eventShow(args *mmodel.CommandArgs, params []string) (*mmodel.CommandResponse, error) {
	if len(params) == 0 {
		return ephemeral("Usage: `/event show <id>`"), nil
	}
	event, err := h.events.Get(args.UserId, params[0])
	if err != nil {
		return h.errorResponse(err, "Couldn't load that event.")
	}
	lines := []string{
		fmt.Sprintf("**%s**", event.Title),
		fmt.Sprintf("- **ID:** `%s`", event.ID),
		fmt.Sprintf("- **When:** %s", formatEventRange(event.StartAt, event.EndAt, event.AllDay, h.userLocation(args.UserId))),
	}
	if !event.Recurrence.IsZero() {
		lines = append(lines, fmt.Sprintf("- **Repeats:** %s", event.Recurrence.Frequency))
	}
	if event.Location != "" {
		lines = append(lines, fmt.Sprintf("- **Location:** %s", event.Location))
	}
	if event.Description != "" {
		lines = append(lines, "", event.Description)
	}
	return ephemeral(strings.Join(lines, "\n")), nil
}

// parseEventDate accepts today, tomorrow or YYYY-MM-DD, read in loc.
func parseEventDate(value string, now time.Time, loc *time.Location) (time.Time, bool) {
	today := now.In(loc)
	switch strings.ToLower(value) {
	case "today":
		return time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, loc), true
	case "tomorrow":
		return time.Date(today.Year(), today.Month(), today.Day()+1, 0, 0, 0, 0, loc), true
	}
	parsed, err := time.ParseInLocation("2006-01-02", value, loc)
	return parsed, err == nil
}

func (h *Handler) eventCreate(args *mmodel.CommandArgs, params []string) (*mmodel.CommandResponse, error) {
	usage := ephemeral("Usage: `/event create <today|tomorrow|YYYY-MM-DD> [HH:MM] [30m|1h] <title>`")
	if len(params) < 2 {
		return usage, nil
	}
	loc := h.userLocation(args.UserId)
	day, ok := parseEventDate(params[0], time.Now(), loc)
	if !ok {
		return usage, nil
	}
	rest := params[1:]

	input := model.CreateEventInput{
		TeamID:      args.TeamId,
		ChannelID:   args.ChannelId,
		AssigneeIDs: []string{args.UserId},
		TimeZone:    loc.String(),
	}
	if clock, err := time.Parse("15:04", rest[0]); err == nil {
		rest = rest[1:]
		start := time.Date(day.Year(), day.Month(), day.Day(), clock.Hour(), clock.Minute(), 0, 0, loc)
		duration := time.Duration(h.defaultEventMinutes()) * time.Minute
		if len(rest) > 1 {
			if m := durationToken.FindStringSubmatch(rest[0]); m != nil {
				n, _ := strconv.Atoi(m[1])
				duration = time.Duration(n) * time.Minute
				if m[2] == "h" {
					duration = time.Duration(n) * time.Hour
				}
				rest = rest[1:]
			}
		}
		input.StartAt, input.EndAt = start.UnixMilli(), start.Add(duration).UnixMilli()
	} else {
		utc := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, time.UTC)
		input.AllDay, input.StartAt, input.EndAt = true, utc.UnixMilli(), utc.AddDate(0, 0, 1).UnixMilli()
	}
	if len(rest) == 0 {
		return usage, nil
	}
	input.Title = strings.Join(rest, " ")

	event, err := h.events.Create(nil, "/"+eventTrigger+" create", args.UserId, input)
	if err != nil {
		return h.errorResponse(err, "Couldn't create the event.")
	}
	return ephemeral(fmt.Sprintf("Created event **%s** (`%s`), %s.", event.Title, event.ID, formatEventRange(event.StartAt, event.EndAt, event.AllDay, loc))), nil
}

func (h *Handler) eventDelete(args *mmodel.CommandArgs, params []string) (*mmodel.CommandResponse, error) {
	if len(params) == 0 {
		return ephemeral("Usage: `/event delete <id>`"), nil
	}
	if err := h.events.Delete(nil, "/"+eventTrigger+" delete", args.UserId, params[0]); err != nil {
		return h.errorResponse(err, "Couldn't delete that event.")
	}
	return ephemeral("Deleted the event."), nil
}

func (h *Handler) defaultEventMinutes() int {
	if h.defaultMinutes != nil {
		if minutes := h.defaultMinutes(); minutes > 0 {
			return minutes
		}
	}
	return 60
}
