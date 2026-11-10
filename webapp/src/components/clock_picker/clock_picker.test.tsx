// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useState} from 'react';
import {IntlProvider} from 'react-intl';

import ClockPicker from './clock_picker';

function Harness() {
    const [hours, setHours] = useState(9);
    const [minutes, setMinutes] = useState(0);
    return (
        <ClockPicker
            hours={hours}
            minutes={minutes}
            hour12={true}
            onChange={(nextHours, nextMinutes) => {
                setHours(nextHours);
                setMinutes(nextMinutes);
            }}
            onDone={jest.fn()}
        />
    );
}

describe('ClockPicker', () => {
    it('selects an hour on the face and then a minute', async () => {
        const user = userEvent.setup();
        render(
            <IntlProvider locale='en'>
                <Harness/>
            </IntlProvider>,
        );

        await user.click(screen.getByRole('button', {name: '10:00'}));
        expect(screen.getByText('10:00 AM')).toBeVisible();

        await user.click(screen.getByRole('button', {name: '30'}));
        expect(screen.getByText('10:30 AM')).toBeVisible();
    });

    it('switches AM/PM without changing the selected hour face', async () => {
        const user = userEvent.setup();
        const onChange = jest.fn();
        render(
            <IntlProvider locale='en'>
                <ClockPicker
                    hours={9}
                    minutes={0}
                    hour12={true}
                    onChange={onChange}
                    onDone={jest.fn()}
                />
            </IntlProvider>,
        );

        await user.click(screen.getByRole('button', {name: 'PM'}));
        expect(onChange).toHaveBeenCalledWith(21, 0);
    });
});
