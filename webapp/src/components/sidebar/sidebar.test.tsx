// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fireEvent, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
    createEvent,
    createTask,
    fetchAssignees,
    fetchEvents,
    fetchTasks,
    getProfiles,
    getProfilePictureUrl,
    getTask,
    updateTask,
} from 'client';

import type {ListResult, TaskSummary} from 'types';

import TasksSidebar from './sidebar';

import {renderWithStore, ids} from '../../../tests/test_utils';

jest.mock('client', () => ({
    ApiError: class ApiError extends Error {},
    createBookmark: jest.fn(),
    createEvent: jest.fn(),
    createTask: jest.fn(),
    deleteBookmark: jest.fn(),
    deleteEvent: jest.fn(),
    deleteTask: jest.fn(),
    fetchAssignees: jest.fn(),
    fetchEvents: jest.fn(),
    fetchTasks: jest.fn(),
    getBookmark: jest.fn(),
    getEvent: jest.fn(),
    getProfiles: jest.fn(),
    getProfilePictureUrl: jest.fn(),
    getSitePath: jest.fn(() => ''),
    getTask: jest.fn(),
    setSiteURL: jest.fn(),
    updateBookmark: jest.fn(),
    updateEvent: jest.fn(),
    updateTask: jest.fn(),
}));

const createTaskMock = createTask as jest.MockedFunction<typeof createTask>;
const createEventMock = createEvent as jest.MockedFunction<typeof createEvent>;
const fetchTasksMock = fetchTasks as jest.MockedFunction<typeof fetchTasks>;
const fetchEventsMock = fetchEvents as jest.MockedFunction<typeof fetchEvents>;
const fetchAssigneesMock = fetchAssignees as jest.MockedFunction<typeof fetchAssignees>;
const getProfilesMock = getProfiles as jest.MockedFunction<typeof getProfiles>;
const getTaskMock = getTask as jest.MockedFunction<typeof getTask>;
const updateTaskMock = updateTask as jest.MockedFunction<typeof updateTask>;

const task = (overrides: Partial<TaskSummary> = {}): TaskSummary => ({
    id: 'task-1',
    teamId: ids.team,
    channelId: ids.channel,
    visibility: 'channel',
    title: 'Pick up mail',
    status: 'todo',
    priority: 'high',
    assigneeIds: [ids.otherUser],
    dueAt: Date.now() + (24 * 60 * 60 * 1000),
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
});

function page(items: TaskSummary[]): ListResult<TaskSummary> {
    return {items, total: items.length, page: 0, perPage: 20, hasMore: false};
}

