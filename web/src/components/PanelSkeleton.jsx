import React from 'react';
import { Skeleton } from './StateViews';

// Compatibility entry points. Geometry, ARIA and animation belong to Skeleton.
export function ConvListSkeleton() { return <Skeleton rows={8} />; }
export function ChatSkeleton() { return <Skeleton rows={4} variant="chat" />; }
export function PanelSkeleton({ rows = 6 }) { return <Skeleton rows={rows} avatar={false} variant="panel" />; }
