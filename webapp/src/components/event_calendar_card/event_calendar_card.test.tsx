// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type {EventSummary} from 'types';

import EventCalendarCard from './event_calendar_card';

import {renderWithStore} from '../../../tests/test_utils';

jest.mock('client', () => ({getProfilePictureUrl: jest.fn()}));

const event = (location?: string): EventSummary => ({
    id: 'e1',
    teamId: 't',
    visibility: 'team',
    creatorId: 'u',
    assigneeIds: [],
    title: 'Sync',
    location,
    startAt: new Date(2026, 0, 5, 9).getTime(),
    endAt: new Date(2026, 0, 5, 10).getTime(),
    createdAt: 1,
    updatedAt: 1,
    version: 1,
});

const renderCard = (value?: string, onOpen = jest.fn()) => renderWithStore(
    <EventCalendarCard
        event={event(value)}
        profiles={{}}
        onOpen={onOpen}
    />,
);

describe('EventCalendarCard location', () => {
    it('shows a meeting URL as an external link without opening the event', async () => {
        const onOpen = jest.fn();
        renderCard('https://us02web.zoom.us/j/123?pwd=x', onOpen);
        const link = screen.getByRole('link', {name: 'us02web.zoom.us'});
        expect(link).toHaveAttribute('href', 'https://us02web.zoom.us/j/123?pwd=x');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
        link.addEventListener('click', (clickEvent) => clickEvent.preventDefault());
        await userEvent.click(link);
        expect(onOpen).not.toHaveBeenCalled();
    });

    it('shows other locations as plain text', () => {
        renderCard('Room 4B');
        expect(screen.getByText('Room 4B')).toBeVisible();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });

    it('never links a non-http URL', () => {
        renderCard('ftp://files.example.com/a');
        expect(screen.getByText('ftp://files.example.com/a')).toBeVisible();
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
    });
});
