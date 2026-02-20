const api = window.SubwayBuilderAPI;

if (!window.__TransitOverlayWarnFilterInstalled) {
    const originalWarn = console.warn ? console.warn.bind(console) : null;
    console.warn = (...args) => {
        try {
            const first = args && args.length > 0 ? String(args[0]) : '';
            if (first.includes('[Transit Overlay] Cannot inject layers: map instance is not ready.')) return;
        } catch (e) { }
        if (originalWarn) originalWarn(...args);
    };
    window.__TransitOverlayWarnFilterInstalled = true;
}

const getUniqueNetworkId = (type, net) => `${type}__${net}`;

const naturalSort = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

const LAYER_ID_LINES = 'real-transit-lines';
const LAYER_ID_LINES_HOVER = 'real-transit-lines-hover';
const LAYER_ID_STATIONS = 'real-transit-stations';
const SOURCE_ID = 'real-transit-source';
const STATION_CLUSTER_RADIUS_PX = 14;
const LINE_CANDIDATE_RADIUS_PX = 8;
const MODULE_INSTANCE_ID = `rt_overlay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
window.__RealTransitOverlayModuleId = MODULE_INSTANCE_ID;
const isActiveModuleInstance = () => window.__RealTransitOverlayModuleId === MODULE_INSTANCE_ID;

const safeGetSource = (map, sourceId) => {
    if (!map || !map.getSource) return null;
    try {
        return map.getSource(sourceId);
    } catch (e) {
        return null;
    }
};

const safeGetLayer = (map, layerId) => {
    if (!map || !map.getLayer) return null;
    try {
        return map.getLayer(layerId);
    } catch (e) {
        return null;
    }
};

const isMapStyleReady = (map) => {
    if (!map || !map.getSource || !map.addSource || !map.getLayer || !map.addLayer) return false;
    if (typeof map.isStyleLoaded === 'function') {
        try {
            if (!map.isStyleLoaded()) return false;
        } catch (e) {
            return false;
        }
    }
    return true;
};

const hasTransitSource = (map) => !!safeGetSource(map, SOURCE_ID);
const hasLinesLayer = (map) => !!safeGetLayer(map, LAYER_ID_LINES);
const hasLinesHoverLayer = (map) => !!safeGetLayer(map, LAYER_ID_LINES_HOVER);
const hasStationsLayer = (map) => !!safeGetLayer(map, LAYER_ID_STATIONS);
const canApplyFilters = (map) => hasTransitSource(map) && hasLinesLayer(map);

window.RealTransitState = {
    masterVisible: localStorage.getItem('rt_master') !== 'false',
    stationsVisible: localStorage.getItem('rt_stations') === 'true',
    activeTypes: [],
    activeNetworks: [],
    activeLines: [],
    hierarchy: {},
    lineNames: {}, // Stores display names for unique IDs
    currentCity: null,
    overlayOpen: false, // Tracks if the overlay panel is open
    cache: {},
    inFlightLoads: new Set(),
    missingDataCities: new Set(),
    missingDataLoggedCities: new Set(),
    loadRequestSeq: 0,
    uiRegistered: false,
    injectRetryTimer: null,
    hover: {
        mode: null,
        lineCandidates: [],
        lineIndex: 0,
        activeLineId: null,
        pinned: false,
        pinActivatedAt: 0,
        popup: null,
        domTooltip: null,
        lastLngLat: null,
        lastPoint: null,
        handlersBound: false,
        keydownHandler: null,
        globalPointerHandler: null,
        mapRef: null
    }
};

const normalizeStationName = (rawName) => String(rawName || '').trim().toLowerCase();

const getFeatureStationName = (feature) => {
    const p = feature && feature.properties ? feature.properties : {};
    return String(p.station_name || p.name || '').trim();
};

const getFeatureLineId = (feature) => {
    const p = feature && feature.properties ? feature.properties : {};
    return p._mod_line_id || null;
};

const getFeatureRouteName = (feature) => {
    const p = feature && feature.properties ? feature.properties : {};
    return String(p.route_name || 'Unnamed Line');
};

const getFeatureType = (feature) => {
    const p = feature && feature.properties ? feature.properties : {};
    return String(p.type || 'Other');
};

const getFeatureNetwork = (feature) => {
    const p = feature && feature.properties ? feature.properties : {};
    return String(p.network || 'Unknown');
};

const getFeatureColor = (feature) => {
    const p = feature && feature.properties ? feature.properties : {};
    return String(p.colour || p.color || '#9ca3af');
};

const PANEL_DEFAULT_TOP = 60;
const PANEL_SIDE_MARGIN = 16;
const PANEL_BOTTOM_MARGIN = 16;
const PANEL_COLLISION_GAP = 10;
const PANEL_DEFAULT_WIDTH = 320;
const PANEL_MIN_WIDTH = 260;
const PANEL_MIN_HEIGHT = 220;
const PANEL_MIN_USABLE_HEIGHT = 260;

const PANEL_COLLISION_SELECTORS = [
    '[data-testid*="warning" i]',
    '[class*="warning" i]',
    '[class*="alert" i]',
    '[aria-label*="warning" i]',
    '[title*="warning" i]'
];

function rectsOverlap(a, b) {
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function getElementRect(el) {
    if (!el || !el.isConnected || typeof el.getBoundingClientRect !== 'function') return null;
    const rect = el.getBoundingClientRect();
    if (!Number.isFinite(rect.width) || !Number.isFinite(rect.height)) return null;
    if (rect.width <= 0 || rect.height <= 0) return null;
    if (rect.bottom <= 0 || rect.right <= 0) return null;
    if (rect.top >= window.innerHeight || rect.left >= window.innerWidth) return null;
    return rect;
}

function getTopRightUiCollisionRects() {
    const viewportWidth = window.innerWidth || 1280;
    const viewportHeight = window.innerHeight || 720;
    const maxTop = Math.min(viewportHeight * 0.45, 320);
    const minLeft = viewportWidth * 0.55;
    const seen = new Set();
    const out = [];

    const addRect = (el) => {
        const rect = getElementRect(el);
        if (!rect) return;
        if (rect.top > maxTop) return;
        if (rect.right < minLeft) return;
        const key = `${Math.round(rect.left)}:${Math.round(rect.top)}:${Math.round(rect.right)}:${Math.round(rect.bottom)}`;
        if (seen.has(key)) return;
        seen.add(key);
        out.push(rect);
    };

    PANEL_COLLISION_SELECTORS.forEach((selector) => {
        try {
            document.querySelectorAll(selector).forEach(addRect);
        } catch (err) { }
    });

    // Fallback: detect warning row by visible label text in top-right UI.
    // Include ancestor containers to capture the full warning pill bounds and avoid jitter.
    try {
        const candidates = document.querySelectorAll('button, div, span, label');
        for (let i = 0; i < candidates.length; i += 1) {
            const el = candidates[i];
            const text = (el.textContent || '').trim().toLowerCase();
            if (text === 'warnings' || text === 'warning' || text.startsWith('warnings ')) {
                addRect(el);
                let ancestor = el.parentElement;
                let depth = 0;
                while (ancestor && depth < 6) {
                    addRect(ancestor);
                    const rect = getElementRect(ancestor);
                    if (rect && rect.width >= 160 && rect.height >= 28 && rect.height <= 120) break;
                    ancestor = ancestor.parentElement;
                    depth += 1;
                }
            }
        }
    } catch (err) { }

    return out;
}

function computePanelLayout() {
    const viewportWidth = window.innerWidth || 1280;
    const viewportHeight = window.innerHeight || 720;
    const panelWidth = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_DEFAULT_WIDTH, viewportWidth - 24));

    let top = PANEL_DEFAULT_TOP;
    let left = null;
    let right = PANEL_SIDE_MARGIN;

    const rightRect = {
        left: viewportWidth - right - panelWidth,
        right: viewportWidth - right,
        top,
        bottom: top + PANEL_MIN_HEIGHT
    };

    const collisionRects = getTopRightUiCollisionRects();
    const collidingRects = collisionRects.filter((rect) => rectsOverlap(rightRect, rect));
    if (collidingRects.length > 0) {
        const maxBottom = Math.max(...collidingRects.map((rect) => rect.bottom));
        top = Math.max(top, Math.ceil(maxBottom + PANEL_COLLISION_GAP));
    }

    let maxHeight = Math.max(PANEL_MIN_HEIGHT, viewportHeight - top - PANEL_BOTTOM_MARGIN);
    if (maxHeight < PANEL_MIN_USABLE_HEIGHT) {
        left = PANEL_SIDE_MARGIN;
        right = null;
        top = PANEL_DEFAULT_TOP;
        maxHeight = Math.max(PANEL_MIN_HEIGHT, viewportHeight - top - PANEL_BOTTOM_MARGIN);
    }

    return { top, left, right, width: panelWidth, maxHeight };
}

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function getPopupCtor() {
    if (window.mapboxgl && window.mapboxgl.Popup) return window.mapboxgl.Popup;
    if (window.maplibregl && window.maplibregl.Popup) return window.maplibregl.Popup;
    if (api && api.utils && api.utils.mapboxgl && api.utils.mapboxgl.Popup) return api.utils.mapboxgl.Popup;
    if (api && api.utils && api.utils.maplibregl && api.utils.maplibregl.Popup) return api.utils.maplibregl.Popup;
    return null;
}

function clearHoverHighlight(map) {
    if (!map || !hasLinesHoverLayer(map)) return;
    map.setFilter(LAYER_ID_LINES_HOVER, ['==', ['get', '_mod_line_id'], '__NONE__']);
}

function applyHoverHighlight(map, lineId) {
    if (!map || !hasLinesHoverLayer(map)) return;
    const targetId = lineId || '__NONE__';
    map.setFilter(LAYER_ID_LINES_HOVER, ['==', ['get', '_mod_line_id'], targetId]);
}

function ensureHoverPopup(map) {
    const s = window.RealTransitState;
    const hoverState = s.hover;
    if (hoverState.popup) return hoverState.popup;
    const PopupCtor = getPopupCtor();
    if (!PopupCtor) return null;
    hoverState.popup = new PopupCtor({
        closeButton: false,
        closeOnClick: false,
        maxWidth: '320px',
        offset: 12
    });
    return hoverState.popup;
}

function ensureHoverDomTooltip() {
    const hoverState = window.RealTransitState.hover;
    if (hoverState.domTooltip && hoverState.domTooltip.isConnected) return hoverState.domTooltip;
    const el = document.createElement('div');
    el.setAttribute('data-rt-hover-tooltip', 'true');
    el.style.position = 'fixed';
    el.style.zIndex = '999999';
    el.style.pointerEvents = 'none';
    el.style.background = 'rgba(10, 10, 10, 0.92)';
    el.style.color = '#fff';
    el.style.border = '1px solid rgba(255,255,255,0.2)';
    el.style.borderRadius = '6px';
    el.style.padding = '8px 10px';
    el.style.maxWidth = '320px';
    el.style.fontFamily = 'sans-serif';
    el.style.boxShadow = '0 8px 24px rgba(0,0,0,.35)';
    el.style.display = 'none';
    document.body.appendChild(el);
    hoverState.domTooltip = el;
    return el;
}

function setTooltipContentAndPosition(map, lngLat, point, html) {
    const hoverState = window.RealTransitState.hover;
    hoverState.lastLngLat = lngLat || null;
    hoverState.lastPoint = point || null;

    const popup = ensureHoverPopup(map);
    if (popup) {
        popup.setLngLat(lngLat).setHTML(html).addTo(map);
        if (hoverState.domTooltip) hoverState.domTooltip.style.display = 'none';
        return;
    }

    const tooltip = ensureHoverDomTooltip();
    tooltip.innerHTML = html;
    const x = point && typeof point.x === 'number' ? point.x + 14 : 12;
    const y = point && typeof point.y === 'number' ? point.y + 14 : 12;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y}px`;
    tooltip.style.display = 'block';
}

