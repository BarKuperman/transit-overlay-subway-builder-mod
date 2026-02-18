const api = window.SubwayBuilderAPI;

const getUniqueNetworkId = (type, net) => `${type}__${net}`;

const naturalSort = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare;

const LAYER_ID_LINES = 'real-transit-lines';
const LAYER_ID_STATIONS = 'real-transit-stations';
const SOURCE_ID = 'real-transit-source';

window.RealTransitState = {
    masterVisible: localStorage.getItem('rt_master') !== 'false',
    stationsVisible: localStorage.getItem('rt_stations') === 'true',
    activeTypes: [],
    activeNetworks: [],
    activeLines: [],      
    hierarchy: {}, 
    lineNames: {}, // Stores display names for unique IDs
    currentCity: null, 
    cache: {} 
};

api.hooks.onGameInit(() => {
    api.ui.showNotification("✅ Real Transit Menu Loaded", "success");

    const { React, components, icons } = api.utils;
    const { Button, Card, CardContent, Switch, Label } = components;
    const { Layers, ChevronDown, ChevronRight } = icons; 
    const h = React.createElement;

    const TransitDropdownMenu = () => {
        const [isOpen, setIsOpen] = React.useState(false);
        const [trigger, setTriggerRender] = React.useState(0);
        const [expandedGroups, setExpandedGroups] = React.useState({});

        React.useEffect(() => {
            const handler = () => setTriggerRender(prev => prev + 1);
            window.addEventListener('rt_data_loaded', handler);
            return () => window.removeEventListener('rt_data_loaded', handler);
        }, []);

        const s = window.RealTransitState;
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

            localStorage.setItem(`rt_active_types_${s.currentCity}`, JSON.stringify(s.activeTypes));
            localStorage.setItem(`rt_active_nets_${s.currentCity}`, JSON.stringify(s.activeNetworks));
            localStorage.setItem(`rt_active_lines_${s.currentCity}`, JSON.stringify(s.activeLines));

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
            localStorage.setItem(`rt_active_types_${s.currentCity}`, JSON.stringify(active));
            
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
            localStorage.setItem(`rt_active_nets_${s.currentCity}`, JSON.stringify(active));
            
            if (turningOn) {
                if (!s.activeTypes.includes(parentType)) {
                    s.activeTypes.push(parentType);
                    localStorage.setItem(`rt_active_types_${s.currentCity}`, JSON.stringify(s.activeTypes));
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
            localStorage.setItem(`rt_active_lines_${s.currentCity}`, JSON.stringify(active));
            
            if (turningOn) {
                const uniqueNetId = getUniqueNetworkId(parentType, parentNet);
                if (!s.activeNetworks.includes(uniqueNetId)) {
                    s.activeNetworks.push(uniqueNetId);
                    localStorage.setItem(`rt_active_nets_${s.currentCity}`, JSON.stringify(s.activeNetworks));
                }
                if (!s.activeTypes.includes(parentType)) {
                    s.activeTypes.push(parentType);
                    localStorage.setItem(`rt_active_types_${s.currentCity}`, JSON.stringify(s.activeTypes));
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
                    localStorage.setItem(`rt_active_nets_${s.currentCity}`, JSON.stringify(s.activeNetworks));
                }
            } else {
                groupLines.forEach(l => { if (!newActive.includes(l)) newActive.push(l); });
                
                if (!s.activeNetworks.includes(uniqueNetId)) {
                    s.activeNetworks.push(uniqueNetId);
                    localStorage.setItem(`rt_active_nets_${s.currentCity}`, JSON.stringify(s.activeNetworks));
                }
                if (!s.activeTypes.includes(parentType)) {
                    s.activeTypes.push(parentType);
                    localStorage.setItem(`rt_active_types_${s.currentCity}`, JSON.stringify(s.activeTypes));
                }
                ensureMasterVisible();
            }
            s.activeLines = newActive;
            localStorage.setItem(`rt_active_lines_${s.currentCity}`, JSON.stringify(s.activeLines));
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

        let panel = null;
        if (isOpen) {
            const typeElements = typeKeys.sort(naturalSort).map(type => {
                const typeNetworks = hierarchy[type];
                const networkKeys = Object.keys(typeNetworks).sort(naturalSort);
                const typeIsVisible = s.activeTypes.includes(type);
                const isTypeExpanded = expandedGroups[type];

                const isSingleNetwork = networkKeys.length === 1;
                const displayName = isSingleNetwork ? networkKeys[0] : type;

                // Fixed: Neutral border color, text uses opacity instead of hardcoded white
                const typeHeader = h('div', { 
                    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid rgba(128,128,128,0.2)' },
                    key: `${type}-header` 
                }, [
                    h('div', { 
                        style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', opacity: isTypeExpanded ? 1 : 0.6 },
                        onClick: () => toggleGroupExpand(type, networkKeys) 
                    }, [
                        h(isTypeExpanded ? ChevronDown : ChevronRight, { size: 16 }),
                        h(Label, { style: { fontWeight: 'bold', cursor: 'pointer', fontSize: '14px' } }, displayName)
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

                        typeChildren = h('div', { style: { marginLeft: '24px', display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 0', marginBottom: '8px' }, key: `${type}-flat-children` }, [
                            h('div', { style: { display: 'flex', gap: '8px', paddingBottom: '4px', borderBottom: '1px solid rgba(128,128,128,0.15)' } }, [
                                h(Button, { 
                                    variant: 'ghost', size: 'sm', style: { height: '20px', padding: '0 8px', fontSize: '10px' },
                                    onClick: () => toggleGroupAllLines(groupLines, allActiveInGroup, type, net) 
                                }, allActiveInGroup ? "Deselect All" : "Select All")
                            ]),
                            ...groupLines.map(lineId => {
                                const isActive = s.activeLines.includes(lineId);
                                const displayName = s.lineNames?.[lineId] || lineId;
                                return h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0' }, key: lineId }, [
                                    h(Label, { style: { fontSize: '12px', cursor: 'pointer' }, onClick: () => toggleLine(lineId, type, net) }, displayName),
                                    h(Switch, { checked: isActive, onCheckedChange: () => toggleLine(lineId, type, net) })
                                ]);
                            })
                        ]);
                    } else {
                        typeChildren = h('div', { style: { marginLeft: '12px', marginTop: '4px', marginBottom: '8px', display: 'flex', flexDirection: 'column' } },
                            networkKeys.map(net => {
                                const groupLines = typeNetworks[net];
                                const isNetExpanded = expandedGroups[`${type}-${net}`];
                                
                                const netIsVisible = s.activeNetworks.includes(getUniqueNetworkId(type, net));
                                const allActiveInGroup = typeIsVisible && netIsVisible && groupLines.every(l => s.activeLines.includes(l));

                                // Fixed: Neutral borders and opacity
                                const netHeader = h('div', { 
                                    style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(128,128,128,0.15)' },
                                    key: `${net}-header` 
                                }, [
                                    h('div', { 
                                        style: { display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', opacity: isNetExpanded ? 1 : 0.6 },
                                        onClick: () => toggleGroupExpand(`${type}-${net}`) 
                                    }, [
                                        h(isNetExpanded ? ChevronDown : ChevronRight, { size: 14 }),
                                        h(Label, { style: { fontWeight: '600', cursor: 'pointer', fontSize: '13px' } }, net)
                                    ]),
                                    h(Switch, { checked: netIsVisible, onCheckedChange: () => toggleNetworkVisibility(net, type) })
                                ]);

                                let netChildren = null;
                                if (isNetExpanded) {
                                    netChildren = h('div', { style: { marginLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 0' }, key: `${net}-children` }, [
                                        h('div', { style: { display: 'flex', gap: '8px', paddingBottom: '4px' } }, [
                                            h(Button, { 
                                                variant: 'ghost', size: 'sm', style: { height: '20px', padding: '0 8px', fontSize: '10px' },
                                                onClick: () => toggleGroupAllLines(groupLines, allActiveInGroup, type, net) 
                                            }, allActiveInGroup ? "Deselect All" : "Select All")
                                        ]),
                                        ...groupLines.map(lineId => {
                                            const isActive = s.activeLines.includes(lineId);
                                            const displayName = s.lineNames?.[lineId] || lineId;
                                            return h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 0' }, key: lineId }, [
                                                h(Label, { style: { fontSize: '12px', cursor: 'pointer' }, onClick: () => toggleLine(lineId, type, net) }, displayName),
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
                return h('div', { key: type, style: { display: 'flex', flexDirection: 'column' } }, [typeHeader, typeChildren]);
            });

            // Fixed shadow to be less harsh in light mode
            panel = h(Card, { 
                style: { position: 'fixed', top: '60px', right: '16px', width: '300px', zIndex: 99999, maxHeight: '75vh', overflowY: 'auto', boxShadow: '0 8px 24px rgba(0,0,0,0.15)' }
            }, [
                h(CardContent, { style: { padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' } }, [
                    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', paddingBottom: '12px', borderBottom: '1px solid rgba(128,128,128,0.2)' } }, [
                        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, [
                            h(Label, { style: { fontWeight: 'bold' } }, "Show Overlay"),
                            h(Switch, { checked: s.masterVisible, onCheckedChange: toggleMaster })
                        ]),
                        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, [
                            h(Label, { style: { fontWeight: 'bold' } }, "Show Stations"),
                            h(Switch, { checked: s.stationsVisible, onCheckedChange: toggleStations })
                        ])
                    ]),
                    h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, [
                        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px', marginTop: '4px' } }, [
                            h('div', null, [
                                h(Label, { style: { fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.7, display: 'block' } }, "Transit Networks"),
                                h('div', { style: { fontSize: '10px', opacity: 0.5, marginTop: '2px' } }, `Showing ${displayCount} of ${totalLines} lines`)
                            ]),
                            totalLines > 0 ? h(Button, { 
                                variant: 'ghost', size: 'sm', style: { height: '24px', padding: '0 8px', fontSize: '12px' }, 
                                onClick: toggleMasterAll
                            }, isAllSelected ? "Deselect All" : "Select All") : null
                        ]),
                        totalLines > 0 ? typeElements : h('div', { style: { fontSize: '12px', opacity: 0.7 } }, "No lines found in data.")
                    ])
                ])
            ]);
        }

        return h('div', null, [
            h(Button, {
                variant: s.masterVisible ? 'default' : 'secondary', 
                style: { width: '36px', height: '36px', padding: '0', display: 'flex', alignItems: 'center', justifyContent: 'center' },
                onClick: () => setIsOpen(!isOpen)
            }, [ h(Layers, { size: 18 }) ]),
            panel
        ]);
    };

    api.ui.registerComponent('top-bar', { id: 'real-transit-menu', component: TransitDropdownMenu });
});

api.hooks.onCityLoad((cityCode) => {
    window.RealTransitState.currentCity = cityCode;
    const map = api.utils.getMap();
    if (map) updateCityData(map, cityCode);
});

api.hooks.onMapReady((map) => {
    const cityCode = window.RealTransitState.currentCity || getCurrentCityCode();
    updateCityData(map, cityCode);

    map.on('styledata', () => {
        try {
            const s = window.RealTransitState;
            const currentCity = s.currentCity || getCurrentCityCode();
            if (!map.getSource(SOURCE_ID) && s.cache[currentCity]) injectLayers(map, s.cache[currentCity]);
            if (map.getLayer(LAYER_ID_LINES)) map.moveLayer(LAYER_ID_LINES); 
            if (map.getLayer(LAYER_ID_STATIONS)) map.moveLayer(LAYER_ID_STATIONS);
        } catch (err) {}
    });
});

async function updateCityData(map, manualCityCode = null) {
    const cityCode = manualCityCode || window.RealTransitState.currentCity || getCurrentCityCode();
    if (!cityCode) return;
    if (window.RealTransitState.cache[cityCode]) {
        injectLayers(map, window.RealTransitState.cache[cityCode]);
        return;
    }

    try {
        let modsDir = await window.electron.getModsFolder();
        const localFileUrl = `file:///${modsDir.replaceAll('\\', '/')}/Transit Overlay/data/${cityCode.toLowerCase()}.geojson`;
        const response = await fetch(localFileUrl);
        
        if (response.ok) {
            let geojsonData = await response.json();
            const rawHierarchy = {};
            const linesSet = new Set();
            const typesSet = new Set();
            const networksSet = new Set();

            const lineNameMap = {};
            geojsonData.features.forEach(f => {
                const p = f.properties;
                const displayName = String(p.route_name || 'Unnamed Line');
                const type = p.type || "Other"; 
                const network = p.network || "Unknown";
                
                // Create unique ID to separate same-named lines from different networks
                const uniqueId = `${type}__${network}__${displayName}`;
                
                p._mod_line_id = uniqueId; 
                lineNameMap[uniqueId] = displayName;
                
                if (f.geometry.type.includes('LineString') || p.is_station) {
                    linesSet.add(uniqueId);
                    typesSet.add(type);
                    networksSet.add(getUniqueNetworkId(type, network));
                    if (!rawHierarchy[type]) rawHierarchy[type] = {};
                    if (!rawHierarchy[type][network]) rawHierarchy[type][network] = new Set();
                    rawHierarchy[type][network].add(uniqueId);
                }
            });
            window.RealTransitState.lineNames = lineNameMap;

            const formattedHierarchy = {};
            for (let t in rawHierarchy) {
                formattedHierarchy[t] = {};
                for (let n in rawHierarchy[t]) {
                    formattedHierarchy[t][n] = Array.from(rawHierarchy[t][n]).sort(naturalSort);
                }
            }

            window.RealTransitState.hierarchy = formattedHierarchy;
            window.RealTransitState.currentCity = cityCode;

            const savedLines = localStorage.getItem(`rt_active_lines_${cityCode}`);
            window.RealTransitState.activeLines = savedLines ? JSON.parse(savedLines) : Array.from(linesSet);

            const savedTypes = localStorage.getItem(`rt_active_types_${cityCode}`);
            window.RealTransitState.activeTypes = savedTypes ? JSON.parse(savedTypes) : Array.from(typesSet);

            const savedNets = localStorage.getItem(`rt_active_nets_${cityCode}`);
            window.RealTransitState.activeNetworks = savedNets ? JSON.parse(savedNets) : Array.from(networksSet);

            window.RealTransitState.cache[cityCode] = geojsonData;
            window.dispatchEvent(new CustomEvent('rt_data_loaded'));
            
            injectLayers(map, geojsonData);
        }
    } catch (e) {
        console.error(`[RealLines] Failed to load local data for ${cityCode}:`, e);
    }
}

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
            paint: { 'line-color': ['coalesce', ['get', 'colour'], ['get', 'color'], '#a855f7'], 'line-width': 3.5, 'line-opacity': 0.8 }
        });
        if (map.getLayer('road-label')) map.moveLayer(LAYER_ID_LINES, 'road-label');
    }

    if (!map.getLayer(LAYER_ID_STATIONS)) {
        map.addLayer({
            id: LAYER_ID_STATIONS,
            type: 'circle',
            source: SOURCE_ID,
            paint: { 'circle-color': ['coalesce', ['get', 'colour'], ['get', 'color'], '#ffffff'], 'circle-radius': 4.5, 'circle-stroke-width': 2, 'circle-stroke-color': ['coalesce', ['get', 'colour'], ['get', 'color'], '#a855f7'] }
        });
        if (map.getLayer('road-label')) map.moveLayer(LAYER_ID_STATIONS, 'road-label');
    }

    updateMapFilters(map);
}

function updateMapFilters(targetMap = null) {
    const map = targetMap || api.utils.getMap();
    if (!map || !map.getLayer(LAYER_ID_LINES)) return;
    
    const s = window.RealTransitState;

    if (!s.masterVisible) {
        map.setLayoutProperty(LAYER_ID_LINES, 'visibility', 'none');
        map.setLayoutProperty(LAYER_ID_STATIONS, 'visibility', 'none');
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

    if (s.stationsVisible) {
        map.setLayoutProperty(LAYER_ID_STATIONS, 'visibility', 'visible');
        map.setFilter(LAYER_ID_STATIONS, [
            'all',
            ['==', ['geometry-type'], 'Point'],
            ['match', ['get', '_mod_line_id'], effectiveActiveLines, true, false]
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