import { z } from 'zod';
import { Profile, Quote, RideDetails, RideSummary, Place, Capabilities, DriverProfile, DriverOffer, type Coordinate, type Heartbeat } from '@rove/contracts';
export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number, public requestId?: string) { super(message); }
}
export type Transport = (url: string, options: RequestInit) => Promise<Response>;
export class ApiClient {
  constructor(private baseUrl: string, private token: () => Promise<string | null>, private transport: Transport = (url, options) => fetch(url, options)) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname))) throw new Error('The API must use HTTPS.');
  }
  async request<T>(path: string, schema: z.ZodType<T>, options: { method?: string; body?: unknown; key?: string; signal?: AbortSignal } = {}): Promise<T> {
    const token = await this.token();
    if (!token) throw new ApiError('UNAUTHENTICATED', 'Please sign in.', 401);
    const controller = new AbortController();
    const abort = () => controller.abort(); options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 15_000);
    try {
      const response = await this.transport(`${this.baseUrl.replace(/\/$/, '')}${path}`, { method: options.method ?? 'GET', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.key ? { 'Idempotency-Key': options.key } : {}) },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) });
      const json: unknown = await response.json();
      if (!response.ok) {
        const parsed = z.object({ error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() }) }).safeParse(json);
        throw new ApiError(parsed.success ? parsed.data.error.code : 'REQUEST_FAILED', parsed.success ? parsed.data.error.message : 'Unable to complete this request.', response.status, parsed.success ? parsed.data.error.requestId : undefined);
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success) throw new ApiError('INCOMPATIBLE_RESPONSE', 'Please update the app or contact support.', 502);
      return parsed.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('CONNECTION_UNAVAILABLE', 'Connection interrupted. Refresh before trying again.', 0);
    } finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
  }
  me() { return this.request('/v1/me', Profile); }
  register(name: string, role: 'rider' | 'driver') { return this.request('/v1/me', Profile, { method: 'POST', body: { name, role } }); }
  capabilities() { return this.request('/v1/me/capabilities', Capabilities); }
  places(query: string, signal?: AbortSignal) { return this.request(`/v1/places?q=${encodeURIComponent(query)}`, z.object({ places: z.array(Place) }), signal ? { signal } : {}); }
  quote(pickup: Place, destination: Place, service: 'standard' | 'accessible') { return this.request('/v1/quotes', Quote, { method: 'POST', body: { pickup, destination, service } }); }
  book(quoteId: string, key: string) { return this.request('/v1/ride-requests', RideSummary, { method: 'POST', body: { quoteId }, key }); }
  ride(id: string) { return this.request(`/v1/rides/${encodeURIComponent(id)}`, RideDetails); }
  rides(before?: string) { return this.request(`/v1/rides${before ? `?before=${encodeURIComponent(before)}` : ''}`, z.object({ rides: z.array(RideDetails), nextCursor: z.string().nullable() })); }
  transition(id: string, state: RideSummary['state'], expectedVersion: number, key: string) {
    return this.request(`/v1/rides/${encodeURIComponent(id)}/transitions`, RideSummary, { method: 'POST', body: { state, expectedVersion }, key });
  }
  driverProfile(signal?: AbortSignal) { return this.request('/v1/drivers/me', DriverProfile, signal ? { signal } : {}); }
  availability(online: boolean, coordinate: Coordinate | undefined, key: string) {
    return this.request('/v1/drivers/me/availability', z.object({ online: z.boolean() }), { method: 'PUT', body: { online, coordinate }, key });
  }
  heartbeat(input: z.infer<typeof Heartbeat>, signal?: AbortSignal) { return this.request('/v1/drivers/me/heartbeat', z.object({ accepted: z.boolean() }), { method: 'POST', body: input, ...(signal ? { signal } : {}) }); }
  offers() { return this.request('/v1/drivers/me/offers', z.object({ offers: z.array(DriverOffer) })); }
  accept(offerId: string, key: string) { return this.request(`/v1/offers/${encodeURIComponent(offerId)}/accept`, RideSummary, { method: 'POST', body: {}, key }); }
  decline(offerId: string, key: string) { return this.request(`/v1/offers/${encodeURIComponent(offerId)}/decline`, z.object({ declined: z.boolean() }), { method: 'POST', body: {}, key }); }
}