function clearHoverState(map, shouldRemovePopup = true, force = false) {
    const hoverState = window.RealTransitState.hover;
    if (hoverState.pinned && !force) return;
    hoverState.mode = null;
    hoverState.lineCandidates = [];
    hoverState.lineIndex = 0;
    hoverState.activeLineId = null;
    hoverState.pinned = false;
    hoverState.pinActivatedAt = 0;
    hoverState.lastLngLat = null;
    hoverState.lastPoint = null;
    if (shouldRemovePopup && hoverState.popup) hoverState.popup.remove();
    if (hoverState.domTooltip) hoverState.domTooltip.style.display = 'none';
    if (map && map.getCanvas) map.getCanvas().style.cursor = '';
    clearHoverHighlight(map);
}

function renderLineHoverPopup(map, lngLat, point) {
    const hoverState = window.RealTransitState.hover;
    const total = hoverState.lineCandidates.length;
    if (total === 0) {
        clearHoverState(map);
        return;
    }

    const index = ((hoverState.lineIndex % total) + total) % total;
    hoverState.lineIndex = index;
    const active = hoverState.lineCandidates[index];
    hoverState.activeLineId = active.lineId;
    hoverState.mode = 'line';

    const cycleHint = total > 1
        ? `<div style="font-size:10px;opacity:.7;margin-top:4px;">${index + 1}/${total} · Press Tab to cycle</div>`
        : '';
    const pinnedHint = hoverState.pinned
        ? `<div style="font-size:10px;opacity:.72;margin-top:2px;">Pinned - Click anywhere to close</div>`
        : '';

    const html = `
        <div style="font-size:12px;line-height:1.35;">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;">
                <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.72;">Line</div>
                <span style="
                    width:14px;
                    height:14px;
                    min-width:14px;
                    border-radius:999px;
                    background:${escapeHtml(active.color || '#9ca3af')};
                    border:1px solid rgba(255,255,255,.5);
                    margin-top:1px;
                "></span>
            </div>
            <div style="margin-top:2px;font-size:18px;font-weight:800;line-height:1.15;">${escapeHtml(active.routeName)}</div>
            <div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,.18);">
                <div><strong>Type:</strong> ${escapeHtml(active.type)}</div>
                <div><strong>Network:</strong> ${escapeHtml(active.network)}</div>
                ${cycleHint}
                ${pinnedHint}
            </div>
        </div>
    `;

    setTooltipContentAndPosition(map, lngLat, point, html);
    applyHoverHighlight(map, active.lineId);
    if (map.getCanvas) map.getCanvas().style.cursor = 'pointer';
}

