// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {localDateKey} from 'calendar_utils';
import {fetchEvents, fetchTasks, getProfilePictureUrl, getProfiles} from 'client';

import type {ListResult, TaskSummary} from 'types';

import Calendar from './calendar';

import {renderWithStore, ids} from '../../../tests/test_utils';

jest.mock('client', () => ({
    ApiError: class ApiError extends Error {},
    fetchAssignees: jest.fn(),
    fetchEvents: jest.fn(),
    fetchTasks: jest.fn(),
    getProfiles: jest.fn(),
    getProfilePictureUrl: jest.fn(),
    getSiteURL: jest.fn(() => ''),
    setSiteURL: jest.fn(),
}));

const fetchTasksMock = fetchTasks as jest.MockedFunction<typeof fetchTasks>;
const fetchEventsMock = fetchEvents as jest.MockedFunction<typeof fetchEvents>;
const getProfilesMock = getProfiles as jest.MockedFunction<typeof getProfiles>;

const todayAt = (hour: number) => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0).getTime();
};

const task = (overrides: Partial<TaskSummary> = {}): TaskSummary => ({
    id: 'task-1',
    teamId: ids.team,
    visibility: 'team',
    title: 'Pick up mail',
    status: 'todo',
    priority: 'high',
    assigneeIds: [ids.otherUser],
    dueAt: todayAt(10),
    dueHasTime: true,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
});

function page(items: TaskSummary[]): ListResult<TaskSummary> {
    return {items, total: items.length, page: 0, perPage: 100, hasMore: false};
}

function renderCalendar(onCreateTask: (day: Date) => void = jest.fn(), onOpenEvent: (eventID: string) => void = jest.fn()) {
    return renderWithStore(
        <Calendar
            scope='team'
            teamId={ids.team}
            revision={0}
            onOpenTask={jest.fn()}
            onCreateTask={onCreateTask}
            onOpenEvent={onOpenEvent}
            onCreateEvent={jest.fn()}
        />,
    );
}

