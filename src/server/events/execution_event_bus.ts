import {
    Message,
    Task,
    TaskStatusUpdateEvent,
    TaskArtifactUpdateEvent,
} from "../../types.js";

export type AgentExecutionEvent =
    | Message
    | Task
    | TaskStatusUpdateEvent
    | TaskArtifactUpdateEvent;

export interface ExecutionEventBus {
    publish(event: AgentExecutionEvent): void;
    on(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this;
    off(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this;
    once(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this;
    removeAllListeners(eventName?: 'event' | 'finished'): this;
    finished(): void;
}

/**
 * Web-compatible ExecutionEventBus using EventTarget.
 * Works across all modern runtimes: Node.js 15+, browsers, Cloudflare Workers, Deno, Bun.
 * 
 * This replaces Node.js EventEmitter to enable edge runtime compatibility.
 */
export class DefaultExecutionEventBus extends EventTarget implements ExecutionEventBus {
    // Map from original listener to wrapped EventListener for proper cleanup
    private listenerMap: WeakMap<(event: AgentExecutionEvent) => void, EventListener> = new WeakMap();
    // Track active listeners for removeAllListeners support
    private activeListeners: Map<string, Set<(event: AgentExecutionEvent) => void>> = new Map([
        ['event', new Set()],
        ['finished', new Set()]
    ]);

    publish(event: AgentExecutionEvent): void {
        this.dispatchEvent(new CustomEvent('event', { detail: event }));
    }

    finished(): void {
        this.dispatchEvent(new Event('finished'));
    }

    /**
     * EventEmitter-compatible method: on(eventName, listener)
     * Maps to addEventListener internally
     */
    on(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this {
        const wrappedListener = this.createWrappedListener(eventName, listener);
        this.listenerMap.set(listener, wrappedListener);
        this.addEventListener(eventName, wrappedListener);
        this.activeListeners.get(eventName)?.add(listener);
        return this;
    }

    /**
     * EventEmitter-compatible method: off(eventName, listener)
     * Maps to removeEventListener internally
     */
    off(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this {
        const wrappedListener = this.listenerMap.get(listener);
        if (wrappedListener) {
            this.removeEventListener(eventName, wrappedListener);
            this.listenerMap.delete(listener);
        }
        this.activeListeners.get(eventName)?.delete(listener);
        return this;
    }

    /**
     * EventEmitter-compatible method: once(eventName, listener)
     * Maps to addEventListener with { once: true }
     */
    once(eventName: 'event' | 'finished', listener: (event: AgentExecutionEvent) => void): this {
        const wrappedListener = this.createWrappedListener(eventName, listener);
        this.addEventListener(eventName, wrappedListener, { once: true });
        return this;
    }

    /**
     * EventEmitter-compatible method: removeAllListeners([eventName])
     * Removes all listeners for the specified event, or all events if not specified
     */
    removeAllListeners(eventName?: 'event' | 'finished'): this {
        if (eventName) {
            const listenersSet = this.activeListeners.get(eventName);
            if (listenersSet) {
                // Copy to array to avoid modification during iteration
                Array.from(listenersSet).forEach(listener => {
                    this.off(eventName, listener);
                });
            }
        } else {
            // Remove all listeners for all events
            this.activeListeners.forEach((listenersSet, event) => {
                Array.from(listenersSet).forEach(listener => {
                    this.off(event as 'event' | 'finished', listener);
                });
            });
        }
        return this;
    }

    /**
     * Helper to wrap listener functions to extract event data from CustomEvent.detail
     */
    private createWrappedListener(
        eventName: string,
        listener: (event: AgentExecutionEvent) => void
    ): EventListener {
        return (e: Event) => {
            if (e instanceof CustomEvent && e.type === 'event') {
                // 'event' type carries the AgentExecutionEvent in detail
                listener(e.detail);
            } else if (e.type === 'finished') {
                // 'finished' event doesn't carry data, but listener expects it
                // The actual usage only checks for finished signal, not the data
                listener(null as any);
            }
        };
    }
}