function renderStationHoverPopup(map, lngLat, point, stationName, stationLines) {
    const title = stationName || 'Station';
    const lineChips = stationLines.length > 0
        ? stationLines.map(line => `
            <span style="
                display:inline-flex;
                align-items:center;
                max-width:100%;
                padding:2px 8px;
                border-radius:999px;
                border:1px solid rgba(255,255,255,.22);
                background:rgba(255,255,255,.08);
                font-size:12px;
                font-weight:600;
                line-height:1.2;
                white-space:nowrap;
                overflow:hidden;
                text-overflow:ellipsis;
                color:#fff;
            ">
                <span style="
                    width:12px;
                    height:12px;
                    min-width:12px;
                    border-radius:999px;
                    background:${escapeHtml(line.color || '#9ca3af')};
                    border:1px solid rgba(255,255,255,.5);
                    margin-right:8px;
                "></span>
                <span>${escapeHtml(line.routeName)}</span>
            </span>
        `).join('')
        : `<span style="
            display:inline-flex;
            align-items:center;
            padding:2px 8px;
            border-radius:999px;
            border:1px solid rgba(255,255,255,.22);
            background:rgba(255,255,255,.08);
            font-size:12px;
            font-weight:600;
            line-height:1.2;
        ">Unknown line</span>`;
    const html = `
        <div style="font-size:12px;line-height:1.35;">
            <div style="font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.72;">Station</div>
            <div style="margin-top:2px;font-size:18px;font-weight:800;line-height:1.15;">${escapeHtml(title)}</div>
            <div style="margin-top:8px;padding-top:6px;border-top:1px solid rgba(255,255,255,.18);font-weight:700;">Lines serving this station:</div>
            <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:6px;">${lineChips}</div>
        </div>
    `;
    setTooltipContentAndPosition(map, lngLat, point, html);
    if (map.getCanvas) map.getCanvas().style.cursor = 'pointer';
}

function getStationClusterFeatures(map, event, seedFeature) {
    if (!map || !map.queryRenderedFeatures || !hasStationsLayer(map) || !seedFeature || !seedFeature.geometry || !seedFeature.geometry.coordinates) return [];

    const seedNameNormalized = normalizeStationName(getFeatureStationName(seedFeature));
    const seedPoint = map.project(event.lngLat);
    const minPoint = { x: event.point.x - STATION_CLUSTER_RADIUS_PX, y: event.point.y - STATION_CLUSTER_RADIUS_PX };
    const maxPoint = { x: event.point.x + STATION_CLUSTER_RADIUS_PX, y: event.point.y + STATION_CLUSTER_RADIUS_PX };
    let nearby = [];
    try {
        nearby = map.queryRenderedFeatures([minPoint, maxPoint], { layers: [LAYER_ID_STATIONS] }) || [];
    } catch (err) {
        nearby = [];
    }

    return nearby.filter(feature => {
        if (!feature || !feature.geometry || feature.geometry.type !== 'Point') return false;
        const coords = feature.geometry.coordinates;
        if (!Array.isArray(coords) || coords.length < 2) return false;

        const p = map.project({ lng: coords[0], lat: coords[1] });
        const dx = p.x - seedPoint.x;
        const dy = p.y - seedPoint.y;
        if ((dx * dx + dy * dy) > (STATION_CLUSTER_RADIUS_PX * STATION_CLUSTER_RADIUS_PX)) return false;

        const candidateNameNormalized = normalizeStationName(getFeatureStationName(feature));
        if (seedNameNormalized) return candidateNameNormalized === seedNameNormalized;
        return true;
    });
}

function onTransitHoverMove(map, event) {
    if (!isActiveModuleInstance()) return;
    if (!map || !event || !event.point || !event.lngLat) return;
    const s = window.RealTransitState;
    const hoverState = s.hover;
    if (!s.overlayOpen) {
        clearHoverState(map, true, true);
        return;
    }
    if (!s.masterVisible) {
        clearHoverState(map, true, true);
        return;
    }
    if (hoverState.pinned) return;

    const hasStations = s.stationsVisible && hasStationsLayer(map);
    const hasLines = hasLinesLayer(map);
    if (!hasStations && !hasLines) {
        clearHoverState(map);
        return;
    }

    let pointFeatures = [];
    try {
        const pointLayers = [];
        if (hasStations) pointLayers.push(LAYER_ID_STATIONS);
        if (hasLines) pointLayers.push(LAYER_ID_LINES);
        pointFeatures = map.queryRenderedFeatures(event.point, { layers: pointLayers }) || [];
    } catch (err) {
        clearHoverState(map);
        return;
    }
    const stationFeatures = pointFeatures.filter(f => f.layer && f.layer.id === LAYER_ID_STATIONS);

    if (stationFeatures.length > 0) {
        const seed = stationFeatures[0];
        const cluster = getStationClusterFeatures(map, event, seed);
        const stationName = getFeatureStationName(seed);
        const stationLinesById = new Map();

        cluster.forEach(feature => {
            const lineId = getFeatureLineId(feature);
            if (!lineId || stationLinesById.has(lineId)) return;
            stationLinesById.set(lineId, {
                lineId,
                routeName: getFeatureRouteName(feature),
                color: getFeatureColor(feature)
            });
        });

        const stationLines = Array.from(stationLinesById.values()).sort((a, b) => naturalSort(a.routeName, b.routeName));
        hoverState.mode = 'station';
        hoverState.lineCandidates = [];
        hoverState.lineIndex = 0;
        hoverState.activeLineId = null;
        renderStationHoverPopup(map, event.lngLat, event.point, stationName || 'Station', stationLines);
        clearHoverHighlight(map);
        return;
    }

    let lineFeatures = [];
    if (hasLines) {
        const minPoint = { x: event.point.x - LINE_CANDIDATE_RADIUS_PX, y: event.point.y - LINE_CANDIDATE_RADIUS_PX };
        const maxPoint = { x: event.point.x + LINE_CANDIDATE_RADIUS_PX, y: event.point.y + LINE_CANDIDATE_RADIUS_PX };
        try {
            lineFeatures = map.queryRenderedFeatures([minPoint, maxPoint], { layers: [LAYER_ID_LINES] }) || [];
        } catch (err) {
            lineFeatures = [];
        }
    }

    if (lineFeatures.length > 0) {
        const lineCandidatesById = new Map();
        lineFeatures.forEach(feature => {
            const lineId = getFeatureLineId(feature);
            if (!lineId || lineCandidatesById.has(lineId)) return;
            lineCandidatesById.set(lineId, {
                lineId,
                routeName: getFeatureRouteName(feature),
                type: getFeatureType(feature),
                network: getFeatureNetwork(feature),
                color: getFeatureColor(feature)
            });
        });

        const candidates = Array.from(lineCandidatesById.values()).sort((a, b) => {
            const byName = naturalSort(a.routeName, b.routeName);
            if (byName !== 0) return byName;
            return naturalSort(a.lineId, b.lineId);
        });
        const previousActiveId = hoverState.activeLineId;
        hoverState.lineCandidates = candidates;
        const existingIdx = previousActiveId ? candidates.findIndex(c => c.lineId === previousActiveId) : -1;
        hoverState.lineIndex = existingIdx >= 0 ? existingIdx : 0;
        renderLineHoverPopup(map, event.lngLat, event.point);
        return;
    }

    clearHoverState(map);
}

