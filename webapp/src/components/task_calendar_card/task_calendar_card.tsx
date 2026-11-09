// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getProfilePictureUrl, type Profile} from 'client';
import {useHour12} from 'hooks';
import {memo} from 'react';
import {useIntl} from 'react-intl';
import {recurrenceLabel} from 'recurrence_utils';
import {PRIORITY_TAG_TYPE, priorityLabel, profileName} from 'utils';

import RefreshIcon from '@mattermost/compass-icons/components/refresh';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {Tag} from '@mattermost/compass-ui/components/tag';
import {UserAvatar} from '@mattermost/compass-ui/components/user-avatar';

import type {TaskSummary} from 'types';

import './task_calendar_card.css';

type Props = {
    task: TaskSummary;
    profiles: Record<string, Profile>;
    onOpen: (taskID: string) => void;
};

// TaskCalendarCard is the smallest readable task representation: the name, priority, time and a
// few assignees. It deliberately omits controls so a day can hold several cards in a narrow
// sidebar; clicking the card opens the full task editor.
function TaskCalendarCard({task, profiles, onOpen}: Props) {
    const intl = useIntl();
    const hour12 = useHour12();
    const done = task.status === 'done';
    const visibleAssignees = task.assigneeIds.slice(0, 3);
    const extraAssignees = task.assigneeIds.length - visibleAssignees.length;
    const hasMeta = task.priority !== 'none' || Boolean(task.dueHasTime) || task.assigneeIds.length > 0 || Boolean(task.recurrence);

    return (
        <article
            className={`Tasks-CalendarCard${done ? ' Tasks-CalendarCard--done' : ''}`}
            onClick={() => onOpen(task.id)}
        >
            <button
                type='button'
                className='Tasks-CalendarCard__title'
                onClick={(event) => {
                    event.stopPropagation();
                    onOpen(task.id);
                }}
            >
                {task.title}
            </button>
            {hasMeta && (
                <div className='Tasks-CalendarCard__meta'>
                    {task.priority !== 'none' && (
                        <Tag
                            label={priorityLabel(intl, task.priority)}
                            type={PRIORITY_TAG_TYPE[task.priority]}
                            size='x-small'
                        />
                    )}
                    {task.dueHasTime && task.dueAt && (
                        <span className='Tasks-CalendarCard__time'>
                            {intl.formatTime(new Date(task.dueAt), {hour: 'numeric', minute: '2-digit', hour12})}
                        </span>
                    )}
                    {task.recurrence && (
                        <span
                            className='Tasks-CalendarCard__repeat'
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
                    <div className='Tasks-CalendarCard__assignees'>
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
                                className='Tasks-CalendarCard__extra'
                                aria-label={intl.formatMessage({id: 'tasks.row.more_assignees', defaultMessage: '{count} more assignees'}, {count: extraAssignees})}
                            >
                                {`+${extraAssignees}`}
                            </span>
                        )}
                    </div>
                </div>
            )}
        </article>
    );
}

export default memo(TaskCalendarCard);
