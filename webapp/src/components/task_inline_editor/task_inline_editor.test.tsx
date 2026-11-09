// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fireEvent, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {updateTask} from 'client';

import type {Task} from 'types';

import TaskInlineEditor from './task_inline_editor';

import {renderWithStore, ids} from '../../../tests/test_utils';

jest.mock('client', () => ({
    ApiError: class ApiError extends Error {},
    createTask: jest.fn(),
    deleteTask: jest.fn(),
    fetchAssignees: jest.fn(),
    fetchTasks: jest.fn(),
    getProfiles: jest.fn(),
    getProfilePictureUrl: jest.fn(),
    getSitePath: jest.fn(() => ''),
    getTask: jest.fn(),
    setSiteURL: jest.fn(),
    updateTask: jest.fn(),
}));

const updateTaskMock = updateTask as jest.MockedFunction<typeof updateTask>;

const task: Task = {
    id: 'task-1',
    teamId: ids.team,
    channelId: ids.channel,
    visibility: 'channel',
    title: 'Original title',
    description: '**Original** description',
    status: 'todo',
    priority: 'normal',
    assigneeIds: [ids.user],
    createdAt: 1,
    updatedAt: 1,
    creatorId: ids.user,
    version: 1,
};

describe('TaskInlineEditor', () => {
    beforeEach(() => {
        updateTaskMock.mockResolvedValue(task);
    });

    it('shows the name and Markdown description as previews', () => {
        renderWithStore(
            <TaskInlineEditor
                task={task}
                onTaskUpdated={jest.fn()}
            />,
        );

        expect(screen.getByRole('button', {name: 'Original title'})).toBeVisible();
        expect(screen.getByText('**Original** description')).toBeVisible();
        expect(screen.queryByLabelText('Task name')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Description')).not.toBeInTheDocument();
    });

    it('edits the name inline and saves on blur', async () => {
        const user = userEvent.setup();
        const onTaskUpdated = jest.fn();
        updateTaskMock.mockResolvedValueOnce({...task, title: 'Updated title'});
        renderWithStore(
            <TaskInlineEditor
                task={task}
                onTaskUpdated={onTaskUpdated}
            />,
        );

        await user.click(screen.getByRole('button', {name: 'Original title'}));
        const input = screen.getByLabelText('Task name');
        await user.clear(input);
        await user.type(input, 'Updated title');
        fireEvent.blur(input);

        await waitFor(() => expect(updateTaskMock).toHaveBeenCalledWith('task-1', {title: 'Updated title'}));
        await waitFor(() => expect(onTaskUpdated).toHaveBeenCalledWith(expect.objectContaining({title: 'Updated title'})));
        expect(screen.getByRole('button', {name: 'Updated title'})).toBeVisible();
    });

    it('edits the description inline and saves on blur', async () => {
        const user = userEvent.setup();
        const onTaskUpdated = jest.fn();
        updateTaskMock.mockResolvedValueOnce({...task, description: '**Updated** description'});
        renderWithStore(
            <TaskInlineEditor
                task={task}
                onTaskUpdated={onTaskUpdated}
            />,
        );

        await user.click(screen.getByRole('button', {name: 'Edit description'}));
        const textarea = screen.getByLabelText('Description');
        await user.clear(textarea);
        await user.type(textarea, '**Updated** description');
        fireEvent.blur(textarea);

        await waitFor(() => expect(updateTaskMock).toHaveBeenCalledWith('task-1', {description: '**Updated** description'}));
        expect(await screen.findByText('**Updated** description')).toBeVisible();
    });

    it('shows a placeholder for an empty description', () => {
        renderWithStore(
            <TaskInlineEditor
                task={{...task, description: undefined}}
                onTaskUpdated={jest.fn()}
            />,
        );

        expect(screen.getByText('Add a description…')).toBeVisible();
    });
});