function onTransitHoverKeydown(event) {
    if (!isActiveModuleInstance()) return;
    const s = window.RealTransitState;
    const hoverState = window.RealTransitState.hover;
    if (!s.overlayOpen) return;
    if (hoverState && hoverState.pinned && event.key !== 'Tab') {
        const map = hoverState.mapRef || api.utils.getMap();
        clearHoverState(map || null, true, true);
        return;
    }
    if (!hoverState || hoverState.mode !== 'line') return;
    if (event.key !== 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat) return;
    if (!hoverState.lineCandidates || hoverState.lineCandidates.length <= 1) return;

    const map = hoverState.mapRef || api.utils.getMap();
    if (!map) return;
    hoverState.lineIndex = (hoverState.lineIndex + 1) % hoverState.lineCandidates.length;

    if (hoverState.lastLngLat) {
        renderLineHoverPopup(map, hoverState.lastLngLat, hoverState.lastPoint);
    }
}

function onTransitHoverClick(map, event) {
    if (!isActiveModuleInstance()) return;
    const s = window.RealTransitState;
    const hoverState = window.RealTransitState.hover;
    if (!hoverState) return;
    if (!s.overlayOpen) return;

    if (hoverState.pinned) {
        clearHoverState(map, true, true);
        return;
    }

    if (hoverState.mode !== 'line' || !hoverState.lineCandidates || hoverState.lineCandidates.length === 0) return;
    hoverState.pinned = true;
    hoverState.pinActivatedAt = Date.now();
    if (event && event.lngLat) hoverState.lastLngLat = event.lngLat;
    if (event && event.point) hoverState.lastPoint = event.point;

    if (hoverState.lastLngLat) {
        renderLineHoverPopup(map, hoverState.lastLngLat, hoverState.lastPoint);
    }
}

function ensureHoverInteractions(map) {
    const hoverState = window.RealTransitState.hover;
    if (!map || hoverState.handlersBound) return;

    map.on('mousemove', (event) => onTransitHoverMove(map, event));
    map.on('click', (event) => onTransitHoverClick(map, event));
    map.on('mouseout', () => clearHoverState(map));
    if (map.getCanvas && map.getCanvas()) {
        map.getCanvas().addEventListener('mouseleave', () => clearHoverState(map));
    }

    hoverState.keydownHandler = onTransitHoverKeydown;
    window.addEventListener('keydown', hoverState.keydownHandler);
    hoverState.globalPointerHandler = (event) => {
        if (!isActiveModuleInstance()) return;
        const s = window.RealTransitState;
        const hs = s.hover;
        if (!hs.pinned) return;
        if ((Date.now() - hs.pinActivatedAt) < 120) return;
        const activeMap = hs.mapRef || map;
        const target = event && event.target ? event.target : null;
        if (activeMap && target) {
            const canvas = activeMap.getCanvas ? activeMap.getCanvas() : null;
            const canvasContainer = canvas && canvas.parentElement ? canvas.parentElement : null;
            if (canvas && (target === canvas || canvas.contains(target))) return;
            if (canvasContainer && (target === canvasContainer || canvasContainer.contains(target))) return;
        }
        clearHoverState(map, true, true);
    };
    window.addEventListener('pointerdown', hoverState.globalPointerHandler, true);
    hoverState.handlersBound = true;
    hoverState.mapRef = map;
}

function registerOverlayUiComponent() {
    if (window.RealTransitState.uiRegistered) return;
    if (!window.RealTransitOverlayComponent) return;
    api.ui.registerComponent('top-bar', {
        id: 'real-transit-overlay',
        component: window.RealTransitOverlayComponent
    });
    window.RealTransitState.uiRegistered = true;
}

function scheduleDeferredLayerRefresh(delayMs = 300) {
    const s = window.RealTransitState;
    if (s.injectRetryTimer) return;
    s.injectRetryTimer = window.setTimeout(() => {
        s.injectRetryTimer = null;
        const retryMap = api.utils.getMap();
        if (!retryMap) {
            scheduleDeferredLayerRefresh(delayMs);
            return;
        }
        handleStyleDataRefresh(retryMap);
    }, delayMs);
}

function safeLoadArray(key, fallback = []) {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return Array.isArray(fallback) ? [...fallback] : [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : (Array.isArray(fallback) ? [...fallback] : []);
    } catch (err) {
        return Array.isArray(fallback) ? [...fallback] : [];
    }
}

function safeSaveArray(key, value) {
    if (!key) return;
    const arrayValue = Array.isArray(value) ? value : [];
    try {
        localStorage.setItem(key, JSON.stringify(arrayValue));
    } catch (err) { }
}

function saveCityStateArray(s, suffix, value) {
    if (!s || !s.currentCity) return;
    safeSaveArray(`rt_${suffix}_${s.currentCity}`, value);
}

