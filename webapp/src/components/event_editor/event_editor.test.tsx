// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fireEvent, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {createEvent, deleteEvent, fetchAssignees, getEvent, getProfilePictureUrl, getProfiles, updateEvent} from 'client';

import type {Event} from 'types';

import EventEditor from './event_editor';

import {renderWithStore, ids} from '../../../tests/test_utils';

jest.mock('client', () => ({
    ApiError: class ApiError extends Error {},
    createEvent: jest.fn(),
    deleteEvent: jest.fn(),
    fetchAssignees: jest.fn(),
    getEvent: jest.fn(),
    getProfilePictureUrl: jest.fn(),
    getProfiles: jest.fn(),
    updateEvent: jest.fn(),
}));

const createEventMock = createEvent as jest.MockedFunction<typeof createEvent>;
const updateEventMock = updateEvent as jest.MockedFunction<typeof updateEvent>;
const getEventMock = getEvent as jest.MockedFunction<typeof getEvent>;
const deleteEventMock = deleteEvent as jest.MockedFunction<typeof deleteEvent>;
const fetchAssigneesMock = fetchAssignees as jest.MockedFunction<typeof fetchAssignees>;
const getProfilesMock = getProfiles as jest.MockedFunction<typeof getProfiles>;

const start = new Date(2026, 0, 5, 9, 0).getTime();
const end = new Date(2026, 0, 5, 10, 0).getTime();

const savedEvent: Event = {
    id: 'event-1',
    teamId: ids.team,
    channelId: ids.channel,
    visibility: 'channel',
    creatorId: ids.user,
    assigneeIds: [ids.user],
    title: 'Sprint planning',
    description: '',
    startAt: start,
    endAt: end,
    allDay: false,
    timezone: 'UTC',
    createdAt: 1,
    updatedAt: 1,
    version: 1,
};

