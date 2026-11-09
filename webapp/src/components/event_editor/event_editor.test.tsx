// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {screen, waitFor} from '@testing-library/react';
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
                defaults={{teamId: ids.team, channelId: ids.channel, visibility: 'channel', startAt: start}}
                onClose={jest.fn()}
                onSaved={onSaved}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Sprint planning');
        await user.click(screen.getByRole('button', {name: 'Save'}));

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
        await user.click(screen.getByRole('button', {name: 'Save'}));

        await waitFor(() => expect(createEventMock).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Tokyo sync',
            startAt: Date.UTC(2026, 0, 5, 0),
            endAt: Date.UTC(2026, 0, 5, 1),
            timezone: 'Asia/Tokyo',
        })));
    });

    it('adds an assignee to an event', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <EventEditor
                defaults={{teamId: ids.team, channelId: ids.channel, visibility: 'channel', startAt: start}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Sprint planning');
        await user.click(screen.getByLabelText('Add assignee'));
        await user.click(await screen.findByRole('checkbox', {name: /Alice/}));
        await user.click(screen.getByRole('button', {name: 'Save'}));

        await waitFor(() => expect(createEventMock).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Sprint planning',
            assigneeIds: [ids.user, ids.otherUser],
        })));
    });

    it('creates an all-day event', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <EventEditor
                defaults={{teamId: ids.team, channelId: ids.channel, visibility: 'channel', startAt: start}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Offsite');
        await user.click(screen.getByRole('checkbox', {name: 'All day'}));
        await user.click(screen.getByRole('button', {name: 'Save'}));

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