api.hooks.onGameInit(() => {

    const { React, components, icons } = api.utils;
    const { Button, Card, CardContent, Switch, Label } = components;
    const { Layers, ChevronDown, ChevronRight } = icons;
    const h = React.createElement;

    // Component: Custom Button + Persistent Overlay Panel
    const TransitPanel = () => {
        // State to control panel visibility and render updates
        const [isOpen, setIsOpen] = React.useState(false);
        const [trigger, setTriggerRender] = React.useState(0);
        const [expandedGroups, setExpandedGroups] = React.useState({});
        const [panelLayout, setPanelLayout] = React.useState(() => computePanelLayout());

        // Sync with global state events (optional, but good for persistence/other triggers)
        React.useEffect(() => {
            const handler = () => {
                setTriggerRender(prev => prev + 1);
            };
            window.addEventListener('rt_data_loaded', handler);
            return () => window.removeEventListener('rt_data_loaded', handler);
        }, []);

        const toggleOpen = () => {
            const newState = !isOpen;
            setIsOpen(newState);
            window.RealTransitState.overlayOpen = newState;
            if (!newState) {
                const map = api.utils.getMap();
                clearHoverState(map || null, true, true);
            }
        };

        const s = window.RealTransitState;

        React.useEffect(() => {
            if (!isOpen) return;

            let frameToken = null;
            let latePassA = null;
            let latePassB = null;
            let observer = null;

            const applyLayout = () => {
                setPanelLayout((prev) => {
                    const next = computePanelLayout();
                    if (
                        prev.top === next.top
                        && prev.left === next.left
                        && prev.right === next.right
                        && prev.width === next.width
                        && prev.maxHeight === next.maxHeight
                    ) {
                        return prev;
                    }
                    return next;
                });
            };

            const scheduleApplyLayout = () => {
                if (frameToken !== null) return;
                frameToken = window.requestAnimationFrame(() => {
                    frameToken = null;
                    applyLayout();
                });
            };

            applyLayout();
            window.addEventListener('resize', scheduleApplyLayout);
            latePassA = window.setTimeout(scheduleApplyLayout, 120);
            latePassB = window.setTimeout(scheduleApplyLayout, 420);

            const observeRoot = document.body || document.documentElement;
            if (observeRoot && typeof MutationObserver !== 'undefined') {
                observer = new MutationObserver(scheduleApplyLayout);
                observer.observe(observeRoot, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']
                });
            }

            return () => {
                window.removeEventListener('resize', scheduleApplyLayout);
                if (frameToken !== null) window.cancelAnimationFrame(frameToken);
                if (latePassA !== null) window.clearTimeout(latePassA);
                if (latePassB !== null) window.clearTimeout(latePassB);
                if (observer) observer.disconnect();
            };
        }, [isOpen]);

        // Sync global state to local if changed elsewhere (unlikely now, but safe)
        if (s.overlayOpen !== isOpen) s.overlayOpen = isOpen;

        const hierarchy = s.hierarchy || {};
        const typeKeys = Object.keys(hierarchy);

        let allUniqueLines = new Set();
        let activeUniqueLines = new Set();

        for (const type in hierarchy) {
            for (const net in hierarchy[type]) {
                const isTypeActive = s.activeTypes.includes(type);
                const isNetActive = s.activeNetworks.includes(getUniqueNetworkId(type, net));

                hierarchy[type][net].forEach(l => {
                    allUniqueLines.add(`${type}-${net}-${l}`);
                    if (isTypeActive && isNetActive && s.activeLines.includes(l)) {
                        activeUniqueLines.add(`${type}-${net}-${l}`);
                    }
                });
            }
        }

        const totalLines = allUniqueLines.size;
        const activeCount = activeUniqueLines.size;
        const isAllSelected = totalLines > 0 && activeCount === totalLines;
        const displayCount = s.masterVisible ? activeCount : 0;

        const ensureMasterVisible = () => {
            if (!s.masterVisible) {
                s.masterVisible = true;
                localStorage.setItem('rt_master', 'true');
            }
        };

        const toggleMasterAll = () => {
            if (isAllSelected) {
                s.activeTypes = [];
                s.activeNetworks = [];
                s.activeLines = [];
            } else {
                const allTypes = new Set(Object.keys(hierarchy));
                const allNets = new Set();
                const allLines = new Set();

                for (const t in hierarchy) {
                    for (const n in hierarchy[t]) {
                        allNets.add(getUniqueNetworkId(t, n));
                        hierarchy[t][n].forEach(l => allLines.add(l));
                    }
                }

                s.activeTypes = [...allTypes];
                s.activeNetworks = [...allNets];
                s.activeLines = [...allLines];
                ensureMasterVisible();
            }

            saveCityStateArray(s, 'active_types', s.activeTypes);
            saveCityStateArray(s, 'active_nets', s.activeNetworks);
            saveCityStateArray(s, 'active_lines', s.activeLines);

            updateMapFilters();
            setTriggerRender(p => p + 1);
        };

        const toggleMaster = () => {
            s.masterVisible = !s.masterVisible;
            localStorage.setItem('rt_master', s.masterVisible);
            updateMapFilters();
            setTriggerRender(p => p + 1);
        };

        const toggleStations = () => {
            s.stationsVisible = !s.stationsVisible;
            localStorage.setItem('rt_stations', s.stationsVisible);
            updateMapFilters();
            setTriggerRender(p => p + 1);
        };

        const toggleTypeVisibility = (type) => {
            let active = [...s.activeTypes];
            let turningOn = false;

            if (active.includes(type)) {
                active = active.filter(t => t !== type);
            } else {
                active.push(type);
                turningOn = true;
            }

            s.activeTypes = active;
            saveCityStateArray(s, 'active_types', active);

            if (turningOn) ensureMasterVisible();
            updateMapFilters();
            setTriggerRender(p => p + 1);
        };

        const toggleNetworkVisibility = (net, parentType) => {
            const uniqueId = getUniqueNetworkId(parentType, net);
            let active = [...s.activeNetworks];
            let turningOn = false;

            if (active.includes(uniqueId)) {
                active = active.filter(n => n !== uniqueId);
            } else {
                active.push(uniqueId);
                turningOn = true;
            }
            s.activeNetworks = active;
            saveCityStateArray(s, 'active_nets', active);

            if (turningOn) {
                if (!s.activeTypes.includes(parentType)) {
                    s.activeTypes.push(parentType);
                    saveCityStateArray(s, 'active_types', s.activeTypes);
                }
                ensureMasterVisible();
            }

            updateMapFilters();
            setTriggerRender(p => p + 1);
        };

        const toggleLine = (lineId, parentType, parentNet) => {
            let active = [...s.activeLines];
            let turningOn = false;

            if (active.includes(lineId)) {
                active = active.filter(l => l !== lineId);
            } else {
                active.push(lineId);
                turningOn = true;
            }
            s.activeLines = active;
            saveCityStateArray(s, 'active_lines', active);

            if (turningOn) {
                const uniqueNetId = getUniqueNetworkId(parentType, parentNet);
                if (!s.activeNetworks.includes(uniqueNetId)) {
                    s.activeNetworks.push(uniqueNetId);
                    saveCityStateArray(s, 'active_nets', s.activeNetworks);
                }
                if (!s.activeTypes.includes(parentType)) {
                    s.activeTypes.push(parentType);
                    saveCityStateArray(s, 'active_types', s.activeTypes);
                }
                ensureMasterVisible();
            }

            updateMapFilters();
            setTriggerRender(p => p + 1);
        };

        const toggleGroupAllLines = (groupLines, isGroupAllSelected, parentType, parentNet) => {
            const uniqueNetId = getUniqueNetworkId(parentType, parentNet);
            let newActive = [...s.activeLines];
            if (isGroupAllSelected) {
                newActive = newActive.filter(l => !groupLines.includes(l));

                if (s.activeNetworks.includes(uniqueNetId)) {
                    s.activeNetworks = s.activeNetworks.filter(n => n !== uniqueNetId);
                    saveCityStateArray(s, 'active_nets', s.activeNetworks);
                }
            } else {
                groupLines.forEach(l => { if (!newActive.includes(l)) newActive.push(l); });

                if (!s.activeNetworks.includes(uniqueNetId)) {
                    s.activeNetworks.push(uniqueNetId);
                    saveCityStateArray(s, 'active_nets', s.activeNetworks);
                }
                if (!s.activeTypes.includes(parentType)) {
                    s.activeTypes.push(parentType);
                    saveCityStateArray(s, 'active_types', s.activeTypes);
                }
                ensureMasterVisible();
            }
            s.activeLines = newActive;
            saveCityStateArray(s, 'active_lines', s.activeLines);
            updateMapFilters();
            setTriggerRender(p => p + 1);
        };

        const toggleGroupExpand = (key, networksToCollapse = null) => {
            setExpandedGroups(prev => {
                const isCurrentlyExpanded = prev[key];
                const newState = { ...prev, [key]: !isCurrentlyExpanded };

                if (isCurrentlyExpanded && networksToCollapse) {
                    networksToCollapse.forEach(net => {
                        newState[`${key}-${net}`] = false;
                    });
                }
                return newState;
            });
        };

        const typeElements = typeKeys.sort(naturalSort).map(type => {
            const typeNetworks = hierarchy[type];
            const networkKeys = Object.keys(typeNetworks).sort(naturalSort);
            const typeIsVisible = s.activeTypes.includes(type);
            const isTypeExpanded = expandedGroups[type];

            const isSingleNetwork = networkKeys.length === 1;
            const displayName = isSingleNetwork ? networkKeys[0] : type;

            const typeHeader = h('div', {
                className: 'flex items-center justify-between py-2 border-b border-gray-500/20',
                key: `${type}-header`
            }, [
                h('div', {
                    className: `flex items-center gap-2 cursor-pointer transition-opacity ${isTypeExpanded ? 'opacity-100' : 'opacity-60'}`,
                    onClick: () => toggleGroupExpand(type, networkKeys)
                }, [
                    h(isTypeExpanded ? ChevronDown : ChevronRight, { size: 16 }),
                    h(Label, { className: 'font-bold cursor-pointer text-sm' }, displayName)
                ]),
                h(Switch, { checked: typeIsVisible, onCheckedChange: () => toggleTypeVisibility(type) })
            ]);

            let typeChildren = null;
            if (isTypeExpanded) {
                if (isSingleNetwork) {
                    const net = networkKeys[0];
                    const groupLines = typeNetworks[net];
                    const netIsVisible = s.activeNetworks.includes(getUniqueNetworkId(type, net));
                    const allActiveInGroup = typeIsVisible && netIsVisible && groupLines.every(l => s.activeLines.includes(l));

                    // Single Network Case: Lines are direct children
                    typeChildren = h('div', { className: 'ml-4 pl-2 border-l border-gray-500/10 flex flex-col gap-1 py-1 mb-2', key: `${type}-flat-children` }, [
                        h('div', { className: 'flex gap-2 pb-1 border-b border-gray-500/15' }, [
                            h(Button, {
                                variant: 'ghost', size: 'sm', className: 'h-5 px-2 text-[10px]',
                                onClick: () => toggleGroupAllLines(groupLines, allActiveInGroup, type, net)
                            }, allActiveInGroup ? "Deselect All" : "Select All")
                        ]),
                        ...groupLines.map(lineId => {
                            const isActive = s.activeLines.includes(lineId);
                            const displayName = s.lineNames?.[lineId] || lineId;
                            return h('div', { className: 'flex items-center justify-between py-0.5', key: lineId }, [
                                h(Label, { className: 'text-xs cursor-pointer', onClick: () => toggleLine(lineId, type, net) }, displayName),
                                h(Switch, { checked: isActive, onCheckedChange: () => toggleLine(lineId, type, net) })
                            ]);
                        })
                    ]);
                } else {
                    // Multi-Network Case: Networks are children
                    typeChildren = h('div', { className: 'ml-2 mt-1 mb-2 flex flex-col', key: `${type}-grouped-children` },
                        networkKeys.map(net => {
                            const groupLines = typeNetworks[net];
                            const isNetExpanded = expandedGroups[`${type}-${net}`];

                            const netIsVisible = s.activeNetworks.includes(getUniqueNetworkId(type, net));
                            const allActiveInGroup = typeIsVisible && netIsVisible && groupLines.every(l => s.activeLines.includes(l));

                            const netHeader = h('div', {
                                className: 'flex items-center justify-between py-1.5 border-b border-gray-500/15 ml-2',
                                key: `${net}-header`
                            }, [
                                h('div', {
                                    className: `flex items-center gap-2 cursor-pointer transition-opacity ${isNetExpanded ? 'opacity-100' : 'opacity-60'}`,
                                    onClick: () => toggleGroupExpand(`${type}-${net}`)
                                }, [
                                    h(isNetExpanded ? ChevronDown : ChevronRight, { size: 14 }),
                                    h(Label, { className: 'font-semibold cursor-pointer text-xs' }, net)
                                ]),
                                h(Switch, { checked: netIsVisible, onCheckedChange: () => toggleNetworkVisibility(net, type) })
                            ]);

                            let netChildren = null;
                            if (isNetExpanded) {
                                // Nested Lines Indentation
                                netChildren =
                                    h('div', {
                                        className: 'pl-2 border-l border-gray-500/10 flex flex-col gap-1 py-1',
                                        style: { marginLeft: '20px' },
                                        key: `${net}-children`
                                    }, [
                                        h('div', { className: 'flex gap-2 pb-1' }, [
                                            h(Button, {
                                                variant: 'ghost', size: 'sm', className: 'h-5 px-2 text-[10px]',
                                                onClick: () => toggleGroupAllLines(groupLines, allActiveInGroup, type, net)
                                            }, allActiveInGroup ? "Deselect All" : "Select All")
                                        ]),
                                        ...groupLines.map(lineId => {
                                            const isActive = s.activeLines.includes(lineId);
                                            const displayName = s.lineNames?.[lineId] || lineId;
                                            return h('div', { className: 'flex items-center justify-between py-0.5', key: lineId }, [
                                                h(Label, { className: 'text-xs cursor-pointer', onClick: () => toggleLine(lineId, type, net) }, displayName),
                                                h(Switch, { checked: isActive, onCheckedChange: () => toggleLine(lineId, type, net) })
                                            ]);
                                        })
                                    ]);
                            }
                            return h('div', { key: net }, [netHeader, netChildren]);
                        })
                    );
                }
            }
            return h('div', { key: type, className: 'flex flex-col' }, [typeHeader, typeChildren]);
        });

        // Main Panel Component
        const panel = isOpen ? h(Card, {
            style: {
                top: `${panelLayout.top}px`,
                left: panelLayout.left !== null ? `${panelLayout.left}px` : 'auto',
                right: panelLayout.right !== null ? `${panelLayout.right}px` : 'auto',
                width: `${panelLayout.width}px`,
                maxHeight: `${panelLayout.maxHeight}px`,
                display: 'flex',
                flexDirection: 'column'
            },
            className: 'fixed z-[2500] pointer-events-auto bg-primary-foreground/80 backdrop-blur-sm border border-border/50 rounded-lg shadow-lg overflow-hidden',
        }, [
            // 1. Fixed Header Section (Toggles)
            h('div', { className: 'p-3 border-b border-gray-500/20 flex-none bg-inherit' }, [
                h('div', { className: 'flex flex-col gap-2' }, [
                    h('div', { className: 'flex items-center justify-between' }, [
                        h(Label, { className: 'font-bold' }, "Show Overlay"),
                        h(Switch, { checked: s.masterVisible, onCheckedChange: toggleMaster })
                    ]),
                    h('div', { className: 'flex items-center justify-between' }, [
                        h(Label, { className: 'font-bold' }, "Show Stations"),
                        h(Switch, { checked: s.stationsVisible, onCheckedChange: toggleStations })
                    ])
                ])
            ]),
            // 2. Scrollable List Section
            h('div', { className: 'flex-1 overflow-y-auto min-h-0 p-2' }, [
                h('div', { className: 'flex flex-col gap-1' }, [
                    h('div', { className: 'flex items-center justify-between mb-2 mt-1 px-1' }, [
                        h('div', null, [
                            h(Label, { className: 'text-xs uppercase tracking-wider opacity-70 block' }, "Transit Networks"),
                            h('div', { className: 'text-[10px] opacity-50 mt-0.5' }, `Showing ${displayCount} of ${totalLines} lines`)
                        ]),
                        totalLines > 0 ? h(Button, {
                            variant: 'ghost', size: 'sm', className: 'h-6 px-2 text-xs',
                            onClick: toggleMasterAll
                        }, isAllSelected ? "Deselect All" : "Select All") : null
                    ]),
                    totalLines > 0 ? typeElements : h('div', { className: 'text-xs opacity-70 px-1' }, "No lines found in data.")
                ])
            ])
        ]) : null;

        return h('div', { className: 'relative' }, [
            h('div', {
                key: 'btn',
                onClick: toggleOpen,
                title: 'Open transit panel',
                // Toggle Button
                className: `h-10 w-10 flex items-center justify-center rounded-md cursor-pointer transition-all shadow-sm backdrop-blur-sm border border-primary/10 pointer-events-auto ${isOpen ? 'bg-primary text-primary-foreground' : 'bg-primary-foreground/70 text-primary/70 hover:text-primary hover:bg-primary-foreground/90'}`
            }, [
                h(Layers, { className: "w-5 h-5 stroke-[1.5]" })
            ]),
            panel
        ]);
    };

    // Register component using the custom pattern
    window.RealTransitOverlayComponent = TransitPanel;
    registerOverlayUiComponent();
    console.info('[Transit Overlay] Mod initialized.');
});