describe('EventEditor', () => {
    beforeEach(() => {
        createEventMock.mockResolvedValue(savedEvent);
        updateEventMock.mockResolvedValue(savedEvent);
        getEventMock.mockResolvedValue(savedEvent);
        deleteEventMock.mockResolvedValue();
        fetchAssigneesMock.mockResolvedValue([{id: ids.otherUser, username: 'alice', firstName: 'Alice', lastPictureUpdate: 7}]);
        getProfilesMock.mockResolvedValue({
            [ids.user]: {id: ids.user, username: 'me', first_name: 'Me'},
            [ids.otherUser]: {id: ids.otherUser, username: 'alice', first_name: 'Alice'},
        });
        (getProfilePictureUrl as jest.Mock).mockReturnValue(undefined);
    });

    it('creates a timed event', async () => {
        const user = userEvent.setup();
        const onSaved = jest.fn();
        renderWithStore(
            <EventEditor
                defaults={{teamId: ids.team, channelId: ids.channel, visibility: 'channel', startAt: start, timeZone: 'UTC'}}
                onClose={jest.fn()}
                onSaved={onSaved}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Sprint planning');
        await user.click(screen.getByRole('button', {name: 'Add event'}));

        await waitFor(() => expect(createEventMock).toHaveBeenCalledWith(expect.objectContaining({
            teamId: ids.team,
            channelId: ids.channel,
            visibility: 'channel',
            title: 'Sprint planning',
            startAt: start,
            endAt: end,
            allDay: false,
        })));
        expect(onSaved).toHaveBeenCalledWith(savedEvent);
    });

    it('saves the event time zone', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <EventEditor
                defaults={{
                    teamId: ids.team,
                    channelId: ids.channel,
                    visibility: 'channel',
                    startAt: Date.UTC(2026, 0, 5, 0),
                    timeZone: 'Asia/Tokyo',
                }}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Tokyo sync');
        await user.click(screen.getByRole('button', {name: 'Add event'}));

        await waitFor(() => expect(createEventMock).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Tokyo sync',
            startAt: Date.UTC(2026, 0, 5, 0),
            endAt: Date.UTC(2026, 0, 5, 1),
            timezone: 'Asia/Tokyo',
        })));
    });

    it('picks a start date from the calendar', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <EventEditor
                defaults={{teamId: ids.team, channelId: ids.channel, visibility: 'channel', startAt: start, timeZone: 'UTC'}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Picked event');
        await user.click(screen.getByRole('button', {name: 'Pick start date and time'}));
        await user.click(screen.getByRole('button', {name: /January 20, 2026/}));
        await user.click(screen.getByRole('button', {name: 'OK'}));
        await user.click(screen.getByRole('button', {name: 'Pick end date and time'}));
        await user.click(screen.getByRole('button', {name: /January 20, 2026/}));
        await user.click(screen.getByRole('button', {name: 'OK'}));
        await user.click(screen.getByRole('button', {name: 'Add event'}));

        await waitFor(() => expect(createEventMock).toHaveBeenCalledWith(expect.objectContaining({title: 'Picked event'})));
        const picked = createEventMock.mock.calls[0][0];
        expect(new Date(picked.startAt).toISOString().slice(0, 10)).toBe('2026-01-20');
    });

    it('creates a daily recurring event until a date', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <EventEditor
                defaults={{teamId: ids.team, channelId: ids.channel, visibility: 'channel', startAt: start, timeZone: 'UTC'}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Daily standup');
        await user.click(screen.getByRole('button', {name: 'Repeat'}));
        await user.click(screen.getByRole('combobox', {name: 'Repeat'}));
        await user.click(await screen.findByRole('option', {name: 'Daily'}));
        const until = screen.getByLabelText('Repeat until');
        fireEvent.change(until, {target: {value: '2026-01-09'}});
        await user.click(screen.getByRole('button', {name: 'Add event'}));

        await waitFor(() => expect(createEventMock).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Daily standup',
            recurrence: {frequency: 'daily', interval: 1, until: '2026-01-09'},
        })));
    });

    it('creates a weekly event on selected weekdays', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <EventEditor
                defaults={{teamId: ids.team, channelId: ids.channel, visibility: 'channel', startAt: start, timeZone: 'UTC'}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Office days');
        await user.click(screen.getByRole('button', {name: 'Repeat'}));
        await user.click(screen.getByRole('combobox', {name: 'Repeat'}));
        await user.click(await screen.findByRole('option', {name: 'Specific days'}));
        await user.click(screen.getByRole('button', {name: 'Wednesday'}));
        await user.click(screen.getByRole('button', {name: 'Add event'}));

        await waitFor(() => expect(createEventMock).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Office days',
            recurrence: expect.objectContaining({frequency: 'weekly', interval: 1, weekdays: [1, 3]}),
        })));
    });

    it('adds an assignee to an event', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <EventEditor
                defaults={{teamId: ids.team, channelId: ids.channel, visibility: 'channel', startAt: start, timeZone: 'UTC'}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Sprint planning');
        await user.click(screen.getByLabelText('Add assignee'));
        await user.click(await screen.findByRole('option', {name: /Alice/}));
        await user.click(screen.getByRole('button', {name: 'Add event'}));

        await waitFor(() => expect(createEventMock).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Sprint planning',
            assigneeIds: [ids.user, ids.otherUser],
        })));
    });

    it('creates an all-day event', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <EventEditor
                defaults={{teamId: ids.team, channelId: ids.channel, visibility: 'channel', startAt: start, timeZone: 'UTC'}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Offsite');
        await user.click(screen.getByRole('checkbox', {name: 'All day'}));
        await user.click(screen.getByRole('button', {name: 'Add event'}));

        await waitFor(() => expect(createEventMock).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Offsite',
            allDay: true,
            startAt: Date.UTC(2026, 0, 5),
            endAt: Date.UTC(2026, 0, 6),
        })));
    });

    it('edits and deletes an existing event', async () => {
        const user = userEvent.setup();
        const onDeleted = jest.fn();
        renderWithStore(
            <EventEditor
                eventId='event-1'
                onClose={jest.fn()}
                onSaved={jest.fn()}
                onDeleted={onDeleted}
            />,
        );

        expect(await screen.findByDisplayValue('Sprint planning')).toBeVisible();
        await user.clear(screen.getByLabelText('Title'));
        await user.type(screen.getByLabelText('Title'), 'Planning v2');
        await user.click(screen.getByRole('button', {name: 'Save'}));
        await waitFor(() => expect(updateEventMock).toHaveBeenCalledWith('event-1', expect.objectContaining({title: 'Planning v2'})));

        await user.click(screen.getByRole('button', {name: 'Delete event'}));
        await user.click(screen.getByRole('button', {name: 'Confirm delete'}));
        await waitFor(() => expect(deleteEventMock).toHaveBeenCalledWith('event-1'));
        expect(onDeleted).toHaveBeenCalled();
    });
});
