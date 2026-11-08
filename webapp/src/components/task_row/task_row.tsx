// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getProfilePictureUrl, type Profile} from 'client';
import {memo} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {PRIORITY_TAG_TYPE, formatDue, isOverdue, priorityLabel, profileName, statusLabel} from 'utils';

import {Checkbox} from '@mattermost/compass-ui/components/checkbox';
import {Tag} from '@mattermost/compass-ui/components/tag';
import {UserAvatar} from '@mattermost/compass-ui/components/user-avatar';

import type {TaskSummary} from 'types';

import './task_row.css';

type Props = {
    task: TaskSummary;
    profiles: Record<string, Profile>;
    scopeLabel?: string;
    onOpen: () => void;
    onToggleDone: () => void;
    onCycleStatus: () => void;
};

function TaskRow({task, profiles, scopeLabel, onOpen, onToggleDone, onCycleStatus}: Props) {
    const intl = useIntl();
    const done = task.status === 'done';
    const overdue = !done && isOverdue(task.dueAt);
    const visibleAssignees = task.assigneeIds.slice(0, 3);
    const extraAssignees = task.assigneeIds.length - visibleAssignees.length;

    return (
        <li className={`TasksBookmarks-TaskRow${done ? ' TasksBookmarks-TaskRow--done' : ''}`}>
            <div className='TasksBookmarks-TaskRow__check'>
                <Checkbox
                    checked={done}
                    onChange={onToggleDone}
                    aria-label={intl.formatMessage(
                        done ? {id: 'tasks.row.mark_not_done', defaultMessage: 'Mark {title} as not done'} : {id: 'tasks.row.mark_done', defaultMessage: 'Mark {title} as done'},
                        {title: task.title},
                    )}
                />
            </div>
            <div className='TasksBookmarks-TaskRow__main'>
                <button
                    type='button'
                    className='TasksBookmarks-TaskRow__title'
                    onClick={onOpen}
                >
                    {task.title}
                </button>
                <div className='TasksBookmarks-TaskRow__meta'>
                    <button
                        type='button'
                        className={`TasksBookmarks-TaskRow__status TasksBookmarks-TaskRow__status--${task.status}`}
                        onClick={onCycleStatus}
                        aria-label={intl.formatMessage(
                            {id: 'tasks.row.change_status', defaultMessage: 'Change status, currently {status}'},
                            {status: statusLabel(intl, task.status)},
                        )}
                    >
                        {statusLabel(intl, task.status)}
                    </button>
                    {task.priority !== 'none' && (
                        <Tag
                            label={priorityLabel(intl, task.priority)}
                            type={PRIORITY_TAG_TYPE[task.priority]}
                            size='x-small'
                        />
                    )}
                    {task.dueAt && task.dueAt > 0 && (
                        <span className={`TasksBookmarks-TaskRow__due${overdue ? ' TasksBookmarks-TaskRow__due--overdue' : ''}`}>
                            {formatDue(intl, task.dueAt)}
                        </span>
                    )}
                    {scopeLabel && (
                        <span className='TasksBookmarks-TaskRow__scope'>{scopeLabel}</span>
                    )}
                </div>
            </div>
            <div className='TasksBookmarks-TaskRow__assignees'>
                {visibleAssignees.map((userId) => {
                    const profile = profiles[userId];
                    const name = profileName(profile, userId);
                    return (
                        <UserAvatar
                            key={userId}
                            alt={name}
                            name={name}
                            src={getProfilePictureUrl(profile)}
                            size='20'
                        />
                    );
                })}
                {extraAssignees > 0 && (
                    <span
                        className='TasksBookmarks-TaskRow__extra'
                        aria-label={intl.formatMessage({id: 'tasks.row.more_assignees', defaultMessage: '{count} more assignees'}, {count: extraAssignees})}
                    >
                        {`+${extraAssignees}`}
                    </span>
                )}
            </div>
            <span className='TasksBookmarks-TaskRow__srOnly'>
                <FormattedMessage
                    id='tasks.row.open_hint'
                    defaultMessage='Open task details'
                />
            </span>
        </li>
    );
}

export default memo(TaskRow);