api.hooks.onCityLoad((cityCode) => {
    window.RealTransitState.currentCity = cityCode;
    const map = api.utils.getMap();
    clearHoverState(map || null, true, true);
    updateCityData(map || null, cityCode);
});

api.hooks.onMapReady((map) => {
    registerOverlayUiComponent();
    ensureHoverInteractions(map);
    map.on('styledata', () => handleStyleDataRefresh(map));
    handleStyleDataRefresh(map);
    const s = window.RealTransitState;
    const fallbackCity = s.currentCity || getCurrentCityCode();
    if (fallbackCity && !s.cache[fallbackCity]) {
        updateCityData(map, fallbackCity);
    }
});

api.hooks.onGameEnd(() => {
    const s = window.RealTransitState;
    s.uiRegistered = false;
    if (s.hover && s.hover.keydownHandler) {
        window.removeEventListener('keydown', s.hover.keydownHandler);
        s.hover.keydownHandler = null;
    }
    if (s.hover && s.hover.globalPointerHandler) {
        window.removeEventListener('pointerdown', s.hover.globalPointerHandler, true);
        s.hover.globalPointerHandler = null;
    }
    if (s.hover) {
        s.hover.handlersBound = false;
        s.hover.mapRef = null;
        if (s.hover.popup) s.hover.popup.remove();
        s.hover.popup = null;
    }
});

