// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getProfilePictureUrl, type Profile} from 'client';
import {memo} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {PRIORITY_TAG_TYPE, formatDue, isOverdue, priorityLabel, profileName, statusLabel} from 'utils';

import ChevronRightIcon from '@mattermost/compass-icons/components/chevron-right';
import {Checkbox} from '@mattermost/compass-ui/components/checkbox';
import {Icon} from '@mattermost/compass-ui/components/icon';
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
    const overdue = !done && isOverdue(task.dueAt, task.dueHasTime);
    const visibleAssignees = task.assigneeIds.slice(0, 3);
    const extraAssignees = task.assigneeIds.length - visibleAssignees.length;

    return (
        <li
            className={`Tasks-TaskRow${done ? ' Tasks-TaskRow--done' : ''}`}
            onClick={onOpen}
        >
            <div
                className='Tasks-TaskRow__check'
                onClick={(event) => event.stopPropagation()}
            >
                <Checkbox
                    checked={done}
                    onChange={onToggleDone}
                    aria-label={intl.formatMessage(
                        done ? {id: 'tasks.row.mark_not_done', defaultMessage: 'Mark {title} as not done'} : {id: 'tasks.row.mark_done', defaultMessage: 'Mark {title} as done'},
                        {title: task.title},
                    )}
                />
            </div>
            <div className='Tasks-TaskRow__main'>
                <button
                    type='button'
                    className='Tasks-TaskRow__title'
                    onClick={(event) => {
                        event.stopPropagation();
                        onOpen();
                    }}
                >
                    {task.title}
                </button>
                <div className='Tasks-TaskRow__meta'>
                    <button
                        type='button'
                        className={`Tasks-TaskRow__status Tasks-TaskRow__status--${task.status}`}
                        onClick={(event) => {
                            event.stopPropagation();
                            onCycleStatus();
                        }}
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
                        <span className={`Tasks-TaskRow__due${overdue ? ' Tasks-TaskRow__due--overdue' : ''}`}>
                            {formatDue(intl, task.dueAt, task.dueHasTime)}
                        </span>
                    )}
                    {scopeLabel && (
                        <span className='Tasks-TaskRow__scope'>{scopeLabel}</span>
                    )}
                </div>
            </div>
            <div className='Tasks-TaskRow__assignees'>
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
                        className='Tasks-TaskRow__extra'
                        aria-label={intl.formatMessage({id: 'tasks.row.more_assignees', defaultMessage: '{count} more assignees'}, {count: extraAssignees})}
                    >
                        {`+${extraAssignees}`}
                    </span>
                )}
            </div>
            <span className='Tasks-TaskRow__chevron'>
                <Icon
                    size='16'
                    glyph={<ChevronRightIcon/>}
                />
            </span>
            <span className='Tasks-TaskRow__srOnly'>
                <FormattedMessage
                    id='tasks.row.open_hint'
                    defaultMessage='Open task details'
                />
            </span>
        </li>
    );
}

export default memo(TaskRow);
