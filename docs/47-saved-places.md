# Saved places

Backend, mobile client and booking controls implemented September 8, 2026. Native-device verification and Home-screen shortcuts remain pending.

## Storage and API

Migration `0011_saved_places.sql` adds at most one Home and one Work slot per rider through a unique owner/slot constraint. It stores only the rider ID, slot kind and provider place ID, plus a generated row ID. Provider addresses and coordinates are resolved when used rather than cached in this table. This follows [Google's place-ID storage exemption](https://developers.google.com/maps/documentation/places/web-service/policies). Provider attribution and the broader stored ride/quote data retention review remain launch requirements.

The protected endpoints are:

| Endpoint | Behavior |
| --- | --- |
| GET `/v1/saved-places` | List the signed-in rider's saved slot names and IDs |
| GET `/v1/saved-places/:kind` | Resolve current provider details for an owned Home/Work slot |
| PUT `/v1/saved-places/:kind` | Validate a provider ID and save it if the expected previous value still matches |
| DELETE `/v1/saved-places/:kind` | Remove an owned slot if its expected provider ID still matches |

PUT accepts `placeId` and `expectedPlaceId` (null for a new slot). DELETE accepts a non-null `expectedPlaceId`. Ownership is taken from verified authentication, never the request body. Unknown fields and slot names are rejected. Existing authentication, disabled-account enforcement, no-store responses and shared database rate limiting apply; provider-backed operations use the places limit. The shared mobile client exposes list, resolve, save and remove methods without automatic mutation retries.

A user-row lock serializes concurrent initial saves even when no slot exists. Updates recheck that the owner is an enabled rider after provider resolution. Stale updates/deletions return `SAVED_PLACE_CHANGED` with status 409. Repeating an already-achieved value or deletion succeeds. This is value-based conflict detection, not a revision history: changing away and back to the same provider ID is treated as the same current value.

Saving does not establish availability or lock a fare. Booking must still use the normal server-resolved quote, service-area validation and matching flow. Missing/obsolete provider IDs surface an error so the rider can search again; no guessed address is substituted.

## Verification

Six new Postgres domain tests cover owner isolation, current provider resolution without persisted address fields, concurrent initial writes, repeat/stale writes and deletes, provider failure, non-rider rejection and disabling an owner during lookup. One API test covers authentication, strict body/slot validation, no-store responses and delete conflicts. One client test covers the exact mutation payloads and methods. All existing suites were rerun against disposable databases with the new migration.

No production database was migrated. The disposable local server subsequently restarted through its development watcher and exposes the new table. Apply versioned migrations in the intended development/staging environment before enabling the UI or deploying these endpoints. The change is additive: an application rollback can leave the unused table in place; do not drop user data as an automatic rollback step.

## Booking integration

An expandable Home & Work panel in booking lists the owned slots. A selected route address can be saved or explicitly replace a slot; saved slots can be removed or resolved into the current pickup/destination field. The displayed replacement address makes the change reviewable. Identical saves are disabled. Saving/removing is guarded against duplicate taps; a failed mutation or refresh clears the stale slot list and offers reload, preserving the server conflict check. Account-scoped booking remounts isolate local state.

Saved-place resolution runs through the route editor's existing latest-request guard. Editing an address cancels and invalidates obsolete resolution responses. It never bypasses quote review. The UI reuses the shared charcoal cards and gold/outlined controls, but this expanded management panel is not yet a final Figma-matched Home shortcut layout.

The running synthetic browser completed save Home, use Home as pickup, save Work, replace/remove Home, use Work as destination and request a fresh quote. The API confirmed the replacement IDs. No ride or payment was requested. The shared test suites, type checks and rider platform exports were rerun.

## Next integration

Add compact Home-screen shortcuts and refine management presentation using the existing Figma theme. Selection must resolve current details, then let the rider review the route and obtain a fresh quote. Handle loading, empty slots, conflicts, deleted slots, provider failures and account changes. Verify the complete save/use/replace/delete flow on iOS and Android before marking this feature complete.
