import { z } from 'zod';
import {
  PushInstallationProof,
  PushInstallationUpdate,
  PushInstallationDelete,
  PushInstallationStatus,
} from '@rove/contracts';
import { ApiError, type ApiClient } from './index';
const Pending = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('register'), accountId: z.uuid(), input: PushInstallationUpdate }).strict(),
  z.object({ kind: z.literal('remove'), accountId: z.uuid(), input: PushInstallationDelete }).strict(),
]);
const State = PushInstallationProof.extend({
  revision: z.number().int().positive().nullable(),
  pending: Pending.nullable(),
  wanted: z.boolean().default(false),
}).strict();
type State = z.infer<typeof State>;
type Api = Pick<ApiClient, 'pushInstallationStatus' | 'registerPushInstallation' | 'removePushInstallation'>;
export interface PushStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

/** One journal per API/app project, shared across accounts. Persist before every remote mutation. */
export class PushRegistration {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private storage: PushStorage,
    private identity: () => { installationId: string; secret: string },
    private uuid: () => string,
  ) {}
  private serial<T>(work: () => Promise<T>) {
    const result = this.tail.then(work, work);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async load(create: boolean): Promise<State | null> {
    const value = await this.storage.read();
    if (value !== null) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(value);
      } catch {
        throw new Error('Notification storage needs recovery. Your saved installation was not replaced.');
      }
      const parsed = State.safeParse(decoded);
      if (!parsed.success)
        throw new Error('Notification storage needs recovery. Your saved installation was not replaced.');
      return parsed.data;
    }
    if (!create) return null;
    const state = State.parse({ ...this.identity(), revision: null, pending: null, wanted: false });
    await this.save(state);
    return state;
  }
  private save(state: State) {
    return this.storage.write(JSON.stringify(state));
  }
  private check(current: () => boolean) {
    if (!current()) throw new Error('Your account changed. Reopen notification settings.');
  }
  private async replay(state: State, accountId: string, api: Api, current: () => boolean) {
    const pending = state.pending;
    if (!pending) return state;
    this.check(current);
    if (pending.accountId !== accountId) {
      // Never send a previous account's intent using the new account's credentials.
      const result = PushInstallationStatus.parse(
        await api.pushInstallationStatus({ installationId: state.installationId, secret: state.secret }),
      );
      this.check(current);
      if (result.installationId !== state.installationId)
        throw new Error('Notification registration could not be verified.');
      const next = { ...state, revision: result.revision, pending: null };
      await this.save(next);
      return next;
    }
    let result: z.infer<typeof PushInstallationStatus>;
    try {
      result = PushInstallationStatus.parse(
        await (pending.kind === 'register'
          ? api.registerPushInstallation(pending.input)
          : api.removePushInstallation(pending.input)),
      );
    } catch (failure) {
      if (!(failure instanceof ApiError) || failure.code !== 'PUSH_REGISTRATION_CHANGED') throw failure;
      this.check(current);
      const status = PushInstallationStatus.parse(
        await api.pushInstallationStatus({ installationId: state.installationId, secret: state.secret }),
      );
      this.check(current);
      if (status.installationId !== state.installationId)
        throw new Error('Notification registration could not be verified.', { cause: failure });
      const next = { ...state, revision: status.revision, pending: null };
      await this.save(next);
      return next;
    }
    this.check(current);
    if (
      result.installationId !== state.installationId ||
      result.revision !== (pending.input.expectedRevision ?? 0) + 1 ||
      result.enabled !== (pending.kind === 'register')
    )
      throw new Error('Notification registration could not be verified.');
    const next = { ...state, revision: result.revision, pending: null };
    await this.save(next);
    return next;
  }
  wantsEnabled() {
    return this.serial(async () => (await this.load(false))?.wanted ?? false);
  }
  enable(
    accountId: string,
    token: string,
    platform: 'ios' | 'android',
    api: Api,
    current: () => boolean,
    explicit = true,
  ) {
    return this.serial(async () => {
      this.check(current);
      let state = (await this.load(true))!;
      this.check(current);
      if (!explicit && !state.wanted) return false;
      state = { ...state, wanted: true };
      await this.save(state);
      this.check(current);
      state = await this.replay(state, accountId, api, current);
      const status = PushInstallationStatus.parse(
        await api.pushInstallationStatus({ installationId: state.installationId, secret: state.secret }),
      );
      this.check(current);
      if (status.installationId !== state.installationId)
        throw new Error('Notification registration could not be verified.');
      if (!explicit && !status.enabled && status.revision !== null) {
        await this.save({ ...state, revision: status.revision, wanted: false, pending: null });
        return false;
      }
      const input = PushInstallationUpdate.parse({
        installationId: state.installationId,
        secret: state.secret,
        expectedRevision: status.revision,
        mutationId: this.uuid(),
        token,
        platform,
      });
      state = { ...state, revision: status.revision, pending: { kind: 'register', accountId, input } };
      await this.save(state);
      this.check(current);
      const saved = await this.replay(state, accountId, api, current);
      const confirmed = PushInstallationStatus.parse(
        await api.pushInstallationStatus({ installationId: saved.installationId, secret: saved.secret }),
      );
      this.check(current);
      if (confirmed.installationId !== saved.installationId)
        throw new Error('Notification registration could not be verified.');
      await this.save({ ...saved, revision: confirmed.revision, wanted: confirmed.enabled });
      return confirmed.enabled;
    });
  }
  disable(accountId: string, api: Api, current: () => boolean) {
    return this.serial(async () => {
      this.check(current);
      let state = await this.load(false);
      if (!state) return;
      this.check(current);
      state = { ...state, wanted: false };
      await this.save(state);
      this.check(current);
      // Resolve an uncertain registration before logout; otherwise a late first register could win.
      state = await this.replay(state, accountId, api, current);
      const status = PushInstallationStatus.parse(
        await api.pushInstallationStatus({ installationId: state.installationId, secret: state.secret }),
      );
      this.check(current);
      if (status.installationId !== state.installationId)
        throw new Error('Notification registration could not be verified.');
      if (!status.enabled || status.revision === null) {
        await this.save({ ...state, revision: status.revision, pending: null });
        return;
      }
      const input = PushInstallationDelete.parse({
        installationId: state.installationId,
        secret: state.secret,
        expectedRevision: status.revision,
        mutationId: this.uuid(),
      });
      state = { ...state, revision: status.revision, pending: { kind: 'remove', accountId, input } };
      await this.save(state);
      this.check(current);
      await this.replay(state, accountId, api, current);
    });
  }
}