describe('Calendar', () => {
    beforeEach(() => {
        fetchTasksMock.mockResolvedValue(page([
            task(),
            task({id: 'task-2', title: 'Write docs', priority: 'normal', assigneeIds: [], dueAt: todayAt(9)}),
        ]));
        getProfilesMock.mockResolvedValue({});
        fetchEventsMock.mockResolvedValue({items: [], total: 0, page: 0, perPage: 100, hasMore: false});
        (getProfilePictureUrl as jest.Mock).mockReturnValue(undefined);
    });

    it('shows the selected day’s cards in the month view and requests due tasks', async () => {
        renderCalendar();

        expect(await screen.findByRole('button', {name: 'Pick up mail'})).toBeVisible();
        expect(screen.getByRole('button', {name: 'Write docs'})).toBeVisible();
        expect(screen.getByRole('tab', {name: 'Month'})).toHaveAttribute('aria-selected', 'true');
        expect(fetchTasksMock).toHaveBeenCalledWith(
            expect.objectContaining({
                scope: 'team',
                teamId: ids.team,
                hasDue: true,
                includeRecurring: true,
                sortBy: 'due',
                perPage: 100,
            }),
            expect.anything(),
        );
    });

    it('opens task creation when a day is double-clicked', async () => {
        const user = userEvent.setup();
        const onCreateTask = jest.fn();
        renderCalendar(onCreateTask);
        await screen.findByRole('button', {name: 'Pick up mail'});

        await user.dblClick(screen.getByRole('button', {pressed: true}));

        expect(onCreateTask).toHaveBeenCalledTimes(1);
        expect(localDateKey(onCreateTask.mock.calls[0][0])).toBe(localDateKey(new Date()));
    });

    it('shows every day’s cards in the week view', async () => {
        const user = userEvent.setup();
        renderCalendar();
        await screen.findByRole('button', {name: 'Pick up mail'});

        await user.click(screen.getByRole('tab', {name: 'Week'}));

        expect(await screen.findByRole('button', {name: 'Write docs'})).toBeVisible();
        expect(screen.getByRole('button', {name: 'Pick up mail'})).toBeVisible();
        expect(screen.getByRole('tab', {name: 'Week'})).toHaveAttribute('aria-selected', 'true');
    });

    it('requests recurring tasks and marks their cards', async () => {
        fetchTasksMock.mockResolvedValue(page([
            task({
                id: 'task-recurring',
                title: 'Daily standup',
                dueAt: todayAt(9),
                recurrence: {
                    frequency: 'daily',
                    interval: 1,
                    startDate: localDateKey(new Date()),
                    timezone: 'UTC',
                },
            }),
        ]));
        renderCalendar();

        expect(await screen.findByRole('button', {name: 'Daily standup'})).toBeVisible();
        expect(screen.getByRole('img', {name: 'Repeats: Daily'})).toBeVisible();
        expect(fetchTasksMock).toHaveBeenCalledWith(
            expect.objectContaining({includeRecurring: true}),
            expect.anything(),
        );
    });

    it('shows events with a distinct card and opens them', async () => {
        const onOpenEvent = jest.fn();
        fetchTasksMock.mockResolvedValue(page([]));
        fetchEventsMock.mockResolvedValue({
            items: [{
                id: 'event-1',
                teamId: ids.team,
                visibility: 'team',
                creatorId: ids.user,
                assigneeIds: [ids.user],
                title: 'Sprint planning',
                startAt: todayAt(10),
                endAt: todayAt(11),
                allDay: false,
                timezone: 'UTC',
                createdAt: 1,
                updatedAt: 1,
                version: 1,
            }],
            total: 1,
            page: 0,
            perPage: 100,
            hasMore: false,
        });
        const {container} = renderCalendar(jest.fn(), onOpenEvent);

        expect(await screen.findByRole('button', {name: 'Sprint planning'})).toBeVisible();
        expect(screen.getByText('Events')).toBeVisible();
        expect(container.querySelector('.Tasks-EventCard')).toBeVisible();
        expect(container.querySelector('.Tasks-Calendar__eventBar')).toBeVisible();
        expect(container.querySelector('.Tasks-CalendarCard')).not.toBeInTheDocument();

        await userEvent.setup().click(screen.getByRole('button', {name: 'Sprint planning'}));
        expect(onOpenEvent).toHaveBeenCalledWith('event-1');
    });

    it('moves to the next period', async () => {
        const user = userEvent.setup();
        renderCalendar();
        await screen.findByRole('button', {name: 'Pick up mail'});

        const before = screen.getByRole('heading', {level: 3}).textContent;
        const callsBefore = fetchTasksMock.mock.calls.length;
        await user.click(screen.getByRole('button', {name: 'Next period'}));

        await waitFor(() => expect(screen.getByRole('heading', {level: 3}).textContent).not.toBe(before));
        await waitFor(() => expect(fetchTasksMock.mock.calls.length).toBeGreaterThan(callsBefore));
    });

    it('moves the selected day with arrow keys', async () => {
        const user = userEvent.setup();
        renderCalendar();
        await screen.findByRole('button', {name: 'Pick up mail'});

        await user.click(screen.getByRole('button', {pressed: true}));
        await user.keyboard('{ArrowRight}');

        await waitFor(() => expect(screen.getByRole('button', {pressed: true})).toHaveFocus());
    });

    it('explains an empty period without hiding the calendar', async () => {
        fetchTasksMock.mockResolvedValue(page([]));
        renderCalendar();

        expect(await screen.findByText('No tasks or events in this period.')).toBeVisible();
        expect(screen.getByText('No tasks due this day.')).toBeVisible();
        expect(screen.getByRole('tab', {name: 'Month'})).toBeVisible();
    });

    it('retries after a failed load', async () => {
        const user = userEvent.setup();
        fetchTasksMock.mockRejectedValueOnce(new Error('Network unavailable'));
        renderCalendar();

        expect(await screen.findByText('Couldn’t load tasks')).toBeVisible();
        await user.click(screen.getByRole('button', {name: 'Try again'}));

        expect(await screen.findByRole('button', {name: 'Pick up mail'})).toBeVisible();
    });
});
