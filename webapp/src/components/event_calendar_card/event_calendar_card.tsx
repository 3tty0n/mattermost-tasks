// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getProfilePictureUrl, type Profile} from 'client';
import {formatEventTime} from 'event_utils';
import {useHour12} from 'hooks';
import {useIntl} from 'react-intl';
import {profileName} from 'utils';

import CalendarOutlineIcon from '@mattermost/compass-icons/components/calendar-outline';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {UserAvatar} from '@mattermost/compass-ui/components/user-avatar';

import type {EventSummary} from 'types';

import './event_calendar_card.css';

type Props = {
    event: EventSummary;
    profiles: Record<string, Profile>;
    onOpen: (eventID: string) => void;
};

// EventCalendarCard is intentionally different from TaskCalendarCard: an accent bar and a time
// range, no checkbox, priority or assignee.
export default function EventCalendarCard({event, profiles, onOpen}: Props) {
    const intl = useIntl();
    const hour12 = useHour12();
    const visibleAssignees = event.assigneeIds.slice(0, 3);
    const extraAssignees = event.assigneeIds.length - visibleAssignees.length;
    return (
        <article
            className='Tasks-EventCard'
            onClick={() => onOpen(event.id)}
        >
            <div className='Tasks-EventCard__meta'>
                <Icon
                    size='12'
                    glyph={<CalendarOutlineIcon/>}
                />
                <span>{formatEventTime(intl, event, hour12)}</span>
                <div className='Tasks-EventCard__assignees'>
                    {visibleAssignees.map((userID) => {
                        const profile = profiles[userID];
                        const name = profileName(profile, userID);
                        return (
                            <UserAvatar
                                key={userID}
                                alt={name}
                                name={name}
                                src={getProfilePictureUrl(profile)}
                                size='20'
                            />
                        );
                    })}
                    {extraAssignees > 0 && (
                        <span className='Tasks-EventCard__extra'>{`+${extraAssignees}`}</span>
                    )}
                </div>
            </div>
            <button
                type='button'
                className='Tasks-EventCard__title'
                onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    onOpen(event.id);
                }}
            >
                {event.title}
            </button>
        </article>
    );
}
