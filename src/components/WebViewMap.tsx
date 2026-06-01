/**
 * WebView-based Map Component
 * 
 * Uses a WebView with Leaflet.js and OpenStreetMap tiles.
 * No API key required - works out of the box.
 * 
 * Features:
 * - Live position marker with accuracy circle
 * - Track polyline showing sailed route (incremental append - no full resend)
 * - Auto-center on current position
 * - Nautical-friendly styling
 * 
 * Performance notes:
 * - Track points are appended one at a time (trackAppend) instead of
 *   resending all points every second. This prevents JS thread blocking
 *   with large track arrays.
 * - On mount/reconnect, the full track is sent once as 'trackInit'.
 */

import React, { useRef, useCallback, useEffect, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

interface Coordinate {
  latitude: number;
  longitude: number;
}

interface WebViewMapProps {
  currentPosition?: Coordinate | null;
  accuracy?: number | null;
  trackPoints?: Coordinate[];
  style?: any;
}

/**
 * Generate the HTML for the Leaflet map.
 * This is injected into the WebView as a data URI.
 */
function generateMapHtml(initialLat: number, initialLng: number): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; }
    html, body, #map { width: 100%; height: 100%; }
    .position-marker {
      width: 16px; height: 16px;
      background: #e85d2a;
      border: 3px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 8px rgba(232,93,42,0.6);
    }
    .accuracy-circle {
      border: 2px solid rgba(232,93,42,0.3);
      background: rgba(232,93,42,0.1);
      border-radius: 50%;
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', {
      zoomControl: false,
      attributionControl: false
    }).setView([${initialLat}, ${initialLng}], 14);
    
    // OpenStreetMap tiles
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    // Position marker
    var posIcon = L.divIcon({
      className: '',
      html: '<div class="position-marker"></div>',
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
    var posMarker = null;
    var accuracyCircle = null;
    var trackCoords = [];
    var trackLine = null;
    var shouldFollow = true;

    // Disable auto-follow when user drags the map
    map.on('dragstart', function() { shouldFollow = false; });

    // Update position
    function updatePosition(lat, lng, accuracy) {
      if (!posMarker) {
        posMarker = L.marker([lat, lng], { icon: posIcon }).addTo(map);
      } else {
        posMarker.setLatLng([lat, lng]);
      }

      if (accuracy && accuracy < 200) {
        if (!accuracyCircle) {
          accuracyCircle = L.circle([lat, lng], {
            radius: accuracy,
            color: '#e85d2a',
            fillColor: '#e85d2a',
            fillOpacity: 0.1,
            weight: 1
          }).addTo(map);
        } else {
          accuracyCircle.setLatLng([lat, lng]);
          accuracyCircle.setRadius(accuracy);
        }
      }

      if (shouldFollow) {
        map.setView([lat, lng], map.getZoom());
      }
    }

    // Initialise track with full coords array (called once on mount)
    function initTrack(coords) {
      trackCoords = coords;
      if (trackLine) { map.removeLayer(trackLine); trackLine = null; }
      if (trackCoords.length > 1) {
        trackLine = L.polyline(trackCoords, {
          color: '#e85d2a',
          weight: 3,
          opacity: 0.8
        }).addTo(map);
      }
    }

    // Append a single new point to the polyline (fast - no full rebuild)
    function appendTrackPoint(lat, lng) {
      trackCoords.push([lat, lng]);
      if (trackCoords.length > 1) {
        if (!trackLine) {
          trackLine = L.polyline(trackCoords, {
            color: '#e85d2a',
            weight: 3,
            opacity: 0.8
          }).addTo(map);
        } else {
          trackLine.addLatLng([lat, lng]);
        }
      }
    }

    // Re-center on position
    function centerOnPosition() {
      shouldFollow = true;
      if (posMarker) {
        map.setView(posMarker.getLatLng(), Math.max(map.getZoom(), 14));
      }
    }

    // Message handler
    function handleMessage(data) {
      try {
        var msg = JSON.parse(data);
        if (msg.type === 'position') {
          updatePosition(msg.lat, msg.lng, msg.accuracy);
        } else if (msg.type === 'trackInit') {
          initTrack(msg.coords);
        } else if (msg.type === 'trackAppend') {
          appendTrackPoint(msg.lat, msg.lng);
        } else if (msg.type === 'center') {
          centerOnPosition();
        }
      } catch(e) {}
    }

    // Listen for messages from React Native
    window.addEventListener('message', function(event) { handleMessage(event.data); });
    document.addEventListener('message', function(event) { handleMessage(event.data); });
  </script>
</body>
</html>
`;
}

export default function WebViewMap({
  currentPosition,
  accuracy,
  trackPoints = [],
  style,
}: WebViewMapProps) {
  const webViewRef = useRef<WebView>(null);
  const webViewReadyRef = useRef(false);
  const lastSentLengthRef = useRef(0);

  // Initial center: current position or Denmark
  const initialLat = currentPosition?.latitude ?? 55.6761;
  const initialLng = currentPosition?.longitude ?? 12.5683;

  const mapHtml = useMemo(
    () => generateMapHtml(initialLat, initialLng),
    [] // Only generate once
  );

  // When WebView finishes loading, send the current full track once
  const handleLoad = useCallback(() => {
    webViewReadyRef.current = true;
    if (trackPoints.length > 0 && webViewRef.current) {
      const coords = trackPoints.map((p) => [p.latitude, p.longitude]);
      webViewRef.current.postMessage(JSON.stringify({ type: 'trackInit', coords }));
      lastSentLengthRef.current = trackPoints.length;
    }
  }, [trackPoints]);

  // Send position updates to WebView
  useEffect(() => {
    if (currentPosition && webViewRef.current && webViewReadyRef.current) {
      const msg = JSON.stringify({
        type: 'position',
        lat: currentPosition.latitude,
        lng: currentPosition.longitude,
        accuracy: accuracy ?? null,
      });
      webViewRef.current.postMessage(msg);
    }
  }, [currentPosition?.latitude, currentPosition?.longitude, accuracy]);

  // Append only NEW track points to WebView (never resend all points)
  useEffect(() => {
    if (!webViewRef.current || !webViewReadyRef.current) return;
    const newCount = trackPoints.length;
    const lastSent = lastSentLengthRef.current;
    if (newCount <= lastSent) return;
    // Send each new point as an append message
    for (let i = lastSent; i < newCount; i++) {
      const p = trackPoints[i];
      webViewRef.current.postMessage(
        JSON.stringify({ type: 'trackAppend', lat: p.latitude, lng: p.longitude })
      );
    }
    lastSentLengthRef.current = newCount;
  }, [trackPoints.length]);

  const centerOnPosition = useCallback(() => {
    if (webViewRef.current) {
      webViewRef.current.postMessage(JSON.stringify({ type: 'center' }));
    }
  }, []);

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        source={{ html: mapHtml }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        showsHorizontalScrollIndicator={false}
        showsVerticalScrollIndicator={false}
        onLoad={handleLoad}
      />
    </View>
  );
}

// Export centerOnPosition as a static method via ref
WebViewMap.centerOnPosition = (ref: React.RefObject<WebView>) => {
  if (ref.current) {
    ref.current.postMessage(JSON.stringify({ type: 'center' }));
  }
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 0,
  },
  webview: {
    flex: 1,
    backgroundColor: '#0a1628',
  },
});
