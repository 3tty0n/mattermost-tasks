// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {formatEventTime} from 'event_utils';
import {useIntl} from 'react-intl';

import CalendarOutlineIcon from '@mattermost/compass-icons/components/calendar-outline';
import {Icon} from '@mattermost/compass-ui/components/icon';

import type {EventSummary} from 'types';

import './event_calendar_card.css';

type Props = {
    event: EventSummary;
    onOpen: (eventID: string) => void;
};

// EventCalendarCard is intentionally different from TaskCalendarCard: an accent bar and a time
// range, no checkbox, priority or assignee.
export default function EventCalendarCard({event, onOpen}: Props) {
    const intl = useIntl();
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
                <span>{formatEventTime(intl, event)}</span>
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
