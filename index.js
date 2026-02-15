const api = window.SubwayBuilderAPI;

// ----------------------------------------------------
// 1. MOD LOGIC & STATE
// ----------------------------------------------------

const LAYER_ID_LINES = 'real-transit-lines';
const LAYER_ID_STATIONS = 'real-transit-stations';
const SOURCE_ID = 'real-transit-source';

window.RealTransitState = {
    masterVisible: localStorage.getItem('rt_master') === 'true',
    stationsVisible: localStorage.getItem('rt_stations') === 'true',
    activeLines: [],      
    availableLines: [],   
    currentCity: null,
    cache: {} 
};

// ----------------------------------------------------
// 2. LIFECYCLE HOOKS & UI MENU
// ----------------------------------------------------

api.hooks.onGameInit(() => {
    api.ui.showNotification("✅ Real Transit Menu Loaded", "success");

    const { React, components, icons } = api.utils;
    const { Button, Card, CardContent, Switch, Label } = components;
    const { Map, ChevronUp, ChevronDown } = icons; 
    const h = React.createElement;

    api.ui.registerComponent('bottom-bar', {
        id: 'real-transit-menu',
        component: () => {
            const [isOpen, setIsOpen] = React.useState(false);
            const [trigger, setTriggerRender] = React.useState(0);

            React.useEffect(() => {
                const handler = () => setTriggerRender(prev => prev + 1);
                window.addEventListener('rt_data_loaded', handler);
                return () => window.removeEventListener('rt_data_loaded', handler);
            }, []);

            const s = window.RealTransitState;
            const lines = s.availableLines || [];
            const allSelected = lines.length > 0 && s.activeLines.length === lines.length;

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

            const toggleLine = (lineId) => {
                let active = [...s.activeLines];
                if (active.includes(lineId)) active = active.filter(l => l !== lineId);
                else active.push(lineId);
                
                s.activeLines = active;
                localStorage.setItem(`rt_active_${s.currentCity}`, JSON.stringify(active));
                updateMapFilters();
                setTriggerRender(p => p + 1);
            };

            const toggleAllLines = () => {
                if (allSelected) {
                    s.activeLines = []; // Deselect all
                } else {
                    s.activeLines = [...lines]; // Select all
                }
                localStorage.setItem(`rt_active_${s.currentCity}`, JSON.stringify(s.activeLines));
                updateMapFilters();
                setTriggerRender(p => p + 1);
            };

            let panel = null;
            if (isOpen) {
                const lineToggles = lines.map(lineId => {
                    const isActive = s.activeLines.includes(lineId);
                    return h('div', { className: 'flex items-center justify-between py-1', key: lineId }, [
                        h(Label, { className: 'text-xs cursor-pointer', onClick: () => toggleLine(lineId) }, lineId),
                        h(Switch, { checked: isActive, onCheckedChange: () => toggleLine(lineId) })
                    ]);
                });

                panel = h(Card, { 
                    className: 'fixed bottom-16 right-4 w-64 shadow-2xl z-50 border-border bg-card',
                }, [
                    h(CardContent, { className: 'p-4 flex flex-col gap-3', style: { maxHeight: '60vh', overflowY: 'auto' } }, [
                        h('div', { className: 'flex flex-col gap-2 pb-3 border-b border-border' }, [
                            h('div', { className: 'flex items-center justify-between' }, [
                                h(Label, { className: 'font-bold' }, "Show Overlay"),
                                h(Switch, { checked: s.masterVisible, onCheckedChange: toggleMaster })
                            ]),
                            h('div', { className: 'flex items-center justify-between' }, [
                                h(Label, { className: 'font-bold' }, "Show Stations"), // Text restored!
                                h(Switch, { checked: s.stationsVisible, onCheckedChange: toggleStations })
                            ])
                        ]),
                        h('div', { className: 'flex flex-col gap-1' }, [
                            h('div', { className: 'flex items-center justify-between mb-2' }, [
                                h(Label, { className: 'text-muted-foreground text-xs uppercase tracking-wider' }, "Individual Lines"),
                                lines.length > 0 ? h(Button, { 
                                    variant: 'ghost', 
                                    size: 'sm', 
                                    className: 'h-6 px-2 text-xs',
                                    onClick: toggleAllLines
                                }, allSelected ? "Deselect All" : "Select All") : null
                            ]),
                            lines.length > 0 
                                ? lineToggles 
                                : h('div', { className: 'text-xs text-muted-foreground' }, "No lines found in data.")
                        ])
                    ])
                ]);
            }

            return h('div', { className: 'relative' }, [
                panel,
                h(Button, {
                    variant: s.masterVisible ? 'default' : 'secondary', 
                    size: 'sm',
                    className: 'gap-2',
                    onClick: () => setIsOpen(!isOpen)
                }, [ 
                    h(Map, { size: 16 }), 
                    "Transit Overlay",
                    isOpen ? h(ChevronDown, { size: 14 }) : h(ChevronUp, { size: 14 })
                ])
            ]);
        }
    });
});

api.hooks.onMapReady((map) => {
    updateCityData(map);

    map.on('styledata', () => {
        try {
            const s = window.RealTransitState;
            const currentCity = getCurrentCityCode();
            
            // If the style changed and wiped our source, re-inject it
            if (!map.getSource(SOURCE_ID) && s.cache[currentCity]) {
                injectLayers(map, s.cache[currentCity]);
            }

            // FORCE RE-ORDER: Move your layers to the top of the new style
            if (map.getLayer(LAYER_ID_LINES)) {
                map.moveLayer(LAYER_ID_LINES); // Moving with no second argument puts it on top
            }
            if (map.getLayer(LAYER_ID_STATIONS)) {
                map.moveLayer(LAYER_ID_STATIONS);
            }
        } catch (err) {
            console.warn("[RealLines] Map ordering failed, but we caught it to prevent black screen:", err);
        }
    });
});

