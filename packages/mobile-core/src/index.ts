import { EarningsDateRange } from '@rove/contracts';
import { WalletCustomerSession, WalletSetupSession, WalletSetupRequest } from '@rove/contracts';
import { z } from 'zod';
import {
  DriverDocumentReservation,
  DriverDocumentSummary,
  DriverDocumentList,
  DriverDocumentUploadTarget,
  DriverDocumentUploadCompletion,
  NotificationDeviceList,
  NotificationDeviceRevoke,
  NotificationDeviceRevoked,
  PushInstallationProof,
  PushInstallationUpdate,
  PushInstallationDelete,
  PushInstallationStatus,
  DriverPayoutStatus,
  DriverPayoutLink,
  SupportRequest,
  SupportRequests,
  SupportRequestInput,
  TrackingGrant,
  VehicleSubmissionUpdate,
  VehicleReviewResponse,
  type VehicleSubmission,
  SavedPlaces,
  SavedPlaceKind,
  SavedPlaceUpdate,
  SavedPlaceDelete,
  ProfileNameUpdate,
  PaymentSession,
  RideReceipt,
  RideDriverLocation,
  DriverEarnings,
  DriverTripEarnings,
  Profile,
  Quote,
  RideDetails,
  RideSummary,
  Place,
  Capabilities,
  DriverProfile,
  DriverOffer,
  type Coordinate,
  type Heartbeat,
} from '@rove/contracts';
export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public requestId?: string,
    public retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