function safelyMoveLayer(map, layerId, beforeLayerId = null) {
    if (!map || !map.getLayer || !map.moveLayer || !map.getLayer(layerId)) return;
    if (beforeLayerId && map.getLayer(beforeLayerId)) {
        map.moveLayer(layerId, beforeLayerId);
        return;
    }
    map.moveLayer(layerId);
}

function ensureTransitLayerOrder(map) {
    if (!map) return;
    safelyMoveLayer(map, LAYER_ID_LINES, 'road-label');
    safelyMoveLayer(map, LAYER_ID_LINES_HOVER, 'road-label');
    safelyMoveLayer(map, LAYER_ID_STATIONS, 'road-label');
}

function handleStyleDataRefresh(map) {
    try {
        const s = window.RealTransitState;
        const currentCity = s.currentCity || getCurrentCityCode();
        if (!currentCity) return;
        s.currentCity = currentCity;
        const cachedCityData = s.cache[currentCity];
        if (!cachedCityData) {
            updateCityData(map, currentCity);
            return;
        }

        if (!hasTransitSource(map)) {
            if (!injectLayers(map, cachedCityData)) scheduleDeferredLayerRefresh();
        } else {
            ensureTransitLayerOrder(map);
            if (canApplyFilters(map)) {
                updateMapFilters(map);
                const activeLineId = window.RealTransitState.hover.activeLineId;
                applyHoverHighlight(map, activeLineId);
            }
        }
    } catch (err) { }
}

function hydrateCityStateFromGeoJson(cityCode, geojsonData) {
    const rawHierarchy = {};
    const linesSet = new Set();
    const typesSet = new Set();
    const networksSet = new Set();
    const lineNameMap = {};

    geojsonData.features.forEach(f => {
        const p = f.properties || {};
        const displayName = String(p.route_name || 'Unnamed Line');
        const type = p.type || "Other";
        const network = p.network || "Unknown";
        const geometryType = f.geometry && f.geometry.type ? f.geometry.type : '';

        const uniqueId = `${type}__${network}__${displayName}`;

        p._mod_line_id = uniqueId;
        f.properties = p;
        lineNameMap[uniqueId] = displayName;

        if (geometryType.includes('LineString') || p.is_station) {
            linesSet.add(uniqueId);
            typesSet.add(type);
            networksSet.add(getUniqueNetworkId(type, network));
            if (!rawHierarchy[type]) rawHierarchy[type] = {};
            if (!rawHierarchy[type][network]) rawHierarchy[type][network] = new Set();
            rawHierarchy[type][network].add(uniqueId);
        }
    });

    const formattedHierarchy = {};
    for (let t in rawHierarchy) {
        formattedHierarchy[t] = {};
        for (let n in rawHierarchy[t]) {
            formattedHierarchy[t][n] = Array.from(rawHierarchy[t][n]).sort(naturalSort);
        }
    }

    const validLines = Array.from(linesSet);
    const validTypes = Array.from(typesSet);
    const validNets = Array.from(networksSet);

    const loadedLines = safeLoadArray(`rt_active_lines_${cityCode}`, validLines);
    const loadedTypes = safeLoadArray(`rt_active_types_${cityCode}`, validTypes);
    const loadedNets = safeLoadArray(`rt_active_nets_${cityCode}`, validNets);

    const healedLines = loadedLines.filter(line => linesSet.has(line));
    const healedTypes = loadedTypes.filter(type => typesSet.has(type));
    const healedNets = loadedNets.filter(net => networksSet.has(net));

    const s = window.RealTransitState;
    s.currentCity = cityCode;
    s.lineNames = lineNameMap;
    s.hierarchy = formattedHierarchy;
    s.activeLines = healedLines.length > 0 ? healedLines : validLines;
    s.activeTypes = healedTypes.length > 0 ? healedTypes : validTypes;
    s.activeNetworks = healedNets.length > 0 ? healedNets : validNets;

    saveCityStateArray(s, 'active_lines', s.activeLines);
    saveCityStateArray(s, 'active_types', s.activeTypes);
    saveCityStateArray(s, 'active_nets', s.activeNetworks);
}

function applyNoDataCityState(cityCode, map = null) {
    const s = window.RealTransitState;
    s.currentCity = cityCode;
    s.hierarchy = {};
    s.lineNames = {};
    s.activeLines = [];
    s.activeTypes = [];
    s.activeNetworks = [];
    window.dispatchEvent(new CustomEvent('rt_data_loaded'));

    const resolvedMap = map || api.utils.getMap();
    if (!resolvedMap || !resolvedMap.getSource) return;

    const source = safeGetSource(resolvedMap, SOURCE_ID);
    if (source && source.setData) {
        source.setData({ type: 'FeatureCollection', features: [] });
    }

    updateMapFilters(resolvedMap);
}

