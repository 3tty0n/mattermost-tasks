// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useIntl} from 'react-intl';
import {isValidTimeZone, timeZoneOptions} from 'timezone_utils';

import {Combobox} from '@mattermost/compass-ui/components/combobox';

type Props = {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
};

// TimeZoneInput allows both selecting an IANA timezone and typing one manually. The create row
// accepts an arbitrary value, which the server validates before saving.
export default function TimeZoneInput({value, onChange, disabled}: Props) {
    const intl = useIntl();
    const options = timeZoneOptions(value).map((zone) => ({value: zone, label: zone}));
    return (
        <Combobox
            size='small'
            label={intl.formatMessage({id: 'tasks.editor.timezone', defaultMessage: 'Time zone'})}
            placeholder={intl.formatMessage({id: 'tasks.editor.timezone_placeholder', defaultMessage: 'IANA time zone'})}
            options={options}
            value={value}
            creatable={true}
            filter={true}
            disabled={disabled}
            invalid={Boolean(value) && !isValidTimeZone(value)}
            onChange={(next) => {
                if (typeof next === 'string') {
                    onChange(next);
                }
            }}
            emptyMessage={intl.formatMessage({id: 'tasks.editor.timezone_empty', defaultMessage: 'Type an IANA time zone'})}
        />
    );
}
