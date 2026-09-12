import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Crypto from 'expo-crypto';
import type { ConversationList, ConversationThread } from '@rove/contracts';
import { ApiError, type ApiClient } from './index';
import { pollWhileForeground } from './foreground-polling';

type Cursor = NonNullable<ConversationList['nextCursor']>;
export function useMessageInbox(api: ApiClient, signedIn: boolean, cursor?: Cursor) {
  const [data, setData] = useState<ConversationList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [version, setVersion] = useState(0);
  const focus = useCallback(() => {
    if (!signedIn) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setData(null);
    });
    const stop = pollWhileForeground({
      load: (signal) => api.conversations(cursor, signal),
      intervalMs: 10000,
      onData: (result) => {
        setData(result);
        setError(null);
        setRefreshing(false);
      },
      onError: (failure) => {
        setData(null);
        setError(failure instanceof Error ? failure.message : 'Messages unavailable.');
        setRefreshing(false);
      },
    });
    return () => {
      stop();
      subscription.remove();
      setData(null);
    };
  }, [api, signedIn, cursor, version]);
  return {
    data,
    error,
    focus,
    refreshing,
    refresh: () => {
      setRefreshing(true);
      setVersion((v) => v + 1);
    },
  };
}
export function useMessageThread(api: ApiClient, id: string, signedIn: boolean) {
  const [data, setData] = useState<ConversationThread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const current = useRef(false),
    generation = useRef(0),
    sending = useRef(false);
  const mutation = useRef<AbortController | null>(null);
  const attempt = useRef<{ text: string; requestId: string } | null>(null);
  const readThrough = useRef(0);
  const focus = useCallback(() => {
    if (!signedIn || !id) return;
    current.current = AppState.currentState === 'active';
    const subscription = AppState.addEventListener('change', (state) => {
      current.current = state === 'active';
      generation.current++;
      mutation.current?.abort();
      if (!current.current) {
        setData(null);
        setText('');
      }
    });
    const stop = pollWhileForeground({
      load: (signal) => api.conversation(id, signal),
      intervalMs: 3000,
      onData: (result) => {
        setData(result);
        setLoadError(null);
        // Read acknowledgements are monotonic and safe to retry after an interrupted response.
        const through = result.messages.at(-1)?.sequence;
        if (through && through > readThrough.current && current.current) {
          const epoch = generation.current;
          void api
            .readMessages(id, through)
            .then(() => {
              if (current.current && generation.current === epoch) readThrough.current = through;
            })
            .catch(() => {});
        }
      },
      onError: (failure) => {
        setData(null);
        setLoadError(failure instanceof Error ? failure.message : 'Messages unavailable.');
        if (failure instanceof ApiError && [401, 403, 404].includes(failure.status)) {
          setText('');
          attempt.current = null;
        }
      },
    });
    return () => {
      current.current = false;
      generation.current++;
      mutation.current?.abort();
      stop();
      subscription.remove();
      setData(null);
    };
  }, [api, id, signedIn, version]);
  async function send() {
    if (sending.current || !current.current || !data?.conversation.canSend || !text.trim()) return;
    const body = text.trim();
    if (attempt.current && attempt.current.text !== body) attempt.current = null;
    const request = attempt.current ?? { text: body, requestId: Crypto.randomUUID() };
    attempt.current = request;
    sending.current = true;
    setBusy(true);
    setError(null);
    const epoch = generation.current,
      controller = new AbortController();
    mutation.current = controller;
    try {
      await api.sendMessage(id, request.text, request.requestId, controller.signal);
      if (current.current && generation.current === epoch) {
        attempt.current = null;
        setText('');
        setVersion((v) => v + 1);
      }
    } catch (failure) {
      if (current.current && generation.current === epoch) {
        setError(
          failure instanceof Error ? failure.message : 'Message not confirmed. Retry to check the same send.',
        );
        if (failure instanceof ApiError && [401, 403, 404, 409].includes(failure.status)) {
          setData(null);
          setText('');
          attempt.current = null;
        }
      }
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  async function report(reason: 'harassment' | 'unsafe' | 'spam' | 'other') {
    if (sending.current || !current.current) return;
    sending.current = true;
    setBusy(true);
    const epoch = generation.current;
    const controller = new AbortController();
    mutation.current = controller;
    try {
      await api.reportConversation(id, reason, controller.signal);
      if (current.current && generation.current === epoch) {
        setText('');
        setVersion((v) => v + 1);
      }
    } catch (failure) {
      if (current.current && generation.current === epoch)
        setError(failure instanceof Error ? failure.message : 'Report could not be confirmed.');
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  return {
    data,
    error: error ?? loadError,
    text,
    setText,
    busy,
    send,
    report,
    focus,
    refresh: () => {
      setError(null);
      setVersion((v) => v + 1);
    },
  };
}

export function useMessageUnread(api: ApiClient, accountId: string | undefined) {
  const [value, setValue] = useState<{ accountId: string; unread: number } | null>(null);
  const focus = useCallback(() => {
    if (!accountId) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setValue(null);
    });
    const stop = pollWhileForeground({
      load: (signal) => api.unreadMessages(signal),
      intervalMs: 10000,
      onData: (data) => setValue({ accountId, unread: data.unread }),
      onError: () => setValue(null),
    });
    return () => {
      subscription.remove();
      stop();
      setValue(null);
    };
  }, [api, accountId]);
  return { focus, unread: value?.accountId === accountId ? (value?.unread ?? 0) : 0 };
}
