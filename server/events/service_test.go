package events

import (
	"testing"
	"time"

	mmodel "github.com/mattermost/mattermost/server/public/model"
	"github.com/mattermost/mattermost/server/public/plugin/plugintest"
	"github.com/mattermost/mattermost/server/public/pluginapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/3tty0n/mattermost-tasks/server/access"
	taskmodel "github.com/3tty0n/mattermost-tasks/server/model"
	"github.com/3tty0n/mattermost-tasks/server/store/kvstore"
	"github.com/3tty0n/mattermost-tasks/server/testutil"
)

type fakePublisher struct {
	events []*taskmodel.Event
}

func (p *fakePublisher) EventChanged(_ string, event *taskmodel.Event) {
	p.events = append(p.events, event)
}

type testEnv struct {
	service   *EventService
	api       *testutil.API
	store     *kvstore.KVStore
	publisher *fakePublisher
}

func newTestEnv(t *testing.T) *testEnv {
	t.Helper()
	api := testutil.NewAPI()
	t.Cleanup(func() { api.AssertExpectations(t) })
	client := pluginapi.NewClient(api, &plugintest.Driver{})
	store := kvstore.NewStoreWithKV(kvstore.NewMemoryKV())
	publisher := &fakePublisher{}
	service := NewEventService(client, store, access.NewChecker(client), publisher, WithEventClock(func() int64 { return 1000 }))
	return &testEnv{service: service, api: api, store: store, publisher: publisher}
}

func allowChannel(api *testutil.API, userID, channelID, teamID string) {
	api.On("GetChannel", channelID).Return(&mmodel.Channel{Id: channelID, TeamId: teamID, Type: mmodel.ChannelTypeOpen}, nil).Maybe()
	api.On("HasPermissionToChannel", userID, channelID, mmodel.PermissionReadChannel).Return(true).Maybe()
}

func allowTeam(api *testutil.API, userID, teamID string) {
	api.On("GetTeam", teamID).Return(&mmodel.Team{Id: teamID}, nil).Maybe()
	api.On("HasPermissionToTeam", userID, teamID, mmodel.PermissionViewTeam).Return(true).Maybe()
}

func denyAdmin(api *testutil.API, userID string) {
	api.On("HasPermissionTo", userID, mmodel.PermissionManageSystem).Return(false).Maybe()
}

func TestEventAllDayNormalization(t *testing.T) {
	env := newTestEnv(t)
	teamID, channelID := mmodel.NewId(), mmodel.NewId()
	creatorID := mmodel.NewId()
	allowChannel(env.api, creatorID, channelID, teamID)
	denyAdmin(env.api, creatorID)

	start := time.Date(2026, time.January, 5, 14, 0, 0, 0, time.UTC).UnixMilli()
	end := time.Date(2026, time.January, 7, 14, 0, 0, 0, time.UTC).UnixMilli()
	event, err := env.service.Create(nil, "/events", creatorID, taskmodel.CreateEventInput{
		ChannelID:  channelID,
		Visibility: taskmodel.TaskVisibilityChannel,
		Title:      "Offsite",
		StartAt:    start,
		EndAt:      end,
		AllDay:     true,
		TimeZone:   "UTC",
	})
	require.NoError(t, err)
	assert.Equal(t, time.Date(2026, time.January, 5, 0, 0, 0, 0, time.UTC).UnixMilli(), event.StartAt)
	assert.Equal(t, time.Date(2026, time.January, 7, 0, 0, 0, 0, time.UTC).UnixMilli(), event.EndAt)
	assert.Len(t, env.publisher.events, 1)
}

func TestPrivateEventVisibilityAndRange(t *testing.T) {
	env := newTestEnv(t)
	teamID, channelID := mmodel.NewId(), mmodel.NewId()
	creatorID, otherID := mmodel.NewId(), mmodel.NewId()
	allowTeam(env.api, creatorID, teamID)
	allowTeam(env.api, otherID, teamID)
	allowChannel(env.api, creatorID, channelID, teamID)
	allowChannel(env.api, otherID, channelID, teamID)
	denyAdmin(env.api, creatorID)
	denyAdmin(env.api, otherID)

	start := time.Date(2026, time.January, 5, 9, 0, 0, 0, time.UTC).UnixMilli()
	end := time.Date(2026, time.January, 5, 10, 0, 0, 0, time.UTC).UnixMilli()
	event, err := env.service.Create(nil, "/events", creatorID, taskmodel.CreateEventInput{
		TeamID:     teamID,
		ChannelID:  channelID,
		Visibility: taskmodel.TaskVisibilityPrivate,
		Title:      "Private planning",
		StartAt:    start,
		EndAt:      end,
		TimeZone:   "UTC",
	})
	require.NoError(t, err)
	assert.Empty(t, event.ChannelID)

	_, err = env.service.Get(otherID, event.ID)
	assert.ErrorIs(t, err, taskmodel.ErrNotFound)

	query := taskmodel.EventQuery{
		Scope:   taskmodel.TaskScopeMy,
		From:    start - (24 * 60 * 60 * 1000),
		To:      end + (24 * 60 * 60 * 1000),
		Page:    0,
		PerPage: 20,
	}
	result, err := env.service.List(creatorID, query)
	require.NoError(t, err)
	assert.Equal(t, 1, result.Total)

	query.Scope = taskmodel.TaskScopeTeam
	query.TeamID = teamID
	result, err = env.service.List(creatorID, query)
	require.NoError(t, err)
	assert.Equal(t, 1, result.Total)
	result, err = env.service.List(otherID, query)
	require.NoError(t, err)
	assert.Zero(t, result.Total)

	outside := taskmodel.EventQuery{
		Scope:   taskmodel.TaskScopeTeam,
		TeamID:  teamID,
		From:    end + 1,
		To:      end + (24 * 60 * 60 * 1000),
		Page:    0,
		PerPage: 20,
	}
	result, err = env.service.List(creatorID, outside)
	require.NoError(t, err)
	assert.Zero(t, result.Total)
}

func TestRecurringEventIsIncludedOutsideItsBaseRange(t *testing.T) {
	env := newTestEnv(t)
	teamID, channelID := mmodel.NewId(), mmodel.NewId()
	creatorID := mmodel.NewId()
	allowChannel(env.api, creatorID, channelID, teamID)
	allowTeam(env.api, creatorID, teamID)

	start := time.Date(2026, time.January, 5, 9, 0, 0, 0, time.UTC).UnixMilli()
	end := time.Date(2026, time.January, 5, 10, 0, 0, 0, time.UTC).UnixMilli()
	event, err := env.service.Create(nil, "/events", creatorID, taskmodel.CreateEventInput{
		ChannelID:  channelID,
		Visibility: taskmodel.TaskVisibilityChannel,
		Title:      "Standup",
		StartAt:    start,
		EndAt:      end,
		TimeZone:   "UTC",
		Recurrence: &taskmodel.EventRecurrence{
			Frequency: taskmodel.EventRecurrenceWeekly,
			Weekdays:  []int{1, 3},
			Until:     "2026-02-01",
		},
	})
	require.NoError(t, err)
	require.NotNil(t, event.Recurrence)
	assert.Equal(t, []int{1, 3}, event.Recurrence.Weekdays)

	query := taskmodel.EventQuery{
		Scope:   taskmodel.TaskScopeTeam,
		TeamID:  teamID,
		From:    start + (7 * 24 * 60 * 60 * 1000),
		To:      start + (8 * 24 * 60 * 60 * 1000),
		Page:    0,
		PerPage: 20,
	}
	result, err := env.service.List(creatorID, query)
	require.NoError(t, err)
	assert.Zero(t, result.Total)

	query.IncludeRecurring = true
	result, err = env.service.List(creatorID, query)
	require.NoError(t, err)
	assert.Equal(t, 1, result.Total)
	require.Len(t, result.Items, 1)
	require.NotNil(t, result.Items[0].Recurrence)
	assert.Equal(t, []int{1, 3}, result.Items[0].Recurrence.Weekdays)
}
