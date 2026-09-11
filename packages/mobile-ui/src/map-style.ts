import type { MapStyleElement } from 'react-native-maps';

/** Shared Google map palette; labels stay readable beneath the gold trip markers. */
export const darkMapStyle: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#0F0F0F' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#B8B4AD' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0A0A0A' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#292929' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#45413A' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#101D24' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#152019' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
];
