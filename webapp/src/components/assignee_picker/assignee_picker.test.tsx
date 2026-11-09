// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {fetchAssignees, getProfilePictureUrl, getProfiles} from 'client';

import AssigneePicker from './assignee_picker';

import {renderWithStore, ids} from '../../../tests/test_utils';

jest.mock('client', () => ({
    ApiError: class ApiError extends Error {},
    fetchAssignees: jest.fn(),
    getProfilePictureUrl: jest.fn(),
    getProfiles: jest.fn(),
}));

const fetchAssigneesMock = fetchAssignees as jest.MockedFunction<typeof fetchAssignees>;
const getProfilesMock = getProfiles as jest.MockedFunction<typeof getProfiles>;

describe('AssigneePicker', () => {
    beforeEach(() => {
        fetchAssigneesMock.mockResolvedValue([
            {id: ids.otherUser, username: 'alice', firstName: 'Alice', lastName: 'Tanaka', lastPictureUpdate: 7},
        ]);
        getProfilesMock.mockResolvedValue({
            [ids.otherUser]: {id: ids.otherUser, username: 'alice', first_name: 'Alice'},
        });
        (getProfilePictureUrl as jest.Mock).mockReturnValue(undefined);
    });

    it('opens eligible members on focus and adds one', async () => {
        const user = userEvent.setup();
        const onChange = jest.fn();
        renderWithStore(
            <AssigneePicker
                teamId={ids.team}
                channelId={ids.channel}
                assigneeIds={[]}
                onChange={onChange}
            />,
        );

        await user.click(screen.getByLabelText('Add assignee'));

        const alice = await screen.findByRole('option', {name: /Alice/});
        expect(alice).toBeVisible();
        await user.click(alice);

        await waitFor(() => expect(onChange).toHaveBeenCalledWith([ids.otherUser]));
        expect(fetchAssigneesMock).toHaveBeenCalledWith(ids.team, ids.channel, '', expect.anything());
    });

    it('filters with the typed term', async () => {
        const user = userEvent.setup();
        renderWithStore(
            <AssigneePicker
                teamId={ids.team}
                channelId={ids.channel}
                assigneeIds={[]}
                onChange={jest.fn()}
            />,
        );

        await user.type(screen.getByLabelText('Add assignee'), 'alice');

        expect(await screen.findByRole('option', {name: /Alice/})).toBeVisible();
        await waitFor(() => expect(fetchAssigneesMock).toHaveBeenCalledWith(ids.team, ids.channel, 'alice', expect.anything()));
    });
});
