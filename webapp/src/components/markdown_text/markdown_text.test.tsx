// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {render, screen} from '@testing-library/react';
import type {ReactNode} from 'react';

import MarkdownText from './markdown_text';

describe('MarkdownText', () => {
    afterEach(() => {
        delete window.PostUtils;
    });

    it('falls back to plain text when the host renderer is unavailable', () => {
        render(<MarkdownText text={'Line one\nLine two'}/>);
        expect(screen.getByText(/Line one/)).toBeVisible();
    });

    it('uses the host sanitizing Markdown pipeline', () => {
        const formatText = jest.fn(() => '<p><strong>Hello</strong></p>');
        const messageHtmlToComponent = jest.fn((html: string): ReactNode => <div data-testid='markdown-html'>{html}</div>);
        window.PostUtils = {formatText, messageHtmlToComponent};

        render(<MarkdownText text='**Hello**'/>);

        expect(formatText).toHaveBeenCalledWith('**Hello**', expect.objectContaining({markdown: true, atMentions: false}));
        expect(messageHtmlToComponent).toHaveBeenCalledWith('<p><strong>Hello</strong></p>', expect.objectContaining({mentions: false}));
        expect(screen.getByTestId('markdown-html')).toHaveTextContent('<p><strong>Hello</strong></p>');
    });

    it('falls back to text when the host renderer throws', () => {
        window.PostUtils = {
            formatText: () => {
                throw new Error('bad markdown');
            },
            messageHtmlToComponent: jest.fn(),
        };
        render(<MarkdownText text='**Broken**'/>);
        expect(screen.getByText('**Broken**')).toBeVisible();
    });
});
