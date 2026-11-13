export const darkMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#101614' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9AABA3' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#101614' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#16352A' }] },
  { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1C2823' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#2C3A34' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#F3F7F5' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0D1C18' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#9AABA3' }] },
];

type ThemeMap = { setOptions: (options: Record<string, unknown>) => void };

export function mapStyleForDocument(): typeof darkMapStyle | undefined {
  return document.documentElement.dataset.theme === 'dark' ? darkMapStyle : undefined;
}

export function bindMapTheme(map: ThemeMap): () => void {
  const apply = () => map.setOptions({ styles: mapStyleForDocument() });
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
