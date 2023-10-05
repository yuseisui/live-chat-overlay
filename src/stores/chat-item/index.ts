import { noop, debounce } from 'lodash-es';
import { createEffect, createRoot, onCleanup, onMount, batch } from 'solid-js';
import { type SetStoreFunction, createStore, reconcile } from 'solid-js/store';

import type {
    YoutubeChatResponse,
    InitData,
    ReplayContinuationContents,
    LiveContinuationContents,
} from '@/definitions/youtube';
import type { ChatItemModel } from '@/models/chat-item';
import type { fetchInterceptor } from '@/services';
import { youtube } from '@/utils';
import { createError, logInfo } from '@/utils/logger';
import { benchmarkRuntime, benchmarkRuntimeAsync } from '@/utils/metrics';

import {
    mapChatItemsFromReplayResponse,
    mapChatItemsFromLiveResponse,
    isTimeToDispatch,
    isOutdatedChatItem,
    getOutdatedFactor,
    isReplayInitData,
    getLineNumber,
    Mode,
} from './helpers';
import type { DebugInfoStore } from '../debug-info';
import type { SettingsStore } from '../settings';
import type { UiStore } from '../ui';

type DebugInfo = Partial<{
    processXhrResponseMs: number;
    processChatEventMs: number;
    processChatEventQueueLength: number;
    enqueuedChatItemCount: number;
    outdatedChatEventCount: number;
    cleanedChatItemCount: number;
    liveChatDelayInMs: number;
}>;

const DEQUEUE_INTERVAL = 1000 / 60; // 5 FPS
const CLEAN_INTERVAL = 1000;
const MAX_DEQUEUE_ITEMS = 5;

export type ChatItemStoreState = {
    normalChatItems: Record<string, ChatItemModel>;
    stickyChatItems: Record<string, ChatItemModel>;
};

export class ChatItemStore {
    state: ChatItemStoreState;
    cleanup = noop;
    private readonly setState: SetStoreFunction<ChatItemStoreState>;
    private lastTimestamp = 0;
    private isInitiated = false;
    private mode: Mode = Mode.LIVE;
    private normalChatItemQueue: string[] = [];
    private readonly chatItemsByLineNumber = new Map<number, ChatItemModel[]>();

    // Preserve the value of this set so the pinned comment won't show again when reset
    private readonly closedPinnedComment = new Set<string>();
    private tickId: number | undefined;
    private cleanDisplayedIntervalId: number | undefined;

    private readonly resetNonStickyChatItems = debounce(() => {
        batch(() => {
            for (const chatItemId in this.state.normalChatItems) {
                if (Object.hasOwn(this.state.normalChatItems, chatItemId)) {
                    const chatItem = this.state.normalChatItems[chatItemId]!;
                    if (chatItem.addTimestamp) {
                        this.setState('normalChatItems', {
                            [chatItemId]: undefined,
                        });
                    }
                }
            }
        });
        this.normalChatItemQueue = this.normalChatItemQueue.filter(
            (itemId) => itemId in this.state.normalChatItems,
        );
        this.chatItemsByLineNumber.clear();
    });

    constructor(
        private readonly uiStore: UiStore,
        private readonly settingsStore: SettingsStore,
        private readonly debugInfoStore: DebugInfoStore,
    ) {
        const [state, setState] = createStore<ChatItemStoreState>({
            normalChatItems: {},
            stickyChatItems: {},
        });
        // eslint-disable-next-line solid/reactivity
        this.state = state;
        this.setState = setState;
    }

    async init(
        attachChatEvent: (
            callback: (e: fetchInterceptor.ChatEventDetail) => void,
        ) => () => void,
        initData: InitData,
    ) {
        this.attachReactiveContext(attachChatEvent);
        await this.processInitData(initData);
    }

    assignChatItemEle(chatItemId: string, element: HTMLElement) {
        // Storing ele instead of width here so we can get the latest width value
        // when the player size is updated
        this.setState('normalChatItems', chatItemId, {
            element,
        });
    }

    removeStickyChatItemById(id: string): void {
        this.closedPinnedComment.add(id);
        this.setState('stickyChatItems', {
            [id]: undefined,
        });
    }

    private reset(): void {
        this.chatItemsByLineNumber.clear();
        this.normalChatItemQueue.splice(0);
        this.setState(
            reconcile({
                normalChatItems: {},
                stickyChatItems: {},
            }),
        );

        this.debugInfoStore.resetMetrics();
    }

    private startDebug(): void {
        this.updateDebugInfo({
            processChatEventQueueLength: this.normalChatItemQueue.length,
        });
    }