describe('TasksSidebar', () => {
    beforeEach(() => {
        fetchTasksMock.mockResolvedValue(page([task(), task({id: 'task-2', title: 'Write docs', status: 'done', priority: 'normal', dueAt: undefined})]));
        fetchAssigneesMock.mockResolvedValue([]);
        fetchEventsMock.mockResolvedValue({items: [], total: 0, page: 0, perPage: 100, hasMore: false});
        getProfilesMock.mockResolvedValue({});
        (getProfilePictureUrl as jest.Mock).mockReturnValue(undefined);
        updateTaskMock.mockResolvedValue({
            ...task(),
            status: 'in_progress',
            creatorId: ids.user,
            version: 2,
        });
        createTaskMock.mockResolvedValue({
            ...task({title: 'New card'}),
            creatorId: ids.user,
            version: 1,
        });
        createEventMock.mockResolvedValue({
            id: 'event-1',
            teamId: ids.team,
            channelId: ids.channel,
            visibility: 'channel',
            creatorId: ids.user,
            title: 'Sprint planning',
            startAt: Date.now(),
            endAt: Date.now() + 3600000,
            createdAt: 1,
            updatedAt: 1,
            version: 1,
        });
        getTaskMock.mockResolvedValue({
            ...task(),
            creatorId: ids.user,
            version: 1,
        });
    });

    it('renders tasks assigned to the user', async () => {
        renderWithStore(<TasksSidebar/>);

        expect(await screen.findByRole('button', {name: 'Pick up mail'})).toBeVisible();
        expect(screen.getByRole('button', {name: 'Write docs'})).toBeVisible();
        expect(fetchTasksMock).toHaveBeenCalledWith(
            expect.objectContaining({scope: 'team', teamId: ids.team}),
            expect.anything(),
        );
    });

    it('shows a loading and then an empty state', async () => {
        fetchTasksMock.mockResolvedValue(page([]));
        renderWithStore(<TasksSidebar/>);

        expect(await screen.findByText('No tasks here')).toBeVisible();
    });

    it('changes status without opening the editor', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});

        await user.click(screen.getByRole('button', {name: 'Change status, currently To do'}));
        await waitFor(() => expect(updateTaskMock).toHaveBeenCalledWith('task-1', {status: 'in_progress'}));

        await user.click(screen.getByLabelText('Mark Pick up mail as done'));
        await waitFor(() => expect(updateTaskMock).toHaveBeenCalledWith('task-1', {status: 'done'}));
    });

    it('defaults to team tasks in a channel', async () => {
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});

        await waitFor(() => expect(fetchTasksMock).toHaveBeenLastCalledWith(expect.objectContaining({
            scope: 'team',
            teamId: ids.team,
        }), expect.anything()));
        expect(screen.getByRole('tab', {name: 'Team'})).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', {name: 'Mine'})).toBeVisible();
        expect(screen.queryByRole('tab', {name: 'All'})).not.toBeInTheDocument();
    });

    it('switches between team tasks and my tasks', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});

        await user.click(screen.getByRole('tab', {name: 'Mine'}));

        await waitFor(() => expect(fetchTasksMock).toHaveBeenLastCalledWith(expect.objectContaining({
            scope: 'my',
        }), expect.anything()));
        expect(screen.getByRole('tab', {name: 'Mine'})).toHaveAttribute('aria-selected', 'true');

        await user.click(screen.getByRole('tab', {name: 'Team'}));
        await waitFor(() => expect(fetchTasksMock).toHaveBeenLastCalledWith(expect.objectContaining({
            scope: 'team',
            teamId: ids.team,
        }), expect.anything()));
    });

    it('falls back to Mine without a team', async () => {
        renderWithStore(<TasksSidebar/>, (state) => {
            const teams = state.entities.teams as unknown as {
                currentTeamId: string;
                teams: Record<string, unknown>;
                myMembers: Record<string, unknown>;
            };
            teams.currentTeamId = '';
            teams.teams = {};
            teams.myMembers = {};
        });

        expect(await screen.findByRole('tab', {name: 'Mine'})).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByRole('tab', {name: 'Team'})).toHaveAttribute('aria-disabled', 'true');
        await waitFor(() => expect(fetchTasksMock).toHaveBeenLastCalledWith(expect.objectContaining({
            scope: 'my',
        }), expect.anything()));
    });

    it('switches to a board grouped by status', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});

        await user.click(screen.getByRole('button', {name: 'Board view'}));

        await waitFor(() => expect(fetchTasksMock).toHaveBeenLastCalledWith(expect.objectContaining({
            page: 0,
            perPage: 100,
        }), expect.anything()));
        const query = fetchTasksMock.mock.calls[fetchTasksMock.mock.calls.length - 1][0];
        expect(query.statuses).toBeUndefined();
        expect(screen.getAllByText('In progress').length).toBeGreaterThan(0);
        expect(screen.queryByRole('combobox', {name: 'Status'})).not.toBeInTheDocument();
    });

    it('opens the calendar view with due-date tasks', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});

        await user.click(screen.getByRole('button', {name: 'Calendar view'}));

        expect(await screen.findByRole('tab', {name: 'Month'})).toBeVisible();
        expect(screen.getByRole('button', {name: 'Next period'})).toBeVisible();
        await waitFor(() => expect(fetchTasksMock).toHaveBeenLastCalledWith(expect.objectContaining({
            hasDue: true,
            sortBy: 'due',
            perPage: 100,
        }), expect.anything()));
        expect(screen.queryByRole('combobox', {name: 'Due'})).not.toBeInTheDocument();
        expect(screen.queryByRole('combobox', {name: 'Sort'})).not.toBeInTheDocument();
    });

    it('defaults a calendar New task to today', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});
        await user.click(screen.getByRole('button', {name: 'Calendar view'}));
        await screen.findByRole('tab', {name: 'Month'});

        const now = new Date();
        await user.click(screen.getByRole('button', {name: 'New task'}));
        await user.type(screen.getByLabelText('Title'), 'Plan today');
        await user.click(screen.getByRole('button', {name: 'Add task'}));

        await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Plan today',
            dueAt: Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
            dueHasTime: false,
        })));
        expect(screen.getByRole('tab', {name: 'Month'})).toBeVisible();
    });

    it('creates a task from a double-clicked calendar day', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});
        await user.click(screen.getByRole('button', {name: 'Calendar view'}));

        const day = await screen.findByRole('button', {name: /, (no events|\d+ events)$/, pressed: true});
        const now = new Date();
        await user.dblClick(day);

        expect(await screen.findByRole('button', {name: 'Add task'})).toBeVisible();
        await user.type(screen.getByLabelText('Title'), 'Plan the offsite');
        await user.click(screen.getByRole('button', {name: 'Add task'}));

        await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Plan the offsite',
            dueAt: Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
            dueHasTime: false,
        })));
        expect(screen.queryByRole('button', {name: 'Back to tasks'})).not.toBeInTheDocument();
        expect(screen.getByRole('tab', {name: 'Month'})).toBeVisible();
    });

    it('creates an event from the calendar agenda', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});
        await user.click(screen.getByRole('button', {name: 'Calendar view'}));
        await screen.findByRole('tab', {name: 'Month'});

        await user.click(await screen.findByRole('button', {name: /Add event on/}));
        await user.type(await screen.findByLabelText('Title'), 'Sprint planning');
        await user.click(screen.getByRole('button', {name: 'Save'}));

        await waitFor(() => expect(createEventMock).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Sprint planning',
            visibility: 'channel',
            channelId: ids.channel,
        })));
        expect(screen.getByRole('tab', {name: 'Month'})).toBeVisible();
    });

    it('returns to the list view after creating a task', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});

        await user.click(screen.getByRole('button', {name: 'New task'}));
        await user.type(screen.getByLabelText('Title'), 'Plan the offsite');
        await user.click(screen.getByRole('button', {name: 'Add task'}));

        await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({title: 'Plan the offsite'})));
        expect(screen.queryByRole('button', {name: 'Back to tasks'})).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'List view'})).toBeVisible();
        expect(getTaskMock).not.toHaveBeenCalled();
    });

    it('returns to the board view after creating a task', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});
        await user.click(screen.getByRole('button', {name: 'Board view'}));

        await user.click(screen.getByRole('button', {name: 'New task'}));
        await user.type(screen.getByLabelText('Title'), 'Plan the offsite');
        await user.click(screen.getByRole('button', {name: 'Add task'}));

        await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({title: 'Plan the offsite'})));
        expect(screen.queryByRole('button', {name: 'Back to tasks'})).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Add task to To do'})).toBeVisible();
    });

    it('opens task details when a list card is clicked', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        const title = await screen.findByRole('button', {name: 'Pick up mail'});

        await user.click(title.closest('li') as HTMLElement);

        await waitFor(() => expect(getTaskMock).toHaveBeenCalledWith('task-1', expect.anything()));
    });

    it('quick-adds a task from a board column', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});
        await user.click(screen.getByRole('button', {name: 'Board view'}));

        await user.click(screen.getByRole('button', {name: 'Add task to To do'}));
        await user.type(screen.getByLabelText('Task name'), 'New card');
        await user.click(screen.getByRole('button', {name: 'Add'}));

        await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
            title: 'New card',
            status: 'todo',
            visibility: 'team',
            assigneeIds: [ids.user],
        })));
    });

    it('shows a board card description in a popup', async () => {
        const user = userEvent.setup();
        getTaskMock.mockResolvedValueOnce({
            ...task(),
            description: '**Board description**',
            creatorId: ids.user,
            version: 1,
        });
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});
        await user.click(screen.getByRole('button', {name: 'Board view'}));

        await user.click(screen.getByRole('button', {name: 'Pick up mail'}));

        expect(await screen.findByText('**Board description**')).toBeVisible();
        expect(screen.getByRole('button', {name: 'Open task'})).toBeVisible();
    });

    it('shows Mine and creates private tasks in a DM', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>, (state) => {
            const channels = state.entities.channels as unknown as {
                currentChannelId: string;
                channels: Record<string, unknown>;
            };
            channels.currentChannelId = 'dm-channel';
            channels.channels['dm-channel'] = {
                id: 'dm-channel',
                team_id: '',
                name: 'dm',
                display_name: 'DM',
                type: 'D',
                delete_at: 0,
            };
        });
        await screen.findByRole('button', {name: 'Pick up mail'});

        expect(screen.getByRole('tab', {name: 'Mine'})).toHaveAttribute('aria-selected', 'true');
        await waitFor(() => expect(fetchTasksMock).toHaveBeenLastCalledWith(expect.objectContaining({
            scope: 'my',
        }), expect.anything()));

        await user.click(screen.getByRole('button', {name: 'Board view'}));
        await user.click(screen.getByRole('button', {name: 'Add task to To do'}));
        await user.type(screen.getByLabelText('Task name'), 'Private card');
        await user.click(screen.getByRole('button', {name: 'Add'}));

        await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
            title: 'Private card',
            visibility: 'private',
            assigneeIds: [ids.user],
        })));
    });

    it('reorders a task in manual order', async () => {
        renderWithStore(<TasksSidebar/>);
        const source = (await screen.findByRole('button', {name: 'Write docs'})).closest('li') as HTMLElement;
        const target = screen.getByRole('button', {name: 'Pick up mail'}).closest('li') as HTMLElement;
        const values = new Map<string, string>();
        const dataTransfer = {
            effectAllowed: '',
            setData: (key: string, value: string) => values.set(key, value),
            getData: (key: string) => values.get(key) ?? '',
        } as unknown as DataTransfer;

        fireEvent.dragStart(source, {dataTransfer});
        fireEvent.dragOver(target, {dataTransfer, clientY: 0});
        expect(target.className).toContain('Tasks-TaskRow--drop-before');
        fireEvent.drop(target, {dataTransfer, clientY: 0});

        await waitFor(() => expect(updateTaskMock).toHaveBeenCalledWith('task-2', {position: 0.5}));

        const source2 = screen.getByRole('button', {name: 'Pick up mail'}).closest('li') as HTMLElement;
        const target2 = screen.getByRole('button', {name: 'Write docs'}).closest('li') as HTMLElement;
        fireEvent.dragStart(source2, {dataTransfer});
        fireEvent.dragOver(target2, {dataTransfer, clientY: 100});
        fireEvent.drop(target2, {dataTransfer, clientY: 100});

        await waitFor(() => expect(updateTaskMock).toHaveBeenCalledTimes(2));
    });

    it('filters by status', async () => {
        const user = userEvent.setup();
        renderWithStore(<TasksSidebar/>);
        await screen.findByRole('button', {name: 'Pick up mail'});

        await user.click(screen.getByRole('combobox', {name: 'Status'}));
        await user.click(await screen.findByRole('option', {name: 'Done'}));

        await waitFor(() => expect(fetchTasksMock).toHaveBeenLastCalledWith(expect.objectContaining({
            statuses: ['done'],
        }), expect.anything()));
    });

    it('shows an error and retries', async () => {
        const user = userEvent.setup();
        fetchTasksMock.mockRejectedValueOnce(new Error('Network down'));
        renderWithStore(<TasksSidebar/>);

        expect(await screen.findByText('Couldn’t load tasks')).toBeVisible();
        expect(screen.getByText('Network down')).toBeVisible();

        fetchTasksMock.mockResolvedValue(page([task()]));
        await user.click(screen.getByRole('button', {name: 'Try again'}));
        expect(await screen.findByRole('button', {name: 'Pick up mail'})).toBeVisible();
    });
});
