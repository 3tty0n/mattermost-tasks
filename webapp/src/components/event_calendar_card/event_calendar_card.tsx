// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getProfilePictureUrl, type Profile} from 'client';
import {formatEventTime} from 'event_utils';
import {useHour12} from 'hooks';
import {useIntl} from 'react-intl';
import {httpUrl, profileName} from 'utils';

import CalendarOutlineIcon from '@mattermost/compass-icons/components/calendar-outline';
import LinkVariantIcon from '@mattermost/compass-icons/components/link-variant';
import MapMarkerOutlineIcon from '@mattermost/compass-icons/components/map-marker-outline';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {UserAvatar} from '@mattermost/compass-ui/components/user-avatar';

import type {EventSummary} from 'types';

import './event_calendar_card.css';

type Props = {
    event: EventSummary;
    profiles: Record<string, Profile>;
    onOpen: (eventID: string) => void;
};

// Up to nine participants are shown; with ten or more the first nine are followed by an ellipsis.
const MAX_AVATARS = 9;

// EventCalendarCard is intentionally different from TaskCalendarCard: an accent bar and a time
// range, no checkbox or priority. Participants sit on their own row (or, when the card is wide, at
// the right end of a single row) so they never take width from the time range.
export default function EventCalendarCard({event, profiles, onOpen}: Props) {
    const intl = useIntl();
    const hour12 = useHour12();
    const visibleAssignees = event.assigneeIds.slice(0, MAX_AVATARS);
    const hasMore = event.assigneeIds.length > MAX_AVATARS;
    const location = event.location?.trim();
    const locationUrl = httpUrl(location);
    const names = event.assigneeIds.map((userID) => profileName(profiles[userID], userID));
    return (
        <article
            className='Tasks-EventCard'
            onClick={() => onOpen(event.id)}
        >
            <div className='Tasks-EventCard__body'>
                <div className='Tasks-EventCard__meta'>
                    <Icon
                        size='12'
                        glyph={<CalendarOutlineIcon/>}
                    />
                    <span className='Tasks-EventCard__time'>{formatEventTime(intl, event, hour12)}</span>
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
                {location && (locationUrl ? (
                    // eslint-disable-next-line @mattermost/use-external-link -- plugin bundles cannot import host internals
                    <a
                        className='Tasks-EventCard__location'
                        href={locationUrl.href}
                        target='_blank'
                        rel='noopener noreferrer'
                        title={locationUrl.href}
                        onClick={(clickEvent) => clickEvent.stopPropagation()}
                    >
                        <Icon
                            size='12'
                            glyph={<LinkVariantIcon/>}
                        />
                        <span className='Tasks-EventCard__locationText'>{locationUrl.host}</span>
                    </a>
                ) : (
                    <span
                        className='Tasks-EventCard__location'
                        title={location}
                    >
                        <Icon
                            size='12'
                            glyph={<MapMarkerOutlineIcon/>}
                        />
                        <span className='Tasks-EventCard__locationText'>{location}</span>
                    </span>
                ))}
                {names.length > 0 && (
                    <div
                        className='Tasks-EventCard__assignees'
                        title={names.join(', ')}
                    >
                        {visibleAssignees.map((userID, index) => (
                            <span
                                key={userID}
                                className='Tasks-EventCard__avatar'
                            >
                                <UserAvatar
                                    alt={names[index]}
                                    name={names[index]}
                                    src={getProfilePictureUrl(profiles[userID])}
                                    size='20'
                                />
                            </span>
                        ))}
                        {hasMore && (
                            <span className='Tasks-EventCard__extra'>{'…'}</span>
                        )}
                    </div>
                )}
            </div>
        </article>
    );
}
