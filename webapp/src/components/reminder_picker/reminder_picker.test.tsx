// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ReminderPicker from './reminder_picker';

import {renderWithStore} from '../../../tests/test_utils';

describe('ReminderPicker', () => {
    it('shows a placeholder and emits sorted selections', async () => {
        const user = userEvent.setup();
        const onChange = jest.fn();
        renderWithStore(
            <ReminderPicker
                value={[1440]}
                onChange={onChange}
            />,
        );

        await user.click(screen.getByRole('button', {name: '1 day before'}));
        await user.click(screen.getByRole('option', {name: '5 minutes before'}));

        expect(onChange).toHaveBeenCalledWith([5, 1440]);
    });

    it('summarizes the selection and closes on Escape', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <ReminderPicker
                value={[]}
                onChange={jest.fn()}
            />,
        );
        const trigger = screen.getByRole('button', {name: 'No reminder'});
        await user.click(trigger);
        expect(screen.getByRole('listbox', {name: 'Reminders'})).toBeVisible();
        await user.keyboard('{Escape}');
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
        expect(trigger).toHaveFocus();
    });

    it('collapses more than two selections to a count', () => {
        renderWithStore(
            <ReminderPicker
                value={[0, 5, 10]}
                onChange={jest.fn()}
            />,
        );
        expect(screen.getByRole('button', {name: '3 reminders'})).toBeVisible();
    });
});
