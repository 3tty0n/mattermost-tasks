// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {extractUrls, postTitle, profileName} from './utils';

describe('utils', () => {
    it('extracts unique http(s) URLs and strips trailing punctuation', () => {
        const message = 'Read https://example.com/a, and https://example.com/b. Again https://example.com/a';
        expect(extractUrls(message)).toEqual(['https://example.com/a', 'https://example.com/b']);
    });

    it('ignores non-http links', () => {
        expect(extractUrls('mailto:test@example.com')).toEqual([]);
    });

    it('builds a title from the first non-empty line', () => {
        expect(postTitle('\n## Ship it\nDetails')).toBe('Ship it');
        expect(postTitle('')).toBe('');
    });

    it('supports both API and host profile field names', () => {
        expect(profileName({firstName: 'Alice', lastName: 'Smith'}, 'fallback')).toBe('Alice Smith');
        expect(profileName({first_name: 'Alice'}, 'fallback')).toBe('Alice');
        expect(profileName({username: 'alice'}, 'fallback')).toBe('alice');
        expect(profileName(undefined, 'fallback')).toBe('fallback');
    });
});
