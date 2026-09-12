/** Only SDK status codes belong here; never include native error payloads or trip data. */
export function navigationFailure(status: string): string {
  switch (status) {
    case 'NETWORK_ERROR':
      return 'Unable to connect to directions. Check your internet connection and try again.';
    case 'LOCATION_DISABLED':
    case 'LOCATION_UNKNOWN':
      return 'Your location is unavailable. Turn on location access and try again.';
    case 'NO_ROUTE_FOUND':
      return 'No driving route was found for this stop. Return to the trip to check the address.';
    case 'API_KEY_NOT_AUTHORIZED':
    case 'NOT_AUTHORIZED':
      return 'Directions are temporarily unavailable. Return to your trip and contact support if this continues.';
    default:
      return 'Directions could not start. Please try again, or return to your trip.';
  }
}
