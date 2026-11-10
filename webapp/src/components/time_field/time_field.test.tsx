// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {IntlProvider} from 'react-intl';

import TimeField from './time_field';

function Harness() {
    const [value, setValue] = useState('09:00');
    return (
        <TimeField
            value={value}
            hour12={true}
            inputLabel='Start time'
            onChange={setValue}
        />
    );
}

describe('TimeField', () => {
    it('opens the clock and selects an hour and minute', async () => {
        const user = userEvent.setup();
        render(
            <IntlProvider locale='en'>
                <Harness/>
            </IntlProvider>,
        );

        expect(screen.getByLabelText('Start time')).toHaveValue('9:00 AM');
        await user.click(screen.getByRole('button', {name: 'Choose time'}));
        expect(screen.getByRole('dialog', {name: 'Choose time'})).toBeVisible();

        await user.click(screen.getByRole('button', {name: '10:00'}));
        await user.click(screen.getByRole('button', {name: '30'}));

        expect(screen.getByLabelText('Start time')).toHaveValue('10:30 AM');
    });
});
