import { useRef, useState, type ReactNode } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { Conversation, ConversationThread } from '@rove/contracts';
import { Banner, Button, Copy, EmptyState, Screen, theme } from './index';
import avatar from '../assets/messages/avatar.png';
const time = (value: string) =>
  new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const date = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
function Avatar({ unread = false }: { unread?: boolean }) {
  return (
    <View>
      <Image source={avatar} style={styles.avatar} accessible={false} />
      {unread && <View style={styles.unread} />}
    </View>
  );
}
export function MessageInbox({
  conversations,
  error,
  loaded,
  role,
  footer,
  open,
  refresh,
  refreshing,
  older,
  newer,
}: {
  conversations: Conversation[];
  error: string | null;
  loaded: boolean;
  role: 'rider' | 'driver';
  footer: ReactNode;
  open: (id: string) => void;
  refresh: () => void;
  refreshing: boolean;
  older?: () => void;
  newer?: () => void;
}) {
  return (
    <Screen
      floatingFooter
      footer={footer}
      contentStyle={{ padding: 20, gap: 16 }}
      onRefresh={refresh}
      refreshing={refreshing}
    >
      <Copy kind="title" style={styles.title}>
        Messages
      </Copy>
      <Copy kind="muted" style={styles.subtitle}>
        {role === 'driver' ? 'Riders from your trips' : 'Drivers from your rides'}
      </Copy>
      {error && <Banner error message={error} />}
      {!loaded && !error && <Copy kind="muted">Loading messages…</Copy>}
      {loaded && !conversations.length && (
        <EmptyState
          title="Your conversations start here"
          message="Once a driver accepts a ride, you can message each other here."
        />
      )}
      {newer && <Button title="Newer conversations" variant="secondary" onPress={newer} />}
      <View>
        {conversations.map((c) => (
          <Pressable
            key={c.id}
            testID={`conversation-${c.id}`}
            onPress={() => open(c.id)}
            accessibilityRole="button"
            accessibilityLabel={`${c.name}${c.unread ? ', unread messages' : ''}, ${date(c.rideCreatedAt)} ride`}
            style={styles.inboxRow}
          >
            <Avatar unread={c.unread > 0} />
            <View style={{ flex: 1, gap: 3 }}>
              <View style={styles.row}>
                <Copy style={styles.name} numberOfLines={1}>
                  {c.name}
                </Copy>
                <Copy kind="muted" style={styles.small}>
                  {c.latest ? date(c.latest.createdAt) : date(c.rideCreatedAt)}
                </Copy>
              </View>
              <Copy
                numberOfLines={1}
                style={[styles.subtitle, { color: c.unread ? theme.text : theme.muted }]}
              >
                {c.latest
                  ? `${c.latest.mine ? 'You: ' : ''}${c.latest.text}`
                  : c.canSend
                    ? 'Send a message'
                    : 'Conversation closed'}
              </Copy>
              <Copy kind="muted" style={styles.small}>
                {date(c.rideCreatedAt)} · {time(c.rideCreatedAt)} ride{!c.canSend ? ' · Read-only' : ''}
              </Copy>
            </View>
          </Pressable>
        ))}
      </View>
      {older && <Button title="Older conversations" variant="secondary" onPress={older} />}
    </Screen>
  );
}
export function MessageThreadView({
  data,
  error,
  text,
  setText,
  busy,
  send,
  report,
  back,
  openRide,
  refresh,
  role,
}: {
  data: ConversationThread | null;
  error: string | null;
  text: string;
  setText: (value: string) => void;
  busy: boolean;
  send: () => void;
  report: (reason: 'harassment' | 'unsafe' | 'spam' | 'other') => void;
  back: () => void;
  openRide: (id: string) => void;
  refresh: () => void;
  role: 'rider' | 'driver';
}) {
  const list = useRef<ScrollView>(null),
    atBottom = useRef(true);
  const [reporting, setReporting] = useState(false);
  const c = data?.conversation;
  const replies =
    role === 'driver'
      ? ['I’m outside now', 'Running 3 minutes late', 'I’m at the pickup spot']
      : ['I’m at the front entrance', 'I’ll be there shortly', 'Where should I meet you?'];
  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.header}>
          <Pressable
            style={styles.circle}
            accessibilityRole="button"
            accessibilityLabel="Back to messages"
            onPress={back}
          >
            <Copy style={{ fontSize: 28 }}>‹</Copy>
          </Pressable>
          <Avatar />
          <View style={{ flex: 1 }}>
            <Copy style={styles.name} numberOfLines={1}>
              {c?.name ?? 'Conversation'}
            </Copy>
            <Copy kind="muted" style={styles.small}>
              {c?.canSend ? 'Trip messages' : 'Read-only conversation'}
            </Copy>
          </View>
          {c && (
            <Pressable
              style={styles.circle}
              accessibilityRole="button"
              accessibilityLabel="Report conversation"
              onPress={() => setReporting((v) => !v)}
            >
              <Copy>•••</Copy>
            </Pressable>
          )}
        </View>
        {c && (
          <Pressable
            style={styles.trip}
            accessibilityRole="button"
            accessibilityLabel="View this trip"
            onPress={() => openRide(c.rideId)}
          >
            <Copy style={{ fontSize: 12, color: theme.gold }}>
              {date(c.rideCreatedAt)} · {time(c.rideCreatedAt)} ride · {c.state.replaceAll('_', ' ')}
            </Copy>
          </Pressable>
        )}
        {reporting && c && (
          <View style={styles.report}>
            <Copy>Report and close this conversation</Copy>
            <Copy kind="muted" style={styles.subtitle}>
              Further messages will be blocked. Your report goes to Help & support. For an emergency, call
              your local emergency number.
            </Copy>
            {(['harassment', 'unsafe', 'spam', 'other'] as const).map((reason) => (
              <Button
                key={reason}
                title={reason === 'unsafe' ? 'Safety concern' : reason[0]!.toUpperCase() + reason.slice(1)}
                variant="secondary"
                disabled={busy}
                onPress={() => {
                  report(reason);
                  setReporting(false);
                }}
              />
            ))}
            <Button title="Keep conversation" variant="secondary" onPress={() => setReporting(false)} />
          </View>
        )}
        {error && (
          <View style={styles.notice}>
            <Banner error message={error} />
            <Button title="Reconnect messages" variant="secondary" onPress={refresh} />
          </View>
        )}
        {!data && !error && (
          <Copy kind="muted" style={styles.notice}>
            Loading conversation…
          </Copy>
        )}
        <ScrollView
          ref={list}
          style={{ flex: 1 }}
          contentContainerStyle={styles.messages}
          keyboardShouldPersistTaps="handled"
          onScroll={(e) => {
            const n = e.nativeEvent;
            atBottom.current = n.contentOffset.y + n.layoutMeasurement.height >= n.contentSize.height - 60;
          }}
          scrollEventThrottle={100}
          onContentSizeChange={() => {
            if (atBottom.current) list.current?.scrollToEnd({ animated: false });
          }}
        >
          {data?.messages.length === 0 && (
            <Copy kind="muted" style={styles.subtitle}>
              Send a message to coordinate your pickup. Messages are available for 30 days.
            </Copy>
          )}
          {data?.messages.map((m) => (
            <View key={m.id} style={[styles.bubble, m.mine ? styles.outgoing : styles.incoming]}>
              <Copy style={[styles.body, m.mine && { color: '#17140C' }]}>{m.text}</Copy>
              <Copy style={[styles.small, { color: m.mine ? '#51452B' : theme.muted }]}>
                {time(m.createdAt)}
                {m.mine ? ' · Sent' : ''}
              </Copy>
            </View>
          ))}
        </ScrollView>
        {c?.canSend ? (
          <View style={styles.composer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: 8, paddingVertical: 6 }}
            >
              {replies.map((reply) => (
                <Pressable
                  key={reply}
                  style={styles.quick}
                  onPress={() => setText(reply)}
                  disabled={busy}
                  accessibilityRole="button"
                >
                  <Copy style={{ fontSize: 13, color: theme.gold }}>{reply}</Copy>
                </Pressable>
              ))}
            </ScrollView>
            <View style={[styles.row, { alignItems: 'flex-end', gap: 10 }]}>
              <TextInput
                testID="message-input"
                accessibilityLabel="Message"
                placeholder="Write a message…"
                placeholderTextColor={theme.muted}
                value={text}
                onChangeText={setText}
                editable={!busy}
                maxLength={1000}
                multiline
                style={styles.input}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send message"
                disabled={busy || !text.trim()}
                onPress={send}
                style={[styles.send, (busy || !text.trim()) && { opacity: 0.5 }]}
              >
                <Copy style={{ color: '#17140C', fontSize: 24 }}>{busy ? '…' : '↑'}</Copy>
              </Pressable>
            </View>
            <Copy kind="muted" style={styles.small}>
              {text.length}/1000 · Only message when it is safe to do so.
            </Copy>
          </View>
        ) : (
          c && (
            <Copy kind="muted" style={styles.notice}>
              {c.blocked ? 'This conversation is closed after a report.' : 'This conversation is read-only.'}{' '}
              Messages are available for 30 days.
            </Copy>
          )
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  title: { fontSize: 26, lineHeight: 36, letterSpacing: -0.52, fontFamily: 'Manrope_800ExtraBold' },
  subtitle: { fontSize: 13, lineHeight: 20 },
  small: { fontSize: 11, lineHeight: 17 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#242424' },
  unread: {
    position: 'absolute',
    right: 0,
    top: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.gold,
    borderWidth: 2,
    borderColor: '#000',
  },
  inboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  name: { fontSize: 15, lineHeight: 23, fontFamily: 'Manrope_700Bold', flexShrink: 1 },
  header: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingVertical: 12, alignItems: 'center' },
  circle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.border,
  },
  trip: {
    marginHorizontal: 20,
    marginBottom: 10,
    padding: 12,
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: theme.glassGoldBorder,
    backgroundColor: 'rgba(207,185,125,0.08)',
  },
  messages: { padding: 20, gap: 12, flexGrow: 1 },
  bubble: {
    maxWidth: '85%',
    paddingHorizontal: 15,
    paddingVertical: 11,
    gap: 5,
    borderWidth: 1,
    borderRadius: 20,
  },
  outgoing: {
    alignSelf: 'flex-end',
    backgroundColor: theme.glassGold,
    borderColor: theme.glassGoldBorder,
    borderBottomRightRadius: 4,
  },
  incoming: {
    alignSelf: 'flex-start',
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderBottomLeftRadius: 4,
  },
  body: { fontSize: 14, lineHeight: 22 },
  composer: { paddingHorizontal: 20, paddingBottom: 10, gap: 8 },
  quick: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: theme.glassGoldBorder,
    backgroundColor: 'rgba(207,185,125,0.08)',
    paddingHorizontal: 14,
    minHeight: 48,
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 130,
    color: theme.text,
    fontSize: 14,
    lineHeight: 22,
    fontFamily: 'Manrope_500Medium',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: theme.glassGold,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: theme.glassGoldBorder,
  },
  notice: { marginHorizontal: 20, marginVertical: 8, fontSize: 12, lineHeight: 20, gap: 8 },
  report: { padding: 20, gap: 8 },
});
