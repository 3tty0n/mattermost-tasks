// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {IntlProvider} from 'react-intl';

import EventDatePicker from './event_date_picker';

describe('EventDatePicker', () => {
    it('selects a date from the calendar popover', async () => {
        const user = userEvent.setup();
        const onChange = jest.fn();
        render(
            <IntlProvider locale='en'>
                <EventDatePicker
                    value={Date.UTC(2026, 0, 5)}
                    hasTime={false}
                    timeZone='UTC'
                    hour12={false}
                    label='Pick start date'
                    onChange={onChange}
                />
            </IntlProvider>,
        );

        await user.click(screen.getByRole('button', {name: 'Pick start date'}));
        expect(screen.getByRole('dialog', {name: 'Pick start date'})).toBeVisible();
        await user.click(screen.getByRole('button', {name: /January 20, 2026/}));
        await user.click(screen.getByRole('button', {name: 'OK'}));

        expect(onChange).toHaveBeenCalledWith(Date.UTC(2026, 0, 20), false);
        expect(screen.queryByRole('dialog', {name: 'Pick start date'})).not.toBeInTheDocument();
    });

    it('keeps the calendar open while the clock is used', async () => {
        const user = userEvent.setup();
        render(
            <IntlProvider locale='en'>
                <EventDatePicker
                    value={Date.UTC(2026, 0, 5, 9, 0)}
                    hasTime={true}
                    timeZone='UTC'
                    hour12={true}
                    label='Pick start date'
                    onChange={jest.fn()}
                />
            </IntlProvider>,
        );

        await user.click(screen.getByRole('button', {name: 'Pick start date'}));
        await user.click(screen.getByRole('button', {name: 'Choose time'}));
        await user.click(screen.getByRole('button', {name: '10:00'}));

        expect(screen.getByRole('dialog', {name: 'Pick start date'})).toBeVisible();
        expect(screen.getByRole('dialog', {name: 'Choose time'})).toBeVisible();
    });
});
