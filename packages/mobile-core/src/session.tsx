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
import * as WebBrowser from 'expo-web-browser';
import { z } from 'zod';
import type { Profile } from '@rove/contracts';
import { ApiClient, ApiError } from './index';

WebBrowser.maybeCompleteAuthSession();
const StoredSession = z.object({
  accessToken: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number(),
});
type Tokens = z.infer<typeof StoredSession>;
interface Config {
  apiUrl: string;
  issuer: string;
  clientId: string;
  audience: string;
  scheme: string;
  role: 'rider' | 'driver';
  synthetic?: boolean;
}
interface Session {
  ready: boolean;
  api: ApiClient;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  needsProfile: boolean;
  configured: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  register: (name: string) => Promise<void>;
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
  const discovery = AuthSession.useAutoDiscovery(config.issuer || unavailableDiscovery);
  const redirectUri = AuthSession.makeRedirectUri({ scheme: config.scheme, path: 'auth/callback' });
  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId: config.clientId || 'unconfigured',
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      usePKCE: true,
      scopes: ['openid', 'profile', 'offline_access'],
      extraParams: { audience: config.audience },
    },
    discovery,
  );
  const tokenRef = useRef<Tokens | null>(null);
  const refreshRef = useRef<Promise<string | null> | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  const [needsProfile, setNeedsProfile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const storageKey = `rove.${config.role}.${synthetic ? 'synthetic' : 'oidc'}.session.v1`;
  const save = useCallback(
    async (tokens: Tokens | null) => {
      tokenRef.current = tokens;
      // Browser previews deliberately keep tokens only in memory.
      if (Platform.OS !== 'web') {
        if (tokens)
          await SecureStore.setItemAsync(storageKey, JSON.stringify(tokens), {
            keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          });
        else await SecureStore.deleteItemAsync(storageKey);
      }
    },
    [storageKey],
  );
  const api = useMemo(
    () =>
      new ApiClient(config.apiUrl || 'https://unconfigured.invalid', async () => {
        const tokens = tokenRef.current;
        if (!tokens) return null;
        if (tokens.expiresAt > Date.now() + 30_000) return tokens.accessToken;
        if (!tokens.refreshToken || !discovery) return null;
        if (!refreshRef.current) {
          refreshRef.current = (async () => {
            try {
              const renewed = await AuthSession.refreshAsync(
                { clientId: config.clientId, refreshToken: tokens.refreshToken! },
                discovery,
              );
              await save({
                accessToken: renewed.accessToken,
                refreshToken: renewed.refreshToken ?? tokens.refreshToken!,
                expiresAt: Date.now() + (renewed.expiresIn ?? 300) * 1000,
              });
              return renewed.accessToken;
            } catch {
              await save(null);
              setProfile(null);
              return null;
            } finally {
              refreshRef.current = null;
            }
          })();
        }
        return refreshRef.current;
      }),
    [config.apiUrl, config.clientId, discovery, save],
  );
  const loadProfile = useCallback(async () => {
    try {
      setProfile(await api.me());
      setNeedsProfile(false);
    } catch (failure) {
      if (failure instanceof ApiError && failure.code === 'PROFILE_REQUIRED') setNeedsProfile(true);
      else throw failure;
    }
  }, [api]);
  useEffect(() => {
    if (!configured || Platform.OS === 'web') {
      setReady(true);
      return;
    }
    if (!discovery) return;
    let alive = true;
    void (async () => {
      setLoading(true);
      try {
        const raw = await SecureStore.getItemAsync(storageKey);
        if (!alive || !raw) return;
        const tokens = StoredSession.safeParse(JSON.parse(raw));
        if (!tokens.success) {
          await SecureStore.deleteItemAsync(storageKey);
          return;
        }
        tokenRef.current = tokens.data;
        await loadProfile();
      } catch {
        if (alive) setError('Please sign in to continue.');
      } finally {
        if (alive) {
          setLoading(false);
          setReady(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadProfile, configured, discovery, storageKey]);
  async function signIn() {
    if (synthetic && configured) {
      setLoading(true);
      setError(null);
      try {
        await save({ accessToken: `synthetic-${config.role}`, expiresAt: Date.now() + 86_400_000 });
        await loadProfile();
      } catch (failure) {
        setError(failure instanceof ApiError ? failure.message : 'The local test server is unavailable.');
      } finally {
        setLoading(false);
      }
      return;
    }
    if (!configured || !request || !discovery) {
      setError('Sign in is temporarily unavailable. Please try again later.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await promptAsync();
      if (result.type !== 'success') {
        if (result.type === 'error') setError('Sign in could not be completed. Please try again.');
        return;
      }
      if (!request.codeVerifier || !result.params.code) throw new Error('Invalid sign-in response');
      const tokens = await AuthSession.exchangeCodeAsync(
        {
          clientId: config.clientId,
          code: result.params.code,
          redirectUri,
          extraParams: { code_verifier: request.codeVerifier },
        },
        discovery,
      );
      await save({
        accessToken: tokens.accessToken,
        ...(tokens.refreshToken ? { refreshToken: tokens.refreshToken } : {}),
        expiresAt: Date.now() + (tokens.expiresIn ?? 300) * 1000,
      });
      await loadProfile();
    } catch {
      setError('Sign in could not be completed. Please try again.');
    } finally {
      setLoading(false);
    }
  }
  async function signOut() {
    const refreshToken = tokenRef.current?.refreshToken;
    await save(null);
    setProfile(null);
    setNeedsProfile(false);
    setError(null);
    if (refreshToken && discovery?.revocationEndpoint) {
      try {
        await AuthSession.revokeAsync({ clientId: config.clientId, token: refreshToken }, discovery);
      } catch {
        /* Local credentials are already removed. */
      }
    }
  }
  async function register(name: string) {
    setLoading(true);
    setError(null);
    try {
      setProfile(await api.register(name, config.role));
      setNeedsProfile(false);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Unable to save your profile.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <SessionContext.Provider
      value={{
        ready,
        api,
        profile,
        loading,
        error,
        needsProfile,
        configured,
        synthetic,
        signIn,
        signOut,
        register,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}