export type Transport = (url: string, options: RequestInit) => Promise<Response>;
export class ApiClient {
  driverDocuments(signal?: AbortSignal) {
    return this.request('/v1/drivers/me/documents', DriverDocumentList, { ...(signal ? { signal } : {}) });
  }
  reserveDriverDocument(input: z.infer<typeof DriverDocumentReservation>, signal?: AbortSignal) {
    return this.request('/v1/drivers/me/documents', DriverDocumentSummary, {
      method: 'POST',
      body: DriverDocumentReservation.parse(input),
      ...(signal ? { signal } : {}),
    });
  }
  driverDocumentUploadTarget(id: string, signal?: AbortSignal) {
    z.uuid().parse(id);
    return this.request(`/v1/drivers/me/documents/${id}/upload`, DriverDocumentUploadTarget, {
      method: 'POST',
      body: {},
      ...(signal ? { signal } : {}),
    });
  }
  completeDriverDocument(id: string, key: string, signal?: AbortSignal) {
    z.uuid().parse(id);
    return this.request(`/v1/drivers/me/documents/${id}/complete`, DriverDocumentSummary, {
      method: 'POST',
      body: DriverDocumentUploadCompletion.parse({ key }),
      ...(signal ? { signal } : {}),
    });
  }
  supportRequests() {
    return this.request('/v1/support-requests', SupportRequests);
  }
  createSupportRequest(input: SupportRequestInput, key: string) {
    return this.request('/v1/support-requests', SupportRequest, {
      method: 'POST',
      body: SupportRequestInput.parse(input),
      key,
    });
  }
  vehicleSubmission() {
    return this.request('/v1/drivers/me/vehicle-submission', VehicleReviewResponse);
  }
  submitVehicle(vehicle: VehicleSubmission, expectedRevision: string | null) {
    return this.request('/v1/drivers/me/vehicle-submission', VehicleReviewResponse, {
      method: 'PUT',
      body: VehicleSubmissionUpdate.parse({ vehicle, expectedRevision }),
    });
  }
  notificationDevices(signal?: AbortSignal) {
    return this.request('/v1/me/notification-devices', NotificationDeviceList, {
      ...(signal ? { signal } : {}),
    });
  }
  revokeNotificationDevice(id: string, input: z.infer<typeof NotificationDeviceRevoke>) {
    z.uuid().parse(id);
    return this.request(`/v1/me/notification-devices/${id}`, NotificationDeviceRevoked, {
      method: 'DELETE',
      body: NotificationDeviceRevoke.parse(input),
    });
  }
  pushInstallationStatus(input: z.infer<typeof PushInstallationProof>, signal?: AbortSignal) {
    return this.request('/v1/push-installations/status', PushInstallationStatus, {
      method: 'POST',
      body: PushInstallationProof.parse(input),
      ...(signal ? { signal } : {}),
    });
  }
  registerPushInstallation(input: z.infer<typeof PushInstallationUpdate>) {
    return this.request('/v1/push-installations', PushInstallationStatus, {
      method: 'PUT',
      body: PushInstallationUpdate.parse(input),
    });
  }
  removePushInstallation(input: z.infer<typeof PushInstallationDelete>) {
    return this.request('/v1/push-installations', PushInstallationStatus, {
      method: 'DELETE',
      body: PushInstallationDelete.parse(input),
    });
  }
  savedPlaces(signal?: AbortSignal) {
    return this.request('/v1/saved-places', SavedPlaces, { ...(signal ? { signal } : {}) });
  }
  savedPlace(kind: SavedPlaceKind, signal?: AbortSignal) {
    return this.request(`/v1/saved-places/${SavedPlaceKind.parse(kind)}`, Place, {
      ...(signal ? { signal } : {}),
    });
  }
  savePlace(kind: SavedPlaceKind, placeId: string, expectedPlaceId: string | null) {
    return this.request(
      `/v1/saved-places/${SavedPlaceKind.parse(kind)}`,
      z.object({ ok: z.literal(true) }).strict(),
      { method: 'PUT', body: SavedPlaceUpdate.parse({ placeId, expectedPlaceId }) },
    );
  }
  removeSavedPlace(kind: SavedPlaceKind, expectedPlaceId: string) {
    return this.request(
      `/v1/saved-places/${SavedPlaceKind.parse(kind)}`,
      z.object({ ok: z.literal(true) }).strict(),
      { method: 'DELETE', body: SavedPlaceDelete.parse({ expectedPlaceId }) },
    );
  }
  constructor(
    private baseUrl: string,
    private token: () => Promise<string | null>,
    private transport: Transport = (url, options) => fetch(url, options),
  ) {
    const url = new URL(baseUrl);
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname))
    )
      throw new Error('The API must use HTTPS.');
  }
  async request<T>(
    path: string,
    schema: z.ZodType<T>,
    options: { method?: string; body?: unknown; key?: string; signal?: AbortSignal } = {},
  ): Promise<T> {
    const token = await this.token();
    if (!token) throw new ApiError('UNAUTHENTICATED', 'Please sign in.', 401);
    const controller = new AbortController();
    const abort = () => controller.abort();
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 15_000);
    try {
      const response = await this.transport(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        method: options.method ?? 'GET',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          ...(options.key ? { 'Idempotency-Key': options.key } : {}),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      const json: unknown = await response.json();
      if (!response.ok) {
        const parsed = z
          .object({
            error: z.object({ code: z.string(), message: z.string(), requestId: z.string().optional() }),
          })
          .safeParse(json);
        throw new ApiError(
          parsed.success ? parsed.data.error.code : 'REQUEST_FAILED',
          parsed.success ? parsed.data.error.message : 'Unable to complete this request.',
          response.status,
          parsed.success ? parsed.data.error.requestId : undefined,
          retryAfter(response.headers.get('Retry-After')),
        );
      }
      const parsed = schema.safeParse(json);
      if (!parsed.success)
        throw new ApiError('INCOMPATIBLE_RESPONSE', 'Please update the app or contact support.', 502);
      return parsed.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError('CONNECTION_UNAVAILABLE', 'Connection interrupted. Refresh before trying again.', 0);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
    }
  }
  updateProfileName(expectedProfileId: string, expectedName: string, name: string) {
    const body = ProfileNameUpdate.parse({ expectedProfileId, expectedName, name });
    return this.request('/v1/me', Profile, { method: 'PATCH', body });
  }
  me() {
    return this.request('/v1/me', Profile);
  }
  register(name: string, role: 'rider' | 'driver') {
    return this.request('/v1/me', Profile, { method: 'POST', body: { name, role } });
  }
  capabilities() {
    return this.request('/v1/me/capabilities', Capabilities);
  }
  places(query: string, signal?: AbortSignal) {
    return this.request(
      `/v1/places?q=${encodeURIComponent(query)}`,
      z.object({ places: z.array(Place) }),
      signal ? { signal } : {},
    );
  }
  quote(pickup: Place, destination: Place, service: 'standard' | 'accessible', signal?: AbortSignal) {
    return this.request('/v1/quotes', Quote, {
      method: 'POST',
      ...(signal ? { signal } : {}),
      body: { pickup, destination, service },
    });
  }
  book(quoteId: string, key: string) {
    return this.request('/v1/ride-requests', RideSummary, { method: 'POST', body: { quoteId }, key });
  }
  earnings(signal?: AbortSignal, before?: string, range?: EarningsDateRange) {
    const query = new URLSearchParams();
    if (before) query.set('before', before);
    if (range) {
      const valid = EarningsDateRange.parse(range);
      query.set('from', valid.from);
      query.set('through', valid.through);
    }
    return this.request(
      `/v1/drivers/me/earnings${query.size ? `?${query}` : ''}`,
      range ? DriverEarnings.refine((value) => value.periodTotal !== undefined) : DriverEarnings,
      signal ? { signal } : {},
    );
  }
  tripEarnings(rideId: string, signal?: AbortSignal) {
    return this.request(
      `/v1/drivers/me/earnings/${encodeURIComponent(rideId)}`,
      DriverTripEarnings,
      signal ? { signal } : {},
    );
  }
  driverLocation(rideId: string, signal?: AbortSignal) {
    return this.request(
      `/v1/rides/${encodeURIComponent(rideId)}/driver-location`,
      RideDriverLocation,
      signal ? { signal } : {},
    );
  }
  receipt(rideId: string, signal?: AbortSignal) {
    return this.request(
      `/v1/rides/${encodeURIComponent(rideId)}/receipt`,
      RideReceipt,
      signal ? { signal } : {},
    );
  }
  walletCustomerSession() {
    return this.request('/v1/wallet/customer-session', WalletCustomerSession, { method: 'POST', body: {} });
  }
  walletSetupSession(requestId: string) {
    return this.request('/v1/wallet/setup-session', WalletSetupSession, {
      method: 'POST',
      body: WalletSetupRequest.parse({ requestId }),
    });
  }
  paymentSession(rideId: string) {
    return this.request(`/v1/rides/${encodeURIComponent(rideId)}/payment-session`, PaymentSession, {
      method: 'POST',
      body: {},
    });
  }
  ride(id: string, signal?: AbortSignal) {
    return this.request(`/v1/rides/${encodeURIComponent(id)}`, RideDetails, signal ? { signal } : {});
  }
  rides(before?: string, signal?: AbortSignal) {
    return this.request(
      `/v1/rides${before ? `?before=${encodeURIComponent(before)}` : ''}`,
      z.object({ rides: z.array(RideDetails), nextCursor: z.string().nullable() }),
      signal ? { signal } : {},
    );
  }
  transition(id: string, state: RideSummary['state'], expectedVersion: number, key: string) {
    return this.request(`/v1/rides/${encodeURIComponent(id)}/transitions`, RideSummary, {
      method: 'POST',
      body: { state, expectedVersion },
      key,
    });
  }
  trackingSession() {
    return this.request('/v1/drivers/me/tracking-session', TrackingGrant, { method: 'POST', body: {} });
  }
  driverPayoutStatus(signal?: AbortSignal) {
    return this.request('/v1/drivers/me/payout-setup', DriverPayoutStatus, { ...(signal ? { signal } : {}) });
  }
  driverPayoutLink() {
    return this.request('/v1/drivers/me/payout-setup', DriverPayoutLink, { method: 'POST', body: {} });
  }
  driverProfile(signal?: AbortSignal) {
    return this.request('/v1/drivers/me', DriverProfile, signal ? { signal } : {});
  }
  availability(online: boolean, coordinate: Coordinate | undefined, key: string) {
    return this.request('/v1/drivers/me/availability', z.object({ online: z.boolean() }), {
      method: 'PUT',
      body: { online, coordinate },
      key,
    });
  }
  heartbeat(input: z.infer<typeof Heartbeat>, signal?: AbortSignal) {
    return this.request('/v1/drivers/me/heartbeat', z.object({ accepted: z.boolean() }), {
      method: 'POST',
      body: input,
      ...(signal ? { signal } : {}),
    });
  }
  offers(signal?: AbortSignal) {
    return this.request(
      '/v1/drivers/me/offers',
      z.object({ offers: z.array(DriverOffer) }),
      signal ? { signal } : {},
    );
  }
  accept(offerId: string, key: string) {
    return this.request(`/v1/offers/${encodeURIComponent(offerId)}/accept`, RideSummary, {
      method: 'POST',
      body: {},
      key,
    });
  }
  decline(offerId: string, key: string) {
    return this.request(
      `/v1/offers/${encodeURIComponent(offerId)}/decline`,
      z.object({ declined: z.boolean() }),
      { method: 'POST', body: {}, key },
    );
  }
}

function retryAfter(value: string | null): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds > 0 ? Math.min(seconds, 3600) : undefined;
}
