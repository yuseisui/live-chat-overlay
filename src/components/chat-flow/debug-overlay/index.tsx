import React from 'react';
import { useSelector, shallowEqual } from 'react-redux';
import { groupBy, sortBy } from 'lodash-es';

import { RootState } from '@/reducers';
import { deserializePosition } from '@/reducers/chat-events/helpers';
import { Benchmark } from '@/reducers/debug-info/types';

import classes from './index.scss';

interface ChatEventDebugInfo {
    messagesCount: number;
    messageByPosition: {
        row: number;
        counts: { layer: number; count: number }[];
    }[];
    doneItemsCount: number;
}

interface RoundedBenchmark {
    min: string;
    max: string;
    avg: string;
    count: number;
}

function roundBenchmark(benchmark: Benchmark): RoundedBenchmark {
    return {
        min: benchmark.min.toFixed(2),
        max: benchmark.max.toFixed(2),
        avg: benchmark.avg.toFixed(2),
        count: benchmark.count,
    };
}

function renderBenchmark(
    benchmark: RoundedBenchmark,
): { key: string; text: string }[] {
    return [
        {
            key: 'min-max',
            text: `min: ${benchmark.min}, max: ${benchmark.max}`,
        },
        {
            key: 'avg',
            text: `avg: ${benchmark.avg}, count: ${benchmark.count}`,
        },
    ];
}

interface DebugOverlayLayoutProps {
    chatEventDebugInfo: ChatEventDebugInfo;
    processXhrBenchmark: RoundedBenchmark;
    processChatEventBenchmark: RoundedBenchmark;
    processXhrQueueLength: number;
    processChatEventQueueLength: number;
}

export const DebugOverlayLayout: React.FC<DebugOverlayLayoutProps> = ({
    chatEventDebugInfo,
    processChatEventBenchmark,
    processXhrBenchmark,
    processXhrQueueLength,
    processChatEventQueueLength,
}) => {
    return (
        <>
            <div className={classes['chat-debug-container']}>
                <p className={classes['debug-text']}>
                    {`Messages Count: ${chatEventDebugInfo.messagesCount}`}
                </p>
                <p className={classes['debug-text']}>
                    {`Done Items Count: ${chatEventDebugInfo.doneItemsCount}`}
                </p>
                {chatEventDebugInfo.messageByPosition.length > 0 && (
                    <p className={classes['debug-text']}>
                        Message Count By Position:
                    </p>
                )}
                {chatEventDebugInfo.messageByPosition.map(({ row, counts }) => (
                    <p className={classes['debug-text']} key={row}>
                        {`${row + 1} | ${counts
                            .map(({ layer, count }) => `${layer + 1}: ${count}`)
                            .join(', ')}`}
                    </p>
                ))}
            </div>
            <div className={classes['benchmark-container']}>
                <p className={classes['debug-text']}>
                    {`Response Process Queue Length ${processXhrQueueLength}`}
                </p>
                {processXhrBenchmark.count !== 0 && (
                    <>
                        <p className={classes['debug-text']}>
                            Process response benchmark (μs):
                        </p>
                        {renderBenchmark(processXhrBenchmark).map(
                            ({ key, text }) => (
                                <p className={classes['debug-text']} key={key}>
                                    {text}
                                </p>
                            ),
                        )}
                    </>
                )}
                <br />
                <p className={classes['debug-text']}>
                    {`Response Chat Event Queue Length ${processChatEventQueueLength}`}
                </p>
                {processChatEventBenchmark.count !== 0 && (
                    <>
                        <p className={classes['debug-text']}>
                            Process chat event benchmark (μs):
                        </p>
                        {renderBenchmark(processChatEventBenchmark).map(
                            ({ key, text }) => (
                                <p className={classes['debug-text']} key={key}>
                                    {text}
                                </p>
                            ),
                        )}
                    </>
                )}
            </div>
        </>
    );
};

const DebugOverlay: React.FC = () => {
    const chatEventDebugInfo = useSelector<RootState, ChatEventDebugInfo>(
        (state) => ({
            messagesCount: state.chatEvents.chatItems.length,
            messageByPosition: Object.entries(
                groupBy(
                    Object.entries(state.chatEvents.chatItemsByPosition).map(
                        ([key, value]) => {
                            const position = deserializePosition(key);
                            return {
                                row: position.lineNumber,
                                layer: position.layerNumber,
                                count: value.length,
                            };
                        },
                    ),
                    ({ row }) => row,
                ),
            ).map(([row, value]) => ({
                row: Number(row),
                counts: sortBy(value, 'layer').map(({ layer, count }) => ({
                    layer,
                    count,
                })),
            })),
            doneItemsCount: Object.values(state.chatEvents.doneItemsIdMap)
                .length,
        }),
        shallowEqual,
    );

    const processXhrBenchmark = useSelector<RootState, RoundedBenchmark>(
        (rootState) => roundBenchmark(rootState.debugInfo.processXhrBenchmark),
        shallowEqual,
    );
    const processChatEventBenchmark = useSelector<RootState, RoundedBenchmark>(
        (rootState) =>
            roundBenchmark(rootState.debugInfo.processChatEventBenchmark),
        shallowEqual,
    );
    const processXhrQueueLength = useSelector<RootState, number>(
        (rootState) => rootState.debugInfo.processXhrQueueLength,
    );
    const processChatEventQueueLength = useSelector<RootState, number>(
        (rootState) => rootState.debugInfo.processChatEventQueueLength,
    );

    return (
        <DebugOverlayLayout
            chatEventDebugInfo={chatEventDebugInfo}
            processChatEventBenchmark={processChatEventBenchmark}
            processXhrBenchmark={processXhrBenchmark}
            processXhrQueueLength={processXhrQueueLength}
            processChatEventQueueLength={processChatEventQueueLength}
        />
    );
};

export default DebugOverlay;