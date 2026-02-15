const api = window.SubwayBuilderAPI;

// ----------------------------------------------------
// 1. MOD LOGIC & STATE
// ----------------------------------------------------

const LAYER_ID_LINES = 'real-transit-lines';
const LAYER_ID_STATIONS = 'real-transit-stations';
const SOURCE_ID = 'real-transit-source';

// Your GitHub repository raw data link
const BASE_URL = "https://raw.githubusercontent.com/BarKuperman/transit-overlay-subway-builder-mod/main/data";

// Global state
window.RealLinesState = {
    visible: false, 
    cache: {} 
};

// ----------------------------------------------------
// 2. LIFECYCLE HOOKS & UI
// ----------------------------------------------------

api.hooks.onGameInit(() => {
    api.ui.showNotification("✅ Mod Loaded (Dynamic GitHub Fetching)", "success");

    api.storage.get('visible', false).then(savedVis => {
        window.RealLinesState.visible = savedVis;
    });

    const { React, components, icons } = api.utils;
    const { Button } = components;
    const { Map } = icons;
    const h = React.createElement;

    api.ui.registerComponent('bottom-bar', {
        id: 'real-lines-toggle-btn',
        component: () => {
            const [isOn, setIsOn] = React.useState(window.RealLinesState.visible);
            
            React.useEffect(() => {
                setIsOn(window.RealLinesState.visible);
            }, []);

            return h(Button, {
                variant: isOn ? 'default' : 'secondary', 
                size: 'sm',
                className: 'gap-2',
                onClick: () => {
                    const newState = !isOn;
                    setIsOn(newState);
                    window.RealLinesState.visible = newState;
                    api.storage.set('visible', newState);
                    updateLayerVisibility();
                }
            }, [ h(Map, { size: 16 }), "Real Lines" ]);
        }
    });
});

api.hooks.onMapReady((map) => {
    updateCityData(map);

    // Watch for Construction View map wipe
    map.on('styledata', () => {
        if (!map.getLayer(LAYER_ID_LINES) && window.RealLinesState.cache[getCurrentCityCode()]) {
            injectLayers(map, window.RealLinesState.cache[getCurrentCityCode()]);
        }
    });
});

api.hooks.onCityLoad((cityCode) => {
    const map = api.utils.getMap();
    if (map) updateCityData(map, cityCode);
});

// ----------------------------------------------------
// 3. DATA FETCHING & CACHING
// ----------------------------------------------------

async function updateCityData(map, manualCityCode = null) {
    const cityCode = manualCityCode || getCurrentCityCode();
    if (!cityCode) return;

    // 1. Check in-memory cache first (instant load)
    if (window.RealLinesState.cache[cityCode]) {
        injectLayers(map, window.RealLinesState.cache[cityCode]);
        return;
    }

    try {
        // 2. Get the player's local mods folder path
        let modsDir = await window.electron.getModsFolder();
        
        // Format the path so the browser can read it as a URL
        modsDir = modsDir.replaceAll('\\', '/');
        
        // 3. Construct the exact path to your mod's data folder
        // IMPORTANT: Make sure "real-transit-overlay" exactly matches the name of your mod's folder!
        const fileName = `${cityCode.toLowerCase()}.geojson`;
        const localFileUrl = `file:///${modsDir}/Transit Overlay_0.1/data/${fileName}`;
        
        // 4. Fetch the file directly from the hard drive
        const response = await fetch(localFileUrl);
        
        if (response.ok) {
            const geojsonData = await response.json();
            
            // Cache it in memory for this session
            window.RealLinesState.cache[cityCode] = geojsonData;
            
            injectLayers(map, geojsonData);
            console.log(`[RealLines] Successfully loaded local data for ${cityCode}`);
        } else {
            console.warn(`[RealLines] No local transit data found at: ${localFileUrl}`);
        }
    } catch (e) {
        // If the file:// fetch gets blocked by strict Electron security, 
        // it will throw an error here.
        console.error(`[RealLines] Failed to load local data for ${cityCode}:`, e);
    }
}

// ----------------------------------------------------
// 4. MAP LAYER INJECTION
// ----------------------------------------------------

function injectLayers(map, geojsonData) {
    // 1. Add or update the shared Data Source
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: geojsonData });
    } else {
        map.getSource(SOURCE_ID).setData(geojsonData);
    }

    // 2. Add the TRACKS (Lines) Layer
    if (!map.getLayer(LAYER_ID_LINES)) {
        map.addLayer({
            id: LAYER_ID_LINES,
            type: 'line',
            source: SOURCE_ID,
            filter: ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
            layout: {
                'line-join': 'round',
                'line-cap': 'round',
                'visibility': window.RealLinesState.visible ? 'visible' : 'none'
            },
            paint: {
                'line-color': ['coalesce', ['get', 'colour'], ['get', 'color'], '#a855f7'],
                'line-width': 3.5,
                'line-opacity': 0.8
            }
        });
        if (map.getLayer('road-label')) map.moveLayer(LAYER_ID_LINES, 'road-label');
    } else {
        map.setLayoutProperty(LAYER_ID_LINES, 'visibility', window.RealLinesState.visible ? 'visible' : 'none');
    }

    // 3. Add the STATIONS (Points) Layer
    if (!map.getLayer(LAYER_ID_STATIONS)) {
        map.addLayer({
            id: LAYER_ID_STATIONS,
            type: 'circle',
            source: SOURCE_ID,
            filter: ['==', ['geometry-type'], 'Point'],
            layout: {
                'visibility': window.RealLinesState.visible ? 'visible' : 'none'
            },
            paint: {
                'circle-color': ['coalesce', ['get', 'colour'], ['get', 'color'], '#ffffff'],
                'circle-radius': 4.5,
                'circle-stroke-width': 2,
                'circle-stroke-color': ['coalesce', ['get', 'colour'], ['get', 'color'], '#a855f7']
            }
        });
        if (map.getLayer('road-label')) map.moveLayer(LAYER_ID_STATIONS, 'road-label');
    } else {
        map.setLayoutProperty(LAYER_ID_STATIONS, 'visibility', window.RealLinesState.visible ? 'visible' : 'none');
    }
}

function updateLayerVisibility() {
    const map = api.utils.getMap();
    if (!map) return;
    
    if (map.getLayer(LAYER_ID_LINES)) {
        map.setLayoutProperty(LAYER_ID_LINES, 'visibility', window.RealLinesState.visible ? 'visible' : 'none');
    }
    if (map.getLayer(LAYER_ID_STATIONS)) {
        map.setLayoutProperty(LAYER_ID_STATIONS, 'visibility', window.RealLinesState.visible ? 'visible' : 'none');
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
        return (dx*dx + dy*dy) < 4.0; 
    });
    return closest ? closest.code : null;
}