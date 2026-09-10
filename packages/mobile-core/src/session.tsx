import { useNotificationTaps } from './use-notification-taps';
import type { NotificationTarget } from './notification-taps';
import { usePushNotifications } from './use-push-notifications';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Platform } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { discoveryIssuer } from './discovery-issuer';
import { createScopedSessionStorage } from './session-storage';
import * as WebBrowser from 'expo-web-browser';
import { z } from 'zod';
import type { Profile } from '@rove/contracts';
import { ApiClient, ApiError } from './index';
import { refreshWithRecovery, SessionRefreshUnavailable } from './auth-refresh';
import { createSessionCredentials } from './session-credentials';
import { operationJournal } from './operation-store';
import type { OperationJournal } from './operations';

WebBrowser.maybeCompleteAuthSession();
const StoredSession = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number(),
});
interface Config {
  apiUrl: string;
  issuer: string;
  clientId: string;
  audience: string;
  scheme: string;
  role: 'rider' | 'driver';
  synthetic?: boolean;
  pushProjectId?: string;
  onNotificationOpen?: (target: NotificationTarget) => void;
}
interface Session {
  notifications: ReturnType<typeof usePushNotifications>;
  operations: Promise<OperationJournal> | null;
  ready: boolean;
  api: ApiClient;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  needsProfile: boolean;
  cleanupRequired: boolean;
  canRetryProfile: boolean;
  retryProfile: () => Promise<void>;
  configured: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  register: (name: string) => Promise<void>;
  updateName: (name: string, expectedName: string) => Promise<string>;
  reloadName: () => Promise<string>;
  synthetic: boolean;
}
const SessionContext = createContext<Session | null>(null);
const unavailableDiscovery = { authorizationEndpoint: 'https://unconfigured.invalid/authorize' };
export function useSession(): Session {
  const value = useContext(SessionContext);
  if (!value) throw new Error('SessionProvider missing');
  return value;
}
export function SessionProvider({ config, children }: PropsWithChildren<{ config: Config }>) {
  const synthetic = __DEV__ && config.synthetic === true;
  const configured = Boolean(
    config.apiUrl && (synthetic || (config.issuer && config.clientId && config.audience)),
  );
  const discovery = AuthSession.useAutoDiscovery(discoveryIssuer(config.issuer) || unavailableDiscovery);
  const redirectUri = AuthSession.makeRedirectUri({ scheme: config.scheme, path: 'auth/callback' });
  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: config.clientId || 'unconfigured',
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      // Explicit sign-in must offer account entry even when the browser retains Auth0 SSO.
      // This is a login UX hint, not proof of recent authentication for sensitive actions.
      prompt: AuthSession.Prompt.Login,
      scopes: ['openid', 'profile', 'offline_access'],
      extraParams: { audience: config.audience },
    },
    discovery,
  );
  const [profile, setProfile] = useState<Profile | null>(null);
  const operations = useMemo(
    () => (profile ? operationJournal(config.apiUrl, profile.id, synthetic) : null),
    [config.apiUrl, profile, synthetic],
  );
  const retryingProfile = useRef(false);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [cleanupRequired, setCleanupRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storage = useMemo(
    () =>
      createScopedSessionStorage(
        {
          apiUrl: config.apiUrl,
          issuer: config.issuer,
          clientId: config.clientId,
          audience: config.audience,
          role: config.role,
          synthetic,
        },
        (value) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, value),
        {
          read: (key) => SecureStore.getItemAsync(key),
          write: (key, value) =>
            SecureStore.setItemAsync(key, value, {
              keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
            }),
          remove: (key) => SecureStore.deleteItemAsync(key),
        },
      ),
    [config.apiUrl, config.issuer, config.clientId, config.audience, config.role, synthetic],
  );
  const credentials = useMemo(
    () =>
      createSessionCredentials(async (tokens) => {
        // Browser previews deliberately keep tokens only in memory.
        if (Platform.OS === 'web') return;
        if (tokens) await storage.write(JSON.stringify(tokens));
        else await storage.remove();
      }),
    [storage],
  );
  useEffect(
    () => () => {
      credentials.begin();
    },
    [credentials],
  );
  const renderEpoch = credentials.epoch();
  const api = useMemo(
    () =>
      new ApiClient(config.apiUrl || 'https://unconfigured.invalid', () =>
        credentials.token(
          async (previous) => {
            if (!discovery) throw new SessionRefreshUnavailable();
            if (!previous.refreshToken) return null;
            const refreshToken = previous.refreshToken;
            const renewed = await refreshWithRecovery(() =>
              AuthSession.refreshAsync({ clientId: config.clientId, refreshToken }, discovery),
            );
            return {
              accessToken: renewed.accessToken,
              refreshToken: renewed.refreshToken ?? previous.refreshToken,
              expiresAt: Date.now() + (renewed.expiresIn ?? 300) * 1000,
            };
          },
          () => {
            setProfile(null);
            setNeedsProfile(false);
            setLoading(false);
            setReady(true);
          },
        ),
      ),
    [config.apiUrl, config.clientId, discovery, credentials],
  );
  const notifications = usePushNotifications({
    api,
    apiUrl: config.apiUrl,
    ...(config.pushProjectId ? { projectId: config.pushProjectId } : {}),
    ...(profile ? { accountId: profile.id } : {}),
    synthetic,
    sessionEpoch: renderEpoch,
    isCurrent: credentials.current,
  });
  useNotificationTaps({
    ready,
    accountId: profile?.id,
    role: config.role,
    api,
    epoch: renderEpoch,
    isCurrent: credentials.current,
    navigate: config.onNotificationOpen,
  });
  const loadProfile = useCallback(
    async (epoch: number, alive: () => boolean = () => true) => {
      if (!credentials.current(epoch) || !alive()) return;
      try {
        const updated = await api.me();
        if (!credentials.current(epoch) || !alive()) return;
        setProfile(updated);
        setNeedsProfile(false);
      } catch (failure) {
        if (!credentials.current(epoch) || !alive()) return;
        if (failure instanceof ApiError && failure.code === 'PROFILE_REQUIRED') setNeedsProfile(true);
        else throw failure;
      }
    },
    [api, credentials],
  );
  useEffect(() => {
    if (!configured || Platform.OS === 'web') {
      setReady(true);
      return;
    }
    if (!discovery) return;
    let alive = true;
    const epoch = credentials.begin();
    void (async () => {
      setLoading(true);
      try {
        const restored = await credentials.restore(epoch, async () => {
          const raw = await storage.read();
          if (!raw) return null;
          try {
            const parsed = StoredSession.safeParse(JSON.parse(raw));
            if (parsed.success) return parsed.data;
          } catch {
            /* Invalid local state is removed, never used as credentials. */
          }
          await storage.remove();
          return null;
        });
        if (restored && alive) await loadProfile(epoch, () => alive);
      } catch {
        if (alive && credentials.current(epoch))
          setError(
            credentials.peek()
              ? 'We couldn’t load your account. Please try again.'
              : 'Please sign in to continue.',
          );
      } finally {
        if (alive && credentials.current(epoch)) {
          setLoading(false);
          setReady(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadProfile, configured, discovery, storage, credentials]);
  async function signIn() {
    if (!configured || (!synthetic && (!request || !discovery))) {
      setError('Sign in is temporarily unavailable. Please try again later.');
      return;
    }
    const epoch = credentials.begin();
    setProfile(null);
    setNeedsProfile(false);
    setLoading(true);
    setError(null);
    try {
      if (!(await credentials.save(epoch, null))) return;
      setCleanupRequired(false);
      if (synthetic) {
        if (
          !(await credentials.save(epoch, {
            accessToken: `synthetic-${config.role}`,
            expiresAt: Date.now() + 86_400_000,
          }))
        )
          return;
      } else {
        const result = await promptAsync();
        if (!credentials.current(epoch)) return;
        if (result.type !== 'success') {
          if (result.type === 'error') setError('Sign in could not be completed. Please try again.');
          return;
        }
        if (!request?.codeVerifier || !result.params.code || !discovery)
          throw new Error('Invalid sign-in response');
        const tokens = await AuthSession.exchangeCodeAsync(
          {
            clientId: config.clientId,
            code: result.params.code,
            redirectUri,
            extraParams: { code_verifier: request.codeVerifier },
          },
          discovery,
        );
        if (
          !(await credentials.save(epoch, {
            accessToken: tokens.accessToken,
            ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
            expiresAt: Date.now() + (tokens.expiresIn ?? 300) * 1000,
          }))
        )
          return;
      }
      await loadProfile(epoch);
    } catch (failure) {
      if (credentials.current(epoch))
        setError(
          synthetic && failure instanceof ApiError
            ? failure.message
            : 'Sign in could not be completed. Please try again.',
        );
    } finally {
      if (credentials.current(epoch)) {
        setLoading(false);
        setReady(true);
      }
    }
  }
  async function signOut() {
    if (!credentials.current(renderEpoch)) throw new Error('Your session changed. Please retry sign-out.');
    await notifications.disable();
    if (!credentials.current(renderEpoch)) throw new Error('Your session changed. Please retry sign-out.');
    const refreshToken = credentials.peek()?.refreshToken;
    const epoch = credentials.begin();
    // Clear UI and memory before awaiting keychain or provider operations.
    setProfile(null);
    setNeedsProfile(false);
    setLoading(false);
    setReady(true);
    setError(null);
    try {
      await credentials.save(epoch, null);
      if (credentials.current(epoch)) setCleanupRequired(false);
    } catch {
      if (credentials.current(epoch)) setCleanupRequired(true);
      if (credentials.current(epoch)) setError('Device sign-out could not be saved. Please retry sign-out.');
      throw new Error('Device sign-out could not be saved. Please retry sign-out.');
    }
    if (refreshToken && discovery?.revocationEndpoint) {
      try {
        await AuthSession.revokeAsync({ clientId: config.clientId, token: refreshToken }, discovery);
      } catch {
        /* Local credentials are already removed. */
      }
    }
  }
  async function retryProfile() {
    if (retryingProfile.current || !credentials.current(renderEpoch) || !credentials.peek()) return;
    retryingProfile.current = true;
    const epoch = credentials.epoch();
    setLoading(true);
    setError(null);
    try {
      await loadProfile(epoch);
    } catch (failure) {
      if (credentials.current(epoch))
        setError(
          failure instanceof ApiError ? failure.message : 'We couldn’t load your account. Please try again.',
        );
    } finally {
      retryingProfile.current = false;
      if (credentials.current(epoch)) setLoading(false);
    }
  }
  async function updateName(name: string, expectedName: string) {
    if (!profile) throw new Error('Sign in to edit your profile.');
    const epoch = credentials.epoch();
    const updated = await api.updateProfileName(profile.id, expectedName, name);
    if (!credentials.current(epoch) || updated.id !== profile.id)
      throw new Error('Your signed-in account changed. Reopen your profile.');
    setProfile((current) => (current?.id === updated.id ? updated : current));
    return updated.name;
  }
  async function reloadName() {
    if (!profile) throw new Error('Sign in to view your profile.');
    const epoch = credentials.epoch();
    const updated = await api.me();
    if (!credentials.current(epoch) || updated.id !== profile.id)
      throw new Error('Your signed-in account changed. Reopen your profile.');
    setProfile((current) => (current?.id === updated.id ? updated : current));
    return updated.name;
  }
  async function register(name: string) {
    const epoch = credentials.epoch();
    setLoading(true);
    setError(null);
    try {
      const updated = await api.register(name, config.role);
      if (!credentials.current(epoch)) return;
      setProfile(updated);
      setNeedsProfile(false);
    } catch (failure) {
      if (credentials.current(epoch))
        setError(failure instanceof ApiError ? failure.message : 'Unable to save your profile.');
    } finally {
      if (credentials.current(epoch)) setLoading(false);
    }
  }
  return (
    <SessionContext.Provider
      value={{
        notifications,
        operations,
        ready,
        api,
        profile,
        loading,
        error,
        needsProfile,
        cleanupRequired,
        canRetryProfile: Boolean(credentials.peek()) && !profile && !needsProfile,
        retryProfile,
        configured,
        synthetic,
        signIn,
        signOut,
        register,
        updateName,
        reloadName,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
