const api = window.SubwayBuilderAPI;

const getUniqueNetworkId = (type, net) => `${type}__${net}`;

const naturalSort = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

const LAYER_ID_LINES = 'real-transit-lines';
const LAYER_ID_STATIONS = 'real-transit-stations';
const SOURCE_ID = 'real-transit-source';

const hasTransitSource = (map) => !!(map && map.getSource && map.getSource(SOURCE_ID));
const hasLinesLayer = (map) => !!(map && map.getLayer && map.getLayer(LAYER_ID_LINES));
const hasStationsLayer = (map) => !!(map && map.getLayer && map.getLayer(LAYER_ID_STATIONS));
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
    cache: {}
};

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
    api.ui.showNotification("✅ Real Transit Menu Loaded", "success");

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
        };

        const s = window.RealTransitState;

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
            // Card Container: Use explicit styles for layout/scroll handling
            // Ensure panel fits within screen height with calculated max-height
            // Using explicit style to force constraints
            style: { maxHeight: 'calc(100vh - 245px)', display: 'flex', flexDirection: 'column' },
            className: 'fixed top-[60px] right-4 w-[320px] z-[99999] pointer-events-auto bg-primary-foreground/80 backdrop-blur-sm border border-border/50 rounded-lg shadow-lg overflow-hidden',
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
                title: 'Open layers panel',
                // Toggle Button
                className: `h-10 w-10 flex items-center justify-center rounded-md cursor-pointer transition-all shadow-sm backdrop-blur-sm border border-primary/10 pointer-events-auto ${isOpen ? 'bg-primary text-primary-foreground' : 'bg-primary-foreground/70 text-primary/70 hover:text-primary hover:bg-primary-foreground/90'}`
            }, [
                h(Layers, { className: "w-5 h-5 stroke-[1.5]" })
            ]),
            panel
        ]);
    };

    // Register component using the custom pattern
    api.ui.registerComponent('top-bar', { id: 'real-transit-overlay', component: TransitPanel });
});

api.hooks.onCityLoad((cityCode) => {
    window.RealTransitState.currentCity = cityCode;
    const map = api.utils.getMap();
    if (map) updateCityData(map, cityCode);
});

api.hooks.onMapReady((map) => {
    const cityCode = window.RealTransitState.currentCity || getCurrentCityCode();
    updateCityData(map, cityCode);

    map.on('styledata', () => handleStyleDataRefresh(map));
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
    safelyMoveLayer(map, LAYER_ID_STATIONS, 'road-label');
}

function handleStyleDataRefresh(map) {
    try {
        const s = window.RealTransitState;
        const currentCity = s.currentCity || getCurrentCityCode();
        const cachedCityData = currentCity ? s.cache[currentCity] : null;

        if (!hasTransitSource(map) && cachedCityData) {
            injectLayers(map, cachedCityData);
        } else {
            ensureTransitLayerOrder(map);
            if (canApplyFilters(map)) updateMapFilters(map);
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

async function updateCityData(map, manualCityCode = null) {
    const cityCode = manualCityCode || window.RealTransitState.currentCity || getCurrentCityCode();
    if (!cityCode) return;

    const cached = window.RealTransitState.cache[cityCode];
    if (cached) {
        hydrateCityStateFromGeoJson(cityCode, cached);
        window.dispatchEvent(new CustomEvent('rt_data_loaded'));
        injectLayers(map, cached);
        return;
    }

    try {
        let modsDir = await window.electron.getModsFolder();
        const localFileUrl = `file:///${modsDir.replaceAll('\\', '/')}/Transit Overlay/data/${cityCode.toLowerCase()}.geojson`;
        const response = await fetch(localFileUrl);

        if (response.ok) {
            let geojsonData = await response.json();
            hydrateCityStateFromGeoJson(cityCode, geojsonData);
            window.RealTransitState.cache[cityCode] = geojsonData;
            window.dispatchEvent(new CustomEvent('rt_data_loaded'));
            injectLayers(map, geojsonData);
        }
    } catch (e) {
        console.error(`[RealLines] Failed to load local data for ${cityCode}:`, e);
    }
}

function injectLayers(map, geojsonData) {
    if (!hasTransitSource(map)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: geojsonData });
    } else {
        map.getSource(SOURCE_ID).setData(geojsonData);
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
}

function updateMapFilters(targetMap = null) {
    const map = targetMap || api.utils.getMap();
    if (!map || !canApplyFilters(map)) return;

    const s = window.RealTransitState;

    if (!s.masterVisible) {
        map.setLayoutProperty(LAYER_ID_LINES, 'visibility', 'none');
        if (hasStationsLayer(map)) map.setLayoutProperty(LAYER_ID_STATIONS, 'visibility', 'none');
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
