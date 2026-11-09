// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {IntlProvider} from 'react-intl';

import DueDatePicker from './due_date_picker';

function renderPicker(value: number | undefined, onChange: jest.Mock) {
    return render(
        <IntlProvider locale='en'>
            <DueDatePicker
                value={value}
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

    it('navigates between months', async () => {
        const user = userEvent.setup({advanceTimers: jest.advanceTimersByTime});
        renderPicker(undefined, jest.fn());

        expect(screen.getByText('January 2026')).toBeVisible();
        await user.click(screen.getByRole('button', {name: 'Next month'}));
        expect(screen.getByText('February 2026')).toBeVisible();
    });
});
