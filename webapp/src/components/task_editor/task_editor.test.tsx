// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {createTask, fetchAssignees, getProfiles, getProfilePictureUrl, updateTask} from 'client';

import type {Task} from 'types';

import TaskEditor from './task_editor';

import {renderWithStore, ids} from '../../../tests/test_utils';

jest.mock('client', () => ({
    ApiError: class ApiError extends Error {},
    createBookmark: jest.fn(),
    createTask: jest.fn(),
    deleteBookmark: jest.fn(),
    deleteTask: jest.fn(),
    fetchAssignees: jest.fn(),
    fetchTasks: jest.fn(),
    getBookmark: jest.fn(),
    getProfiles: jest.fn(),
    getProfilePictureUrl: jest.fn(),
    getSitePath: jest.fn(() => ''),
    getTask: jest.fn(),
    setSiteURL: jest.fn(),
    updateBookmark: jest.fn(),
    updateTask: jest.fn(),
}));

const createTaskMock = createTask as jest.MockedFunction<typeof createTask>;
const fetchAssigneesMock = fetchAssignees as jest.MockedFunction<typeof fetchAssignees>;
const getProfilesMock = getProfiles as jest.MockedFunction<typeof getProfiles>;
const updateTaskMock = updateTask as jest.MockedFunction<typeof updateTask>;

const savedTask: Task = {
    id: 'task-1',
    teamId: ids.team,
    channelId: ids.channel,
    title: 'Ship the release',
    status: 'todo',
    priority: 'high',
    assigneeIds: [ids.user, ids.otherUser],
    createdAt: 1,
    updatedAt: 1,
    creatorId: ids.user,
    version: 1,
};

describe('TaskEditor', () => {
    beforeEach(() => {
        createTaskMock.mockResolvedValue(savedTask);
        updateTaskMock.mockResolvedValue(savedTask);
        fetchAssigneesMock.mockResolvedValue([
            {id: ids.otherUser, username: 'alice', firstName: 'Alice', lastPictureUpdate: 7},
        ]);
        getProfilesMock.mockResolvedValue({
            [ids.user]: {id: ids.user, username: 'me', first_name: 'Me'},
            [ids.otherUser]: {id: ids.otherUser, username: 'alice', first_name: 'Alice'},
        });
        (getProfilePictureUrl as jest.Mock).mockReturnValue(undefined);
    });

    it('creates a task with an assignee', async () => {
        const user = userEvent.setup();
        const onSaved = jest.fn();
        renderWithStore(
            <TaskEditor
                defaults={{teamId: ids.team, channelId: ids.channel}}
                onClose={jest.fn()}
                onSaved={onSaved}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Ship the release');
        await user.type(screen.getByLabelText('Description'), 'Before Friday');
        await user.type(screen.getByLabelText('Add assignee'), 'alice');
        const alice = await screen.findByRole('checkbox', {name: 'Alice'});
        await user.click(alice);

        await user.click(screen.getByRole('button', {name: 'Add task'}));

        await waitFor(() => expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
            teamId: ids.team,
            channelId: ids.channel,
            title: 'Ship the release',
            description: 'Before Friday',
            assigneeIds: [ids.user, ids.otherUser],
            status: 'todo',
            priority: 'normal',
        })));
        await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedTask));
    });

    it('keeps the dialog open and shows an error when saving fails', async () => {
        const user = userEvent.setup();
        createTaskMock.mockRejectedValueOnce(new Error('You don’t have permission to do that'));
        renderWithStore(
            <TaskEditor
                defaults={{teamId: ids.team, channelId: ids.channel}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Nope');
        await user.click(screen.getByRole('button', {name: 'Add task'}));

        expect(await screen.findByText('You don’t have permission to do that')).toBeVisible();
        expect(screen.getByRole('button', {name: 'Add task'})).toBeVisible();
    });

    it('requires a title', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <TaskEditor
                defaults={{teamId: ids.team, channelId: ids.channel}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        await user.click(screen.getByRole('button', {name: 'Add task'}));
        expect(await screen.findByText('Enter a task title.')).toBeVisible();
        expect(createTaskMock).not.toHaveBeenCalled();
    });

    it('saves a due date selected in the calendar', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(2026, 0, 15, 10, 0));
        const user = userEvent.setup({advanceTimers: jest.advanceTimersByTime});
        const onSaved = jest.fn();
        renderWithStore(
            <TaskEditor
                defaults={{teamId: ids.team, channelId: ids.channel}}
                onClose={jest.fn()}
                onSaved={onSaved}
            />,
        );

        await user.type(screen.getByLabelText('Title'), 'Ship with a due date');
        await user.click(screen.getByRole('button', {name: 'Due date'}));
        await user.click(screen.getByRole('button', {name: /January 20, 2026/}));
        await user.click(screen.getByRole('button', {name: 'OK'}));
        await user.click(screen.getByRole('button', {name: 'Add task'}));

        expect(createTaskMock).toHaveBeenCalledWith(expect.objectContaining({
            dueAt: Date.UTC(2026, 0, 20),
            dueHasTime: false,
        }));
        jest.useRealTimers();
    });

    it('inserts Markdown formatting and shows a preview', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <TaskEditor
                defaults={{teamId: ids.team, channelId: ids.channel}}
                onClose={jest.fn()}
                onSaved={jest.fn()}
            />,
        );

        const description = screen.getByLabelText('Description') as HTMLTextAreaElement;
        await user.type(description, 'hello');
        description.setSelectionRange(0, 5);
        await user.click(screen.getByRole('button', {name: 'Bold'}));
        expect(description.value).toBe('**hello**');

        await user.click(screen.getByRole('button', {name: 'Preview'}));
        expect(screen.getByText('**hello**')).toBeVisible();
        expect(screen.getByRole('button', {name: 'Edit description'})).toBeVisible();
    });

    it('updates an existing task', async () => {
        const user = userEvent.setup();
        const onSaved = jest.fn();
        renderWithStore(
            <TaskEditor
                task={{...savedTask, description: 'Old description'}}
                onClose={jest.fn()}
                onSaved={onSaved}
            />,
        );

        const title = screen.getByLabelText('Title');
        await user.clear(title);
        await user.type(title, 'Renamed');
        await user.click(screen.getByRole('button', {name: 'Save'}));

        await waitFor(() => expect(updateTaskMock).toHaveBeenCalledWith('task-1', expect.objectContaining({
            title: 'Renamed',
            description: 'Old description',
            teamId: ids.team,
            channelId: ids.channel,
        })));
        await waitFor(() => expect(onSaved).toHaveBeenCalledWith(savedTask));
    });
});
