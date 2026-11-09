// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import type {ReactNode} from 'react';

declare global {
    interface Window {
        PostUtils?: {
            formatText: (text: string, options?: Record<string, unknown>) => string;
            messageHtmlToComponent: (html: string, options?: Record<string, unknown>) => ReactNode;
        };
    }
}

export {};