async function updateCityData(map, manualCityCode = null) {
    const s = window.RealTransitState;
    const cityCode = manualCityCode || window.RealTransitState.currentCity || getCurrentCityCode();
    const getResolvedMap = () => map || api.utils.getMap();

    if (!cityCode) {
        console.warn('[Transit Overlay] No city code resolved; skipping transit data load.');
        return;
    }

    if (s.inFlightLoads.has(cityCode)) return;
    if (s.missingDataCities.has(cityCode) && !s.cache[cityCode]) {
        applyNoDataCityState(cityCode, getResolvedMap());
        return;
    }

    const requestId = ++s.loadRequestSeq;
    const isStaleRequest = () => {
        const latestCity = window.RealTransitState.currentCity;
        return requestId !== window.RealTransitState.loadRequestSeq || (!!latestCity && latestCity !== cityCode);
    };
    if (isStaleRequest()) return;

    const cached = s.cache[cityCode];
    if (cached) {
        if (isStaleRequest()) return;
        hydrateCityStateFromGeoJson(cityCode, cached);
        window.dispatchEvent(new CustomEvent('rt_data_loaded'));
        const resolvedMap = getResolvedMap();
        if (resolvedMap) {
            if (!injectLayers(resolvedMap, cached)) scheduleDeferredLayerRefresh();
        } else {
            scheduleDeferredLayerRefresh();
        }
        if (
            manualCityCode &&
            !isStaleRequest() &&
            window.RealTransitState.currentCity === cityCode
        ) {
            console.info(`[Transit Overlay] Loaded transit data for ${cityCode} from cache.`);
        }
        return;
    }

    s.inFlightLoads.add(cityCode);
    try {
        let modsDir = await window.electron.getModsFolder();
        const localFileUrl = `file:///${modsDir.replaceAll('\\', '/')}/Transit Overlay/data/${cityCode.toLowerCase()}.geojson`;
        const response = await fetch(localFileUrl);

        if (response.ok) {
            if (isStaleRequest()) return;
            let geojsonData = await response.json();
            if (isStaleRequest()) return;
            hydrateCityStateFromGeoJson(cityCode, geojsonData);
            s.cache[cityCode] = geojsonData;
            s.missingDataCities.delete(cityCode);
            s.missingDataLoggedCities.delete(cityCode);
            window.dispatchEvent(new CustomEvent('rt_data_loaded'));
            const resolvedMap = getResolvedMap();
            if (resolvedMap) {
                if (!injectLayers(resolvedMap, geojsonData)) scheduleDeferredLayerRefresh();
            } else {
                scheduleDeferredLayerRefresh();
            }
            console.info(`[Transit Overlay] Loaded transit data for ${cityCode} from file.`);
        } else {
            if (isStaleRequest()) return;
            s.missingDataCities.add(cityCode);
            if (!s.missingDataLoggedCities.has(cityCode)) {
                console.warn(`[Transit Overlay] No local transit data for ${cityCode} (HTTP ${response.status} ${response.statusText}).`);
                s.missingDataLoggedCities.add(cityCode);
            }
            applyNoDataCityState(cityCode, getResolvedMap());
        }
    } catch (e) {
        if (isStaleRequest()) return;
        const isMissingData = e && String(e.message || e).includes('Failed to fetch');
        if (isMissingData) {
            s.missingDataCities.add(cityCode);
            if (!s.missingDataLoggedCities.has(cityCode)) {
                console.warn(`[Transit Overlay] No local transit data for ${cityCode} (file missing or unsupported city).`);
                s.missingDataLoggedCities.add(cityCode);
            }
            applyNoDataCityState(cityCode, getResolvedMap());
        } else {
            console.error(`[Transit Overlay] Failed to load local data for ${cityCode}:`, e);
        }
    } finally {
        s.inFlightLoads.delete(cityCode);
    }
}

function injectLayers(map, geojsonData) {
    if (!isMapStyleReady(map)) {
        scheduleDeferredLayerRefresh();
        return false;
    }

    if (!hasTransitSource(map)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: geojsonData });
    } else {
        const source = safeGetSource(map, SOURCE_ID);
        if (!source || !source.setData) {
            scheduleDeferredLayerRefresh();
            return false;
        }
        source.setData(geojsonData);
    }

    if (!hasLinesLayer(map)) {
        map.addLayer({
            id: LAYER_ID_LINES,
            type: 'line',
            source: SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: { 'line-color': ['coalesce', ['get', 'colour'], ['get', 'color'], '#a855f7'], 'line-width': 3.5, 'line-opacity': 0.8 }
        });
    }

    if (!hasLinesHoverLayer(map)) {
        map.addLayer({
            id: LAYER_ID_LINES_HOVER,
            type: 'line',
            source: SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            filter: ['==', ['get', '_mod_line_id'], '__NONE__'],
            paint: {
                'line-color': ['coalesce', ['get', 'colour'], ['get', 'color'], '#ffffff'],
                'line-width': 7,
                'line-opacity': 0.95
            }
        });
    }

    if (!hasStationsLayer(map)) {
        map.addLayer({
            id: LAYER_ID_STATIONS,
            type: 'circle',
            source: SOURCE_ID,
            paint: { 'circle-color': ['coalesce', ['get', 'colour'], ['get', 'color'], '#ffffff'], 'circle-radius': 4.5, 'circle-stroke-width': 2, 'circle-stroke-color': ['coalesce', ['get', 'colour'], ['get', 'color'], '#a855f7'] }
        });
    }

    ensureTransitLayerOrder(map);
    updateMapFilters(map);
    applyHoverHighlight(map, window.RealTransitState.hover.activeLineId);
    return true;
}

function updateMapFilters(targetMap = null) {
    const map = targetMap || api.utils.getMap();
    if (!map || !canApplyFilters(map)) return;

    const s = window.RealTransitState;

    if (!s.masterVisible) {
        map.setLayoutProperty(LAYER_ID_LINES, 'visibility', 'none');
        if (hasLinesHoverLayer(map)) map.setLayoutProperty(LAYER_ID_LINES_HOVER, 'visibility', 'none');
        if (hasStationsLayer(map)) map.setLayoutProperty(LAYER_ID_STATIONS, 'visibility', 'none');
        clearHoverState(map, true, true);
        return;
    }

    let effectiveActiveLines = [];
    if (s.activeTypes && s.activeNetworks && s.hierarchy) {
        for (const type in s.hierarchy) {
            if (s.activeTypes.includes(type)) {
                for (const net in s.hierarchy[type]) {
                    if (s.activeNetworks.includes(getUniqueNetworkId(type, net))) {
                        const lines = s.hierarchy[type][net];
                        effectiveActiveLines.push(...lines.filter(l => s.activeLines.includes(l)));
                    }
                }
            }
        }
    }

    if (effectiveActiveLines.length === 0) effectiveActiveLines = ['__NONE__'];

    map.setLayoutProperty(LAYER_ID_LINES, 'visibility', 'visible');
    map.setFilter(LAYER_ID_LINES, [
        'all',
        ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
        ['match', ['get', '_mod_line_id'], effectiveActiveLines, true, false]
    ]);
    if (hasLinesHoverLayer(map)) {
        map.setLayoutProperty(LAYER_ID_LINES_HOVER, 'visibility', 'visible');
    }

    if (s.stationsVisible && hasStationsLayer(map)) {
        map.setLayoutProperty(LAYER_ID_STATIONS, 'visibility', 'visible');
        map.setFilter(LAYER_ID_STATIONS, [
            'all',
            ['==', ['geometry-type'], 'Point'],
            ['match', ['get', '_mod_line_id'], effectiveActiveLines, true, false]
        ]);
    } else if (hasStationsLayer(map)) {
        map.setLayoutProperty(LAYER_ID_STATIONS, 'visibility', 'none');
    }

    const hoverState = s.hover;
    if (hoverState.mode === 'line' && hoverState.activeLineId) {
        applyHoverHighlight(map, hoverState.activeLineId);
    } else {
        clearHoverHighlight(map);
    }
}

function getCurrentCityCode() {
    const map = api.utils.getMap();
    if (!map) return null;
    const center = map.getCenter();
    const cities = api.utils.getCities();
    const closest = cities.find(c => {
        const dx = c.initialViewState.longitude - center.lng;
        const dy = c.initialViewState.latitude - center.lat;
        return (dx * dx + dy * dy) < 4.0;
    });
    return closest ? closest.code : null;
}


