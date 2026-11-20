import { useEffect, useRef, useState } from 'react';
import { HARARE } from '../home/camera';
import { loadGoogleMaps } from '../home/googleMap';
import { mapsBrowserKey } from '../config/env';

type Pin = { latitude: string; longitude: string };

function currentMapCenter(): Promise<{ lat: number; lng: number }> {
  const fallback = { lat: HARARE.latitude, lng: HARARE.longitude };
  if (!navigator.geolocation) return Promise.resolve(fallback);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
          resolve(fallback);
          return;
        }
        resolve({ lat: latitude, lng: longitude });
      },
      () => resolve(fallback),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 },
    );
  });
}

export function AddressPinDialog({
  address,
  onCancel,
  onConfirm,
}: {
  address: string;
  onCancel: () => void;
  onConfirm: (point: Pin) => void;
}) {
  const node = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  const [moved, setMoved] = useState(false);
  const [point, setPoint] = useState<Pin | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelRef.current();
    };
    window.addEventListener('keydown', closeOnEscape);
    let marker: { setPosition: (position: { lat: number; lng: number }) => void; getPosition: () => { lat: () => number; lng: () => number } | null } | null = null;
    let active = true;
    void Promise.all([loadGoogleMaps(mapsBrowserKey()), currentMapCenter()]).then(([, center]) => {
      if (!active || !node.current) return;
      const maps = (window as Window & { google?: { maps?: PinMaps } }).google?.maps;
      if (!maps) {
        setMapError('The map is unavailable. Try again when the map loads.');
        return;
      }
      const map = new maps.Map(node.current, {
        center,
        zoom: 13,
        clickableIcons: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
      });
      marker = new maps.Marker({ map, position: center, draggable: true });
      const remember = () => {
        const position = marker?.getPosition();
        if (!position) return;
        setMoved(true);
        setPoint({ latitude: position.lat().toFixed(7), longitude: position.lng().toFixed(7) });
      };
      maps.event.addListener(marker, 'dragend', remember);
      maps.event.addListener(map, 'click', (event) => {
        if (!event?.latLng) return;
        marker?.setPosition({ lat: event.latLng.lat(), lng: event.latLng.lng() });
        remember();
      });
    }).catch(() => {
      if (active) setMapError('The map is unavailable. Try again when the map loads.');
    });
    return () => {
      active = false;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  return (
    <div className="confirm-dialog-backdrop" onClick={onCancel}>
      <div className="confirm-dialog address-pin-dialog" role="dialog" aria-modal="true" aria-labelledby="address-pin-title" onClick={(event) => event.stopPropagation()}>
        <h2 id="address-pin-title">Confirm the location</h2>
        <p>Drag the pin to {address}. The typed address stays as you entered it.</p>
        <div ref={node} className="address-pin-map" />
        {mapError ? <p className="error" role="alert">{mapError}</p> : null}
        <div className="confirm-dialog-actions">
          <button type="button" className="confirm-keep" onClick={onCancel}>Cancel</button>
          <button type="button" className="confirm-accept" disabled={!moved || !point} onClick={() => { if (point) onConfirm(point); }}>Use this pin</button>
        </div>
      </div>
    </div>
  );
}

type PinMaps = {
  Map: new (element: HTMLElement, options: Record<string, unknown>) => object;
  Marker: new (options: Record<string, unknown>) => {
    setPosition: (position: { lat: number; lng: number }) => void;
    getPosition: () => { lat: () => number; lng: () => number } | null;
  };
  event: {
    addListener: (instance: object, name: string, handler: (event?: { latLng?: { lat: () => number; lng: () => number } | null }) => void) => void;
  };
};
