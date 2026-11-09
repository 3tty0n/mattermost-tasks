// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getProfilePictureUrl, type Profile} from 'client';
import {useRef} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {PRIORITY_TAG_TYPE, formatDue, isOverdue, priorityLabel, profileName, statusLabel} from 'utils';

import {Checkbox} from '@mattermost/compass-ui/components/checkbox';
import {Tag} from '@mattermost/compass-ui/components/tag';
import {UserAvatar} from '@mattermost/compass-ui/components/user-avatar';

import type {TaskSummary} from 'types';

import './task_card.css';

type Props = {
    task: TaskSummary;
    profiles: Record<string, Profile>;
    scopeLabel?: string;
    onOpen: () => void;
    onToggleDone: () => void;
    onCycleStatus: () => void;
};

// TaskCard is the compact card used by the board. The whole card opens the task; interactive
// controls stop propagation so a status change does not also open the detail view.
export default function TaskCard({task, profiles, scopeLabel, onOpen, onToggleDone, onCycleStatus}: Props) {
    const intl = useIntl();
    const dragging = useRef(false);
    const done = task.status === 'done';
    const overdue = !done && isOverdue(task.dueAt, task.dueHasTime);
    const visibleAssignees = task.assigneeIds.slice(0, 3);
    const extraAssignees = task.assigneeIds.length - visibleAssignees.length;

    return (
        <article
            className='Tasks-TaskCard'
            draggable={true}
            onClick={() => {
                if (!dragging.current) {
                    onOpen();
                }
            }}
            onDragStart={(event) => {
                dragging.current = true;
                event.dataTransfer.setData('text/plain', task.id);
                event.dataTransfer.effectAllowed = 'move';
            }}
            onDragEnd={() => {
                dragging.current = false;
            }}
        >
            <div
                className='Tasks-TaskCard__top'
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
                <button
                    type='button'
                    className='Tasks-TaskCard__title'
                    onClick={(event) => {
                        event.stopPropagation();
                        onOpen();
                    }}
                >
                    {task.title}
                </button>
            </div>
            <div className='Tasks-TaskCard__meta'>
                <button
                    type='button'
                    className={`Tasks-TaskCard__status Tasks-TaskCard__status--${task.status}`}
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
                    <span className={`Tasks-TaskCard__due${overdue ? ' Tasks-TaskCard__due--overdue' : ''}`}>
                        {formatDue(intl, task.dueAt, task.dueHasTime)}
                    </span>
                )}
            </div>
            <div className='Tasks-TaskCard__bottom'>
                <span className='Tasks-TaskCard__scope'>{scopeLabel}</span>
                <div className='Tasks-TaskCard__assignees'>
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
                            className='Tasks-TaskCard__extra'
                            aria-label={intl.formatMessage({id: 'tasks.row.more_assignees', defaultMessage: '{count} more assignees'}, {count: extraAssignees})}
                        >
                            {`+${extraAssignees}`}
                        </span>
                    )}
                </div>
            </div>
            <span className='Tasks-TaskCard__srOnly'>
                <FormattedMessage
                    id='tasks.row.open_hint'
                    defaultMessage='Open task details'
                />
            </span>
        </article>
    );
}

