// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useIntl} from 'react-intl';
import {PRIORITY_MESSAGES, STATUS_MESSAGES, profileName} from 'utils';

import {Select} from '@mattermost/compass-ui/components/select';

import type {Assignee, TaskPriority, TaskStatus} from 'types';

import './task_filters.css';

export type TaskDueFilter = 'any' | 'overdue' | 'none' | 'week';
export type TaskSortFilter = 'due' | 'newest' | 'oldest' | 'priority';

export type TaskFiltersState = {
    status: '' | TaskStatus;
    priority: '' | TaskPriority;
    assigneeId: string;
    due: TaskDueFilter;
    sort: TaskSortFilter;
};

export const DEFAULT_TASK_FILTERS: TaskFiltersState = {
    status: '',
    priority: '',
    assigneeId: '',
    due: 'any',
    sort: 'due',
};

type Props = {
    filters: TaskFiltersState;
    onChange: (next: Partial<TaskFiltersState>) => void;
    assignees?: Assignee[];
};

export default function TaskFilters({filters, onChange, assignees}: Props) {
    const intl = useIntl();
    const people = assignees ?? [];

    const statusOptions = [
        {value: '', label: intl.formatMessage({id: 'tasks.filters.any_status', defaultMessage: 'Any status'})},
        ...Object.entries(STATUS_MESSAGES).map(([value, message]) => ({value, label: intl.formatMessage(message)})),
    ];
    const priorityOptions = [
        {value: '', label: intl.formatMessage({id: 'tasks.filters.any_priority', defaultMessage: 'Any priority'})},
        ...Object.entries(PRIORITY_MESSAGES).map(([value, message]) => ({value, label: intl.formatMessage(message)})),
    ];
    const dueOptions = [
        {value: 'any', label: intl.formatMessage({id: 'tasks.filters.any_due', defaultMessage: 'Any due date'})},
        {value: 'overdue', label: intl.formatMessage({id: 'tasks.filters.overdue', defaultMessage: 'Overdue'})},
        {value: 'week', label: intl.formatMessage({id: 'tasks.filters.next_week', defaultMessage: 'Next 7 days'})},
        {value: 'none', label: intl.formatMessage({id: 'tasks.filters.no_due', defaultMessage: 'No due date'})},
    ];
    const sortOptions = [
        {value: 'due', label: intl.formatMessage({id: 'tasks.filters.sort_due', defaultMessage: 'Due date'})},
        {value: 'newest', label: intl.formatMessage({id: 'tasks.filters.sort_newest', defaultMessage: 'Newest first'})},
        {value: 'oldest', label: intl.formatMessage({id: 'tasks.filters.sort_oldest', defaultMessage: 'Oldest first'})},
        {value: 'priority', label: intl.formatMessage({id: 'tasks.filters.sort_priority', defaultMessage: 'Priority'})},
    ];
    const assigneeOptions = [
        {value: '', label: intl.formatMessage({id: 'tasks.filters.any_assignee', defaultMessage: 'Any assignee'})},
        ...people.map((person) => ({value: person.id, label: profileName(person, person.username)})),
    ];

    return (
        <div className='TasksBookmarks-TaskFilters'>
            <Select
                size='small'
                label={intl.formatMessage({id: 'tasks.filters.status', defaultMessage: 'Status'})}
                options={statusOptions}
                value={filters.status}
                onChange={(value) => onChange({status: value as TaskFiltersState['status']})}
            />
            <Select
                size='small'
                label={intl.formatMessage({id: 'tasks.filters.priority', defaultMessage: 'Priority'})}
                options={priorityOptions}
                value={filters.priority}
                onChange={(value) => onChange({priority: value as TaskFiltersState['priority']})}
            />
            <Select
                size='small'
                label={intl.formatMessage({id: 'tasks.filters.assignee', defaultMessage: 'Assignee'})}
                options={assigneeOptions}
                value={filters.assigneeId}
                onChange={(value) => onChange({assigneeId: value})}
            />
            <Select
                size='small'
                label={intl.formatMessage({id: 'tasks.filters.due', defaultMessage: 'Due'})}
                options={dueOptions}
                value={filters.due}
                onChange={(value) => onChange({due: value as TaskDueFilter})}
            />
            <Select
                size='small'
                label={intl.formatMessage({id: 'tasks.filters.sort', defaultMessage: 'Sort'})}
                options={sortOptions}
                value={filters.sort}
                onChange={(value) => onChange({sort: value as TaskSortFilter})}
            />
        </div>
    );
}