api.hooks.onCityLoad((cityCode) => {
    const map = api.utils.getMap();
    if (map) updateCityData(map, cityCode);
});



// ----------------------------------------------------
// 3. DATA FETCHING & SMART PROCESSING
// ----------------------------------------------------

async function updateCityData(map, manualCityCode = null) {
    const cityCode = manualCityCode || getCurrentCityCode();
    if (!cityCode) return;

    if (window.RealTransitState.cache[cityCode]) {
        injectLayers(map, window.RealTransitState.cache[cityCode]);
        return;
    }

    try {
        let modsDir = await window.electron.getModsFolder();
        modsDir = modsDir.replaceAll('\\', '/'); 
        
        const fileName = `${cityCode.toLowerCase()}.geojson`;
        const localFileUrl = `file:///${modsDir}/Transit Overlay/data/${fileName}`;
        
        const response = await fetch(localFileUrl);
        
        if (response.ok) {
            let geojsonData = await response.json();
            const linesSet = new Set();

            // Simplified Processor: Because your Node script perfectly tags everything 
            // with 'route_name', we can just use that directly!
            geojsonData.features.forEach(f => {
                const p = f.properties;
                const lineId = String(p.route_name || p.line || p.ref || p.route_id || p.name || 'Unnamed Line');
                p._mod_line_id = lineId; 
                
                // Only add it to the menu list if it's a track line (not an orphan point)
                if (f.geometry.type.includes('LineString') || p.is_station) {
                    linesSet.add(lineId);
                }
            });

            const linesArr = Array.from(linesSet).sort();
            window.RealTransitState.availableLines = linesArr;
            window.RealTransitState.currentCity = cityCode;

            const savedActive = localStorage.getItem(`rt_active_${cityCode}`);
            if (savedActive) {
                window.RealTransitState.activeLines = JSON.parse(savedActive);
            } else {
                window.RealTransitState.activeLines = [...linesArr];
                localStorage.setItem(`rt_active_${cityCode}`, JSON.stringify(linesArr));
            }

            window.RealTransitState.cache[cityCode] = geojsonData;
            window.dispatchEvent(new CustomEvent('rt_data_loaded'));
            
            injectLayers(map, geojsonData);
        } else {
            console.warn(`[RealLines] No local transit data found at: ${localFileUrl}`);
        }
    } catch (e) {
        console.error(`[RealLines] Failed to load local data for ${cityCode}:`, e);
    }
}

// ----------------------------------------------------
// 4. MAP LAYER INJECTION & FILTERING
// ----------------------------------------------------

function injectLayers(map, geojsonData) {
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: geojsonData });
    } else {
        map.getSource(SOURCE_ID).setData(geojsonData);
    }

    if (!map.getLayer(LAYER_ID_LINES)) {
        map.addLayer({
            id: LAYER_ID_LINES,
            type: 'line',
            source: SOURCE_ID,
            layout: { 'line-join': 'round', 'line-cap': 'round' },
            paint: {
                'line-color': ['coalesce', ['get', 'colour'], ['get', 'color'], '#a855f7'],
                'line-width': 3.5,
                'line-opacity': 0.8
            }
        });
        if (map.getLayer('road-label')) map.moveLayer(LAYER_ID_LINES, 'road-label');
    }

    if (!map.getLayer(LAYER_ID_STATIONS)) {
        map.addLayer({
            id: LAYER_ID_STATIONS,
            type: 'circle',
            source: SOURCE_ID,
            paint: {
                'circle-color': ['coalesce', ['get', 'colour'], ['get', 'color'], '#ffffff'],
                'circle-radius': 4.5,
                'circle-stroke-width': 2,
                'circle-stroke-color': ['coalesce', ['get', 'colour'], ['get', 'color'], '#a855f7']
            }
        });
        if (map.getLayer('road-label')) map.moveLayer(LAYER_ID_STATIONS, 'road-label');
    }

    updateMapFilters(map);
}

function updateMapFilters(targetMap = null) {
    const map = targetMap || api.utils.getMap();
    if (!map || !map.getLayer(LAYER_ID_LINES)) return;
    
    const s = window.RealTransitState;

    if (!s.masterVisible || s.activeLines.length === 0) {
        map.setLayoutProperty(LAYER_ID_LINES, 'visibility', 'none');
        map.setLayoutProperty(LAYER_ID_STATIONS, 'visibility', 'none');
        return;
    }

    // STRICT FILTERING: Only show exactly what is toggled on in the menu
    map.setLayoutProperty(LAYER_ID_LINES, 'visibility', 'visible');
    map.setFilter(LAYER_ID_LINES, [
        'all',
        ['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'MultiLineString']],
        ['match', ['get', '_mod_line_id'], s.activeLines, true, false]
    ]);

    // STRICT STATION FILTERING RESTORED
    if (s.stationsVisible) {
        map.setLayoutProperty(LAYER_ID_STATIONS, 'visibility', 'visible');
        map.setFilter(LAYER_ID_STATIONS, [
            'all',
            ['==', ['geometry-type'], 'Point'],
            ['match', ['get', '_mod_line_id'], s.activeLines, true, false]
        ]);
    } else {
        map.setLayoutProperty(LAYER_ID_STATIONS, 'visibility', 'none');
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