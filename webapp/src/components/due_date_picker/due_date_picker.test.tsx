// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {weekStartsOn} from 'calendar_utils';
import {IntlProvider} from 'react-intl';

import DueDatePicker from './due_date_picker';

function renderPicker(value: number | undefined, onChange: jest.Mock, timeZone?: string) {
    return render(
        <IntlProvider locale='en'>
            <DueDatePicker
                value={value}
                timeZone={timeZone}
                onChange={onChange}
            />
        </IntlProvider>,
    );
}

describe('DueDatePicker', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(2026, 0, 15, 10, 0));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('commits the selected day and time when OK is clicked', async () => {
        const user = userEvent.setup({advanceTimers: jest.advanceTimersByTime});
        const onChange = jest.fn();
        renderPicker(undefined, onChange);

        await user.click(screen.getByRole('button', {name: /January 20, 2026/}));
        await user.click(screen.getByRole('button', {name: 'OK'}));

        expect(onChange).toHaveBeenCalledWith(Date.UTC(2026, 0, 20), false);
    });

    it('clears an existing due date', async () => {
        const user = userEvent.setup({advanceTimers: jest.advanceTimersByTime});
        const onChange = jest.fn();
        renderPicker(new Date(2026, 0, 20, 14, 30).getTime(), onChange);

        await user.click(screen.getByRole('button', {name: 'Clear'}));
        expect(onChange).toHaveBeenCalledWith(undefined, false);
    });

    it('only includes a time when the user enables it', async () => {
        const user = userEvent.setup({advanceTimers: jest.advanceTimersByTime});
        const onChange = jest.fn();
        renderPicker(undefined, onChange);

        await user.click(screen.getByRole('button', {name: /January 20, 2026/}));
        await user.click(screen.getByRole('checkbox', {name: 'Set time'}));
        fireEvent.change(screen.getByLabelText('Time'), {target: {value: '14:30'}});
        await user.click(screen.getByRole('button', {name: 'OK'}));

        expect(onChange).toHaveBeenCalledWith(new Date(2026, 0, 20, 14, 30).getTime(), true);
    });

    it('shows and commits wall time in the selected timezone', async () => {
        const user = userEvent.setup({advanceTimers: jest.advanceTimersByTime});
        const onChange = jest.fn();
        const value = Date.UTC(2026, 0, 20, 0, 0); // 09:00 Asia/Tokyo
        renderPicker(value, onChange, 'Asia/Tokyo');

        fireEvent.click(screen.getByRole('checkbox', {name: 'Set time'}));
        fireEvent.change(screen.getByLabelText('Time'), {target: {value: '09:00'}});
        await user.click(screen.getByRole('button', {name: 'OK'}));

        expect(onChange).toHaveBeenCalledWith(value, true);
    });

    it('fills the current time in the picker zone when Set time is turned on', async () => {
        const user = userEvent.setup({advanceTimers: jest.advanceTimersByTime});
        jest.setSystemTime(new Date(Date.UTC(2026, 0, 15, 3, 7))); // 12:07 Asia/Tokyo
        renderPicker(undefined, jest.fn(), 'Asia/Tokyo');

        await user.click(screen.getByRole('checkbox', {name: 'Set time'}));

        expect(screen.getByLabelText('Time')).toHaveValue('12:07');
    });

    it('starts the week on the same day as the sidebar calendar', () => {
        renderPicker(undefined, jest.fn());
        const expected = new Intl.DateTimeFormat('en', {weekday: 'short'}).format(new Date(2024, 0, 7 + weekStartsOn('en')));

        expect(screen.getAllByText(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)$/)[0]).toHaveTextContent(expected);
    });

    it('navigates between months', async () => {
        const user = userEvent.setup({advanceTimers: jest.advanceTimersByTime});
        renderPicker(undefined, jest.fn());

        expect(screen.getByText('January 2026')).toBeVisible();
        await user.click(screen.getByRole('button', {name: 'Next month'}));
        expect(screen.getByText('February 2026')).toBeVisible();
    });
});
