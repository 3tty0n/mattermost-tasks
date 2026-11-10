// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {getEvent} from 'client';
import {downloadIcs, googleCalendarUrl, outlookCalendarUrl} from 'event_export';
import {formatEventTime} from 'event_utils';
import {useHour12, useProfiles} from 'hooks';
import {useEffect, useState} from 'react';
import {FormattedMessage, useIntl} from 'react-intl';
import {useSelector} from 'react-redux';
import {recurrenceLabel} from 'recurrence_utils';
import {httpUrl, profileName} from 'utils';

import AccountMultipleOutlineIcon from '@mattermost/compass-icons/components/account-multiple-outline';
import CalendarOutlineIcon from '@mattermost/compass-icons/components/calendar-outline';
import LinkVariantIcon from '@mattermost/compass-icons/components/link-variant';
import MapMarkerOutlineIcon from '@mattermost/compass-icons/components/map-marker-outline';
import RefreshIcon from '@mattermost/compass-icons/components/refresh';
import {Button} from '@mattermost/compass-ui/components/button';
import {Icon} from '@mattermost/compass-ui/components/icon';
import {SectionNotice} from '@mattermost/compass-ui/components/section-notice';
import {Spinner} from '@mattermost/compass-ui/components/spinner';

import {selectCurrentUserId, selectIsSystemAdmin} from 'selectors';

import Dialog from 'components/dialog/dialog';
import MarkdownText from 'components/markdown_text/markdown_text';

import type {Event} from 'types';

import './event_detail.css';

type Props = {
    eventId: string;
    onClose: () => void;
    onEdit: () => void;
};

// EventDetail is the read-only view an event opens in. Editing is one click away (creator or admin
// only), and the event can be copied into Google Calendar, Outlook or an .ics file.
export default function EventDetail({eventId, onClose, onEdit}: Props) {
    const intl = useIntl();
    const hour12 = useHour12();
    const currentUserId = useSelector(selectCurrentUserId);
    const isAdmin = useSelector(selectIsSystemAdmin);
    const [event, setEvent] = useState<Event>();
    const [error, setError] = useState<string>();
    const profiles = useProfiles(event?.assigneeIds ?? []);

    useEffect(() => {
        const controller = new AbortController();
        getEvent(eventId, controller.signal).then(setEvent, (err: unknown) => {
            if (!controller.signal.aborted) {
                setError(err instanceof Error ? err.message : String(err));
            }
        });
        return () => controller.abort();
    }, [eventId]);

    const canModify = Boolean(event && (event.creatorId === currentUserId || isAdmin));
    const location = event?.location?.trim();
    const locationUrl = httpUrl(location);

    let when = '';
    if (event) {
        const zone = event.allDay ? 'UTC' : undefined;
        const start = new Date(event.startAt);
        const lastDay = new Date(event.allDay ? event.endAt - (24 * 60 * 60 * 1000) : event.endAt);
        const day = (date: Date) => intl.formatDate(date, {timeZone: zone, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'});
        const sameDay = day(start) === day(lastDay);
        if (event.allDay) {
            when = sameDay ? day(start) : `${day(start)} – ${day(lastDay)}`;
        } else {
            when = sameDay ? `${day(start)}, ${formatEventTime(intl, event, hour12)}` : `${day(start)} ${intl.formatTime(start, {hour: 'numeric', minute: '2-digit', hour12})} – ${day(lastDay)} ${intl.formatTime(lastDay, {hour: 'numeric', minute: '2-digit', hour12})}`;
        }
    }
    const repeats = event?.recurrence && event.recurrence.frequency !== 'none';

    const footer = (
        <>
            <Button
                emphasis='tertiary'
                onClick={onClose}
            >
                <FormattedMessage
                    id='tasks.event.close'
                    defaultMessage='Close'
                />
            </Button>
            {canModify && (
                <Button
                    emphasis='primary'
                    onClick={onEdit}
                >
                    <FormattedMessage
                        id='tasks.event.edit'
                        defaultMessage='Edit'
                    />
                </Button>
            )}
        </>
    );

    return (
        <Dialog
            title={event?.title ?? (
                <FormattedMessage
                    id='tasks.event.view_title'
                    defaultMessage='Event'
                />
            )}
            onClose={onClose}
            footer={footer}
        >
            <div className='Tasks-EventDetail'>
                {error && (
                    <SectionNotice
                        type='danger'
                        title={error}
                    />
                )}
                {!event && !error && (
                    <div className='Tasks-EventDetail__loading'>
                        <Spinner/>
                    </div>
                )}
                {event && (
                    <>
                        <div className='Tasks-EventDetail__row'>
                            <Icon
                                size='16'
                                glyph={<CalendarOutlineIcon/>}
                            />
                            <span>{when}</span>
                        </div>
                        {repeats && (
                            <div className='Tasks-EventDetail__row'>
                                <Icon
                                    size='16'
                                    glyph={<RefreshIcon/>}
                                />
                                <span>{recurrenceLabel(intl, {frequency: event.recurrence?.frequency ?? 'none', interval: event.recurrence?.interval})}</span>
                            </div>
                        )}
                        {location && (
                            <div className='Tasks-EventDetail__row'>
                                <Icon
                                    size='16'
                                    glyph={locationUrl ? <LinkVariantIcon/> : <MapMarkerOutlineIcon/>}
                                />
                                {locationUrl ? (
                                    // eslint-disable-next-line @mattermost/use-external-link -- plugin bundles cannot import host internals
                                    <a
                                        href={locationUrl.href}
                                        target='_blank'
                                        rel='noopener noreferrer'
                                    >
                                        {locationUrl.href}
                                    </a>
                                ) : (
                                    <span>{location}</span>
                                )}
                            </div>
                        )}
                        {event.assigneeIds.length > 0 && (
                            <div className='Tasks-EventDetail__row'>
                                <Icon
                                    size='16'
                                    glyph={<AccountMultipleOutlineIcon/>}
                                />
                                <span>{event.assigneeIds.map((id) => profileName(profiles[id], id)).join(', ')}</span>
                            </div>
                        )}
                        {event.description?.trim() && (
                            <MarkdownText text={event.description}/>
                        )}
                        <div
                            className='Tasks-EventDetail__export'
                            role='group'
                            aria-labelledby='tasks-event-export'
                        >
                            <span
                                id='tasks-event-export'
                                className='Tasks-EventDetail__exportLabel'
                            >
                                <FormattedMessage
                                    id='tasks.event.add_to_calendar'
                                    defaultMessage='Add to calendar'
                                />
                            </span>
                            <Button
                                emphasis='tertiary'
                                size='small'
                                onClick={() => window.open(googleCalendarUrl(event), '_blank', 'noopener,noreferrer')}
                            >
                                <FormattedMessage
                                    id='tasks.event.add_google'
                                    defaultMessage='Google Calendar'
                                />
                            </Button>
                            <Button
                                emphasis='tertiary'
                                size='small'
                                onClick={() => window.open(outlookCalendarUrl(event), '_blank', 'noopener,noreferrer')}
                            >
                                <FormattedMessage
                                    id='tasks.event.add_outlook'
                                    defaultMessage='Outlook'
                                />
                            </Button>
                            <Button
                                emphasis='tertiary'
                                size='small'
                                onClick={() => downloadIcs(event)}
                            >
                                <FormattedMessage
                                    id='tasks.event.add_ics'
                                    defaultMessage='Download .ics'
                                />
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </Dialog>
    );
}