    private readonly handlePlayerPauseOrResume = (isPaused: boolean): void => {
        if (isPaused) {
            this.clearAllIntervals();
        } else {
            this.createAllIntervals();
        }
    };

    private handlePlayerSizeChange(_width: number) {
        this.resetNonStickyChatItems();
    }

    private handleSpeedChange(_flowInTime: number) {
        this.resetNonStickyChatItems();
    }

    private handleLineHeightChange(_lineHeight: number) {
        this.resetNonStickyChatItems();
    }

    private handleMaxNumberOfLinesChange(_maxNumberOfLines: number) {
        this.resetNonStickyChatItems();
    }

    private createAllIntervals() {
        this.clearAllIntervals();

        this.tickId = window.setInterval(
            this.dequeueAvailableChatItems,
            DEQUEUE_INTERVAL,
        );

        this.cleanDisplayedIntervalId = window.setInterval(
            this.cleanDisplayedChatItems,
            CLEAN_INTERVAL,
        );
    }

    private clearAllIntervals() {
        if (this.tickId !== undefined) {
            window.clearInterval(this.tickId);
        }

        if (this.cleanDisplayedIntervalId !== undefined) {
            window.clearInterval(this.cleanDisplayedIntervalId);
        }
    }

    private getCurrentTimeInfo(): {
        playerTimestampMs: number;
        currentTimestampMs: number;
    } {
        return {
            playerTimestampMs:
                this.uiStore.state.playerState.videoCurrentTimeInSecs * 1000,
            currentTimestampMs: Date.now(),
        };
    }

    private updateDebugInfo(info: DebugInfo) {
        if (!this.debugInfoStore.state.isDebugging) {
            return;
        }

        if (info.processChatEventMs !== undefined) {
            this.debugInfoStore.addProcessChatEventBenchmark(
                info.processChatEventMs,
            );
        }

        if (info.processXhrResponseMs !== undefined) {
            this.debugInfoStore.addProcessXhrBenchmark(
                info.processXhrResponseMs,
            );
        }

        if (info.processChatEventQueueLength !== undefined) {
            this.debugInfoStore.updateProcessChatEventQueueLength(
                info.processChatEventQueueLength,
            );
        }

        if (info.outdatedChatEventCount !== undefined) {
            this.debugInfoStore.addOutdatedRemovedChatEventCount(
                info.outdatedChatEventCount,
            );
        }

        if (info.cleanedChatItemCount !== undefined) {
            this.debugInfoStore.addCleanedChatItemCount(
                info.cleanedChatItemCount,
            );
        }

        if (info.enqueuedChatItemCount !== undefined) {
            this.debugInfoStore.addEnqueueChatItemCount(
                info.enqueuedChatItemCount,
            );
        }

        // Meaningless to measure this in replay mode
        if (this.mode === Mode.LIVE && info.liveChatDelayInMs !== undefined) {
            this.debugInfoStore.addLiveChatDelay(info.liveChatDelayInMs);
        }
    }

    private readonly handleChatMessageEvent = async (
        event: fetchInterceptor.ChatEventDetail,
    ): Promise<void> => {
        const response = event.response as
            | YoutubeChatResponse
            | InitData
            | undefined;

        if (!response) {
            return;
        }

        await this.processChatItems(response);
    };

    private readonly dequeueAvailableChatItems = () => {
        if (!this.isInitiated) {
            return;
        }

        batch(() => {
            let dequeueCount = MAX_DEQUEUE_ITEMS;
            while (dequeueCount > 0 && this.dequeueNormalChatItem()) {
                dequeueCount--;
            }
        });
    };

    /**
     * Dequeue a chat item from processed item queue
     *
     * @returns {boolean} - Whether we can continue to dequeue
     */
    private dequeueNormalChatItem(): boolean {
        const currentPlayerTimeInMsc =
            this.uiStore.state.playerState.videoCurrentTimeInSecs * 1000;

        const chatItemId = this.normalChatItemQueue[0];

        if (!chatItemId) {
            return false;
        }

        const chatItem = this.state.normalChatItems[chatItemId];
        if (!chatItem) {
            throw createError(`Chat Item not found for id = ${chatItemId}`);
        }

        // Outdated, continue next dequeue
        if (
            this.isOutdatedChatItemForPlayerTime(
                chatItem,
                currentPlayerTimeInMsc,
            )
        ) {
            this.updateDebugInfo({
                outdatedChatEventCount: 1,
                liveChatDelayInMs:
                    currentPlayerTimeInMsc - chatItem.value.videoTimestampInMs,
            });

            this.setState('normalChatItems', {
                [chatItemId]: undefined,
            });

            this.normalChatItemQueue.shift();
            return true;
        }

        if (
            !isTimeToDispatch({
                chatItem: chatItem.value,
                currentPlayerTimeInMsc,
            })
        ) {
            this.updateDebugInfo({
                processChatEventQueueLength: this.normalChatItemQueue.length,
            });
            return false;
        }

        // Wait until the width is determined
        if (!chatItem.element) {
            return false;
        }

        this.updateDebugInfo({
            liveChatDelayInMs:
                currentPlayerTimeInMsc - chatItem.value.videoTimestampInMs,
        });

        const isInserted = benchmarkRuntime((): boolean => {
            const addTimestamp = Date.now();
            const lineNumber = getLineNumber({
                chatItemsByLineNumber: this.chatItemsByLineNumber,
                elementWidth: chatItem.element!.getBoundingClientRect().width,
                addTimestamp,
                maxLineNumber: this.uiStore.maxNumberOfLines(),
                flowTimeInSec: this.settingsStore.settings.flowTimeInSec,
                containerWidth: this.uiStore.messageFlowDimensionPx().width,
                displayNumberOfLines: chatItem.numberOfLines,
            });

            // No place to insert
            if (lineNumber === undefined) {
                return false;
            }

            for (
                let i = lineNumber;
                i < lineNumber + chatItem.numberOfLines;
                i++
            ) {
                const line = this.chatItemsByLineNumber.get(i);
                if (line) {
                    line.push(chatItem);
                } else {
                    this.chatItemsByLineNumber.set(i, [chatItem]);
                }
            }

            this.setState('normalChatItems', chatItem.value.id, {
                lineNumber,
                addTimestamp,
                // Freeze the width value for performance
                // This item should be removed anyway when the player width is updated
                width: chatItem.element?.getBoundingClientRect().width,
            });

            this.normalChatItemQueue.shift();
            return true;
        }, this.debugInfoStore.state.isDebugging);

        if (isInserted.result) {
            this.updateDebugInfo({
                processChatEventMs: isInserted.runtime,
            });
        }

        return isInserted.result;
    }

    private isOutdatedChatItemForPlayerTime(
        chatItem: ChatItemModel,
        currentPlayerTimeInMsc: number,
    ): boolean {
        if (chatItem.value.chatType === 'pinned') {
            return false;
        }

        if (this.mode === Mode.LIVE && !chatItem.isInitData) {
            return false;
        }

        const factor = getOutdatedFactor(chatItem.value);
        return isOutdatedChatItem({
            factor,
            currentPlayerTimeInMsc,
            chatItemAtVideoTimestampInMs: chatItem.value.videoTimestampInMs,
        });
    }

    private readonly cleanDisplayedChatItems = (): void => {
        if (!this.isInitiated) {
            return;
        }

        const currentTimestamp = Date.now();
        const flowTimeInMs = this.settingsStore.settings.flowTimeInSec * 1000;

        const cutoffTimestamp = currentTimestamp - flowTimeInMs;

        let cleanedChatItemCount = 0;

        function shouldKeepChatItem(item: ChatItemModel) {
            if (item.addTimestamp === undefined) {
                // Waiting to be added, keep it
                return true;
            }

            return item.addTimestamp >= cutoffTimestamp;
        }

        batch(() => {
            for (const chatItemId in this.state.normalChatItems) {
                if (Object.hasOwn(this.state.normalChatItems, chatItemId)) {
                    const chatItem = this.state.normalChatItems[chatItemId]!;
                    if (shouldKeepChatItem(chatItem)) {
                        return;
                    }

                    if (chatItem.lineNumber === undefined) {
                        throw createError(
                            `Unknown line number for ${chatItem.value.id}`,
                        );
                    }

                    const line =
                        this.chatItemsByLineNumber.get(chatItem.lineNumber) ??
                        [];
                    const index = line.findIndex(
                        (i) => i.value.id === chatItem.value.id,
                    );

                    if (index === -1) {
                        throw createError(
                            `Unknown index in line number ${chatItem.lineNumber} for ${chatItem.value.id}`,
                        );
                    }

                    line.splice(
                        line.findIndex((i) => i.value.id === chatItem.value.id),
                        1,
                    );
                    cleanedChatItemCount++;

                    this.setState('normalChatItems', {
                        [chatItemId]: undefined,
                    });
                }
            }
        });

        this.updateDebugInfo({ cleanedChatItemCount });
    };

    private readonly processChatItems = async (
        response: YoutubeChatResponse | InitData,
    ): Promise<void> => {
        const { continuationContents } = response;

        if (!continuationContents) {
            return;
        }

        const isInitData = youtube.isInitData(response);

        if (isInitData) {
            this.reset();
        }

        const { runtime, result: enqueuedChatItemCount } =
            await benchmarkRuntimeAsync(async () => {
                const timeInfo = this.getCurrentTimeInfo();
                const chatItems =
                    this.mode === Mode.REPLAY
                        ? mapChatItemsFromReplayResponse(
                              timeInfo,
                              continuationContents as ReplayContinuationContents,
                              this.settingsStore.settings,
                              isInitData,
                          )
                        : mapChatItemsFromLiveResponse(
                              timeInfo,
                              continuationContents as LiveContinuationContents,
                              this.settingsStore.settings,
                              isInitData,
                          );

                const newItemTimestamp = chatItems[0]?.value.videoTimestampInMs;

                if (
                    this.mode === Mode.REPLAY &&
                    newItemTimestamp !== undefined &&
                    newItemTimestamp < this.lastTimestamp
                ) {
                    // New seek happened older than the current time
                    this.reset();
                }

                this.lastTimestamp = newItemTimestamp!;

                batch(() => {
                    chatItems.forEach((item) => {
                        const chatItemId = item.value.id;
                        if (
                            chatItemId in this.state.normalChatItems ||
                            chatItemId in this.state.stickyChatItems
                        ) {
                            return;
                        }

                        if (!item.messageSettings.isSticky) {
                            this.setState('normalChatItems', {
                                [chatItemId]: item,
                            });
                            this.normalChatItemQueue.push(chatItemId);
                        } else if (!this.closedPinnedComment.has(chatItemId)) {
                            this.setState('stickyChatItems', {
                                [item.value.id]: item,
                            });
                        }
                    });
                });

                return chatItems.length;
            }, this.debugInfoStore.state.isDebugging);

        this.updateDebugInfo({
            processXhrResponseMs: runtime,
            processChatEventQueueLength: this.normalChatItemQueue.length,
            enqueuedChatItemCount,
        });
    };

    private attachReactiveContext(
        attachChatEvent: (
            callback: (e: fetchInterceptor.ChatEventDetail) => void,
        ) => () => void,
    ) {
        createRoot((dispose) => {
            onMount(() => {
                logInfo('attach chat event listener');
                const cleanup = attachChatEvent(this.handleChatMessageEvent);
                onCleanup(() => {
                    cleanup();
                });
            });

            createEffect((prev) => {
                if (prev === this.uiStore.state.playerState.isPaused) {
                    return;
                }

                this.handlePlayerPauseOrResume(
                    this.uiStore.state.playerState.isPaused,
                );

                return this.uiStore.state.playerState.isPaused;
            });

            createEffect((prev) => {
                const newWidth = this.uiStore.state.playerState.width;
                if (prev === newWidth) {
                    return;
                }

                this.handlePlayerSizeChange(
                    this.uiStore.state.playerState.width,
                );

                return newWidth;
            });

            createEffect((prev) => {
                const newSpeed = this.settingsStore.settings.flowTimeInSec;
                if (prev === newSpeed) {
                    return;
                }

                this.handleSpeedChange(newSpeed);

                return newSpeed;
            });

            createEffect((prev) => {
                if (prev === this.debugInfoStore.state.isDebugging) {
                    return;
                }

                if (this.debugInfoStore.state.isDebugging) {
                    this.startDebug();
                }

                return this.debugInfoStore.state.isDebugging;
            });

            createEffect((prev) => {
                const newLineHeight = this.uiStore.lineHeight();
                if (prev === newLineHeight) {
                    return;
                }

                this.handleLineHeightChange(newLineHeight);
                return newLineHeight;
            });

            createEffect((prev) => {
                const newMaxNumberOfLines = this.uiStore.maxNumberOfLines();
                if (prev === newMaxNumberOfLines) {
                    return;
                }

                this.handleMaxNumberOfLinesChange(newMaxNumberOfLines);
                return newMaxNumberOfLines;
            });

            onCleanup(() => {
                this.clearAllIntervals();
            });

            this.cleanup = dispose;
        });
    }

    private async processInitData(initData: InitData): Promise<void> {
        this.mode = isReplayInitData(initData) ? Mode.REPLAY : Mode.LIVE;
        await this.processChatItems(initData);
        this.isInitiated = true;
    }
}
