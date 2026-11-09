// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {extractUrls, postTitle, profileName, positionBetween, positionOf} from './utils';

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

describe('manual task positions', () => {
    it('uses creation time for tasks without a stored position', () => {
        expect(positionOf({createdAt: 100})).toBe(100);
        expect(positionOf({position: 500, createdAt: 100})).toBe(500);
    });

    it('calculates a position between two neighbors', () => {
        expect(positionBetween({position: 100, createdAt: 1}, {position: 200, createdAt: 1})).toBe(150);
        expect(positionBetween({position: 100, createdAt: 1}, undefined)).toBe(1100);
        expect(positionBetween(undefined, {position: 100, createdAt: 1})).toBe(50);
    });
});
