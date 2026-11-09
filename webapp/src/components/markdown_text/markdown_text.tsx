// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import {useMemo} from 'react';

import './markdown_text.css';

type Props = {
    text: string;
    className?: string;
};

// MarkdownText uses the host's sanitizing Markdown pipeline, exactly like post bodies. If the host
// does not expose PostUtils (for example in a unit test), it falls back to plain pre-wrapped text.
export default function MarkdownText({text, className}: Props) {
    const content = useMemo(() => {
        const postUtils = window.PostUtils;
        if (!postUtils || typeof postUtils.formatText !== 'function' || typeof postUtils.messageHtmlToComponent !== 'function') {
            return (
                <span className='Tasks-Markdown__plain'>{text}</span>
            );
        }
        try {
            const html = postUtils.formatText(text, {
                markdown: true,
                atMentions: false,
                emoticons: true,
                singleline: false,
            });
            return postUtils.messageHtmlToComponent(html, {
                mentions: false,
                emoji: true,
            });
        } catch {
            return (
                <span className='Tasks-Markdown__plain'>{text}</span>
            );
        }
    }, [text]);

    return (
        <div className={`Tasks-Markdown${className ? ` ${className}` : ''}`}>
            {content}
        </div>
    );
}
