// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getProfilePictureUrl, type Profile} from 'client';
import {type DragEvent, useRef} from 'react';
import {useIntl} from 'react-intl';
import {recurrenceLabel} from 'recurrence_utils';
import {PRIORITY_TAG_TYPE, formatDue, isOverdue, priorityLabel, profileName} from 'utils';

import DragVerticalIcon from '@mattermost/compass-icons/components/drag-vertical';
import RefreshIcon from '@mattermost/compass-icons/components/refresh';
import {Checkbox} from '@mattermost/compass-ui/components/checkbox';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {Tag} from '@mattermost/compass-ui/components/tag';
import {UserAvatar} from '@mattermost/compass-ui/components/user-avatar';

import type {TaskSummary} from 'types';

import './task_card.css';

type Props = {
    task: TaskSummary;
    profiles: Record<string, Profile>;
    dragging?: boolean;
    dropPosition?: 'before' | 'after';
    onOpen: () => void;
    onToggleDone: () => void;
    onDragStart?: (event: DragEvent<HTMLElement>) => void;
    onDragEnd?: () => void;
    onDragOver?: (event: DragEvent<HTMLElement>) => void;
    onDrop?: (event: DragEvent<HTMLElement>) => void;
};

// TaskCard is the compact, horizontal card used by the board. The checkbox is fixed at the left
// edge so the title always starts immediately beside it and can use the remaining width.
export default function TaskCard({task, profiles, dragging, dropPosition, onOpen, onToggleDone, onDragStart, onDragEnd, onDragOver, onDrop}: Props) {
    const intl = useIntl();
    const dragActive = useRef(false);
    const done = task.status === 'done';
    const overdue = !done && isOverdue(task.dueAt, task.dueHasTime);
    const visibleAssignees = task.assigneeIds.slice(0, 3);
    const extraAssignees = task.assigneeIds.length - visibleAssignees.length;

    return (
        <article
            className={`Tasks-TaskCard${dragging ? ' Tasks-TaskCard--dragging' : ''}${dropPosition ? ` Tasks-TaskCard--drop-${dropPosition}` : ''}`}
            draggable={true}
            onClick={() => {
                if (!dragActive.current) {
                    onOpen();
                }
            }}
            onDragStart={(event) => {
                dragActive.current = true;
                event.dataTransfer.setData('text/plain', task.id);
                event.dataTransfer.effectAllowed = 'move';
                onDragStart?.(event);
            }}
            onDragEnd={() => {
                window.setTimeout(() => {
                    dragActive.current = false;
                }, 0);
                onDragEnd?.();
            }}
            onDragOver={onDragOver}
            onDrop={onDrop}
        >
            <div
                className='Tasks-TaskCard__check'
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
            <span
                className='Tasks-TaskCard__dragHandle'
                aria-hidden='true'
            >
                <Icon
                    size='16'
                    glyph={<DragVerticalIcon/>}
                />
            </span>
            <div className='Tasks-TaskCard__content'>
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
                <div className='Tasks-TaskCard__meta'>
                    <div className='Tasks-TaskCard__metaItems'>
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
                        {task.recurrence && (
                            <span
                                className='Tasks-TaskCard__repeat'
                                role='img'
                                title={intl.formatMessage({id: 'tasks.recurrence.aria', defaultMessage: 'Repeats: {label}'}, {label: recurrenceLabel(intl, task.recurrence)})}
                                aria-label={intl.formatMessage({id: 'tasks.recurrence.aria', defaultMessage: 'Repeats: {label}'}, {label: recurrenceLabel(intl, task.recurrence)})}
                            >
                                <Icon
                                    size='12'
                                    glyph={<RefreshIcon/>}
                                />
                            </span>
                        )}
                    </div>
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
            </div>
        </article>
    );
}
