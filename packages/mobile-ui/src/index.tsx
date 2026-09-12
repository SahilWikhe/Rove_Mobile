import { useState, type PropsWithChildren, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
  type ViewStyle,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// Figma rider Home 2:12 and driver waiting 1:62. See docs/16-mobile-design-contract.md.
export const theme = {
  background: '#000000',
  surface: 'rgba(15,15,15,0.9)',
  raised: 'rgba(10,10,10,0.94)',
  gold: '#CFB97D',
  text: '#F4F0E8',
  muted: '#A0A0A0',
  border: 'rgba(255,255,255,0.12)',
  danger: '#FFB3AD',
  glassGold: 'rgba(207,185,125,0.92)',
  glassGoldBorder: 'rgba(239,223,179,0.24)',
  glassHighlight: 'rgba(255,255,255,0.2)',
};
export function Screen({
  children,
  scroll = true,
  contentStyle,
  footer,
  floatingFooter = false,
  underHeader = false,
  onRefresh,
  refreshing = false,
}: PropsWithChildren<{
  scroll?: boolean;
  contentStyle?: ViewStyle;
  footer?: ReactNode;
  floatingFooter?: boolean;
  /** An opaque navigation header already protects the top safe area. */
  underHeader?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
}>) {
  const insets = useSafeAreaInsets();
  const [footerHeight, setFooterHeight] = useState(90);
  const overlay = floatingFooter && Boolean(footer);
  const bottomSpace = overlay ? { paddingBottom: footerHeight + insets.bottom + 16 } : undefined;
  return (
    <SafeAreaView
      edges={{
        top: underHeader ? 'off' : 'additive',
        left: 'additive',
        right: 'additive',
        bottom: overlay ? 'off' : 'additive',
      }}
      style={styles.screen}
    >
      {scroll ? (
        <ScrollView
          refreshControl={
            onRefresh ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor={theme.gold}
                colors={[theme.gold]}
              />
            ) : undefined
          }
          contentContainerStyle={[styles.content, contentStyle, bottomSpace]}
          automaticallyAdjustKeyboardInsets
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }, contentStyle, bottomSpace]}>{children}</View>
      )}
      {overlay ? (
        <View
          pointerEvents="box-none"
          onLayout={(event) => setFooterHeight(event.nativeEvent.layout.height)}
          style={{
            position: 'absolute',
            left: insets.left,
            right: insets.right,
            bottom: insets.bottom,
            zIndex: 10,
          }}
        >
          {footer}
        </View>
      ) : (
        footer
      )}
    </SafeAreaView>
  );
}
export function Copy({
  children,
  kind = 'body',
  style,
}: PropsWithChildren<{ kind?: 'body' | 'title' | 'heading' | 'muted' | 'label'; style?: object }>) {
  return <Text style={[styles.body, styles[kind], style]}>{children}</Text>;
}
export function Brand({ driver = false }: { driver?: boolean }) {
  return (
    <View style={styles.brandRow}>
      <Text accessibilityLabel="Rove" style={styles.brand}>
        rove<Text style={{ color: theme.gold }}>·</Text>
      </Text>
      {driver && <Copy kind="label">DRIVER</Copy>}
    </View>
  );
}
export function Card({ children, style }: PropsWithChildren<{ style?: ViewStyle }>) {
  return <View style={[styles.card, style]}>{children}</View>;
}
export function Button({
  title,
  onPress,
  variant = 'gold',
  loading = false,
  disabled = false,
  style,
  textStyle,
}: {
  title: string;
  onPress: () => void;
  variant?: 'gold' | 'secondary' | 'danger';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant !== 'gold' && styles.secondary,
        variant === 'danger' && styles.dangerButton,
        style,
        (disabled || loading) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'gold' ? theme.background : theme.gold} />
      ) : (
        <Text
          style={[
            styles.buttonText,
            variant !== 'gold' && { color: variant === 'danger' ? theme.danger : theme.text },
            textStyle,
          ]}
        >
          {title}
        </Text>
      )}
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Copy kind="label">{label}</Copy>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.muted}
        {...props}
        style={[styles.input, props.style]}
      />
    </View>
  );
}
export function Banner({ message, error = false }: { message: string; error?: boolean }) {
  return (
    <View accessibilityRole="alert" style={[styles.banner, error && { borderColor: theme.danger }]}>
      <Text style={[styles.body, { color: error ? theme.danger : theme.gold }]}>{message}</Text>
    </View>
  );
}
export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <Card>
      <Copy kind="heading">{title}</Copy>
      <Copy kind="muted">{message}</Copy>
    </Card>
  );
}
export function RouteSummary({ pickup, destination }: { pickup: string; destination: string }) {
  return (
    <Card>
      <View style={styles.route}>
        <Text style={styles.pin}>○</Text>
        <View style={{ flex: 1 }}>
          <Copy kind="label">PICKUP</Copy>
          <Copy>{pickup}</Copy>
        </View>
      </View>
      <View style={styles.divider} />
      <View style={styles.route}>
        <Text style={styles.pin}>◇</Text>
        <View style={{ flex: 1 }}>
          <Copy kind="label">DESTINATION</Copy>
          <Copy>{destination}</Copy>
        </View>
      </View>
    </Card>
  );
}
export function Money({ cents, label }: { cents: number; label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Copy kind="label">{label}</Copy>
      <Copy kind="title" style={{ color: theme.gold }}>
        {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)}
      </Copy>
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.background },
  content: { padding: 22, gap: 24, paddingBottom: 32 },
  body: { fontFamily: 'Manrope_500Medium', fontSize: 16, lineHeight: 25, color: theme.text },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 34, lineHeight: 42, letterSpacing: -1.2 },
  heading: { fontFamily: 'Manrope_700Bold', fontSize: 22, lineHeight: 30, letterSpacing: -0.5 },
  muted: { color: theme.muted },
  label: { color: theme.muted, fontSize: 12, lineHeight: 19, letterSpacing: 1 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  brand: { fontFamily: 'Manrope_700Bold', fontSize: 39, letterSpacing: -2, color: theme.text },
  card: {
    borderRadius: 24,
    padding: 22,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderTopColor: theme.glassHighlight,
    gap: 14,
  },
  button: {
    backgroundColor: theme.glassGold,
    borderWidth: 1,
    borderColor: theme.glassGoldBorder,
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    minHeight: 56,
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondary: { backgroundColor: theme.surface, borderColor: theme.border },
  dangerButton: { backgroundColor: 'rgba(62,22,24,0.92)', borderColor: 'rgba(255,179,173,0.45)' },
  buttonText: { fontFamily: 'Manrope_700Bold', fontSize: 16, color: theme.background },
  field: { gap: 8 },
  input: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
    padding: 16,
    color: theme.text,
    fontFamily: 'Manrope_500Medium',
    fontSize: 16,
  },
  banner: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    backgroundColor: theme.surface,
    padding: 16,
  },
  route: { flexDirection: 'row', gap: 16, alignItems: 'center' },
  pin: { fontSize: 24, color: theme.gold },
  divider: { height: 1, backgroundColor: theme.border, marginLeft: 40 },
});

/** Shared rider/driver recovery UI; only the API determines verification status. */
export function EmailVerificationNotice({ loading, onSignIn }: { loading: boolean; onSignIn: () => void }) {
  return (
    <>
      <Copy kind="heading">Verify your email</Copy>
      <Copy kind="muted">
        Open the verification link from Auth0, then sign in again to continue. Check your spam folder if you
        don’t see it.
      </Copy>
      <Button title="I verified my email — sign in" loading={loading} onPress={onSignIn} />
      <Button title="Use a different account" variant="secondary" disabled={loading} onPress={onSignIn} />
    </>
  );
}
