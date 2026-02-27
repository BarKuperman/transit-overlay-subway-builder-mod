# Transit Overlay for Subway Builder

This mod adds real-world transit data as an interactive overlay to **Subway Builder**, allowing you to visualize actual subway, train, and tram networks while you build your own systems.

---

## Installation

1. **Extract the Files**: Place the entire folder into your game's `mods` directory.
2. **Enable in Mod Manager**:
   * Launch the game and open the **Mod Manager**.
   * Locate **Transit Overlay** and toggle it to **ON**.
   * Click **Reload Mods**.
3. **Required Restart**: Close the game completely after activating the mod for the first time.

Expected folder structure:
```text
metro-maker4/
└─ mods/
   └─ Transit Overlay/
      ├─ manifest.json
      ├─ index.js
      ├─ README.md
      └─ data/
         ├─ atl.geojson
         ├─ ...
         └─ tor.geojson
```

---

## How to Use

### Controls & Navigation
Once inside a map, a new **Transit Overlay** button will appear in your bottom bar:
* **Show Overlay**: Master switch to turn the entire transit layer on or off.
* **Show Stations**: Toggle for physical station markers.
* **Line Filters**: Individual checkboxes to show or hide specific lines (e.g., Line 1, RER A, or Central Line).

### Hover Feature
The overlay includes interactive hover tooltips for lines and stations. Hover is active only while the Transit Overlay panel is open:
* **Hover a line** to see its name, type, and network.
* **Hover a station** to see the station name and all lines serving it.
* **Multiple lines under cursor**: Press `Tab` to cycle through overlapping lines.
* **Pin line tooltip**: Click while hovering a line to pin its tooltip and highlight.
* **Close pinned tooltip**: Click again, click outside the map, or press any key other than `Tab`.
* **Station names note**: Some maps do not include station names yet. Name coverage will be expanded in an upcoming update.

---

## Included Data
The mod currently includes transit data for the following cities:
* **Atlanta** (`atl.geojson`)
* **Baltimore** (`bal.geojson`)
* **Boston** (`bos.geojson`)
* **Chicago** (`chi.geojson`)
* **Dallas** (`dal.geojson`)
* **Denver** (`den.geojson`)
* **Houston** (`hou.geojson`)
* **London** (`lon.geojson`)
* **Miami** (`mia.geojson`)
* **Montreal** (`mon.geojson`)
* **Minneapolis** (`msp.geojson`)
* **New York City** (`nyc.geojson`)
* **Paris** (`par.geojson`)
* **Philadelphia** (`phl.geojson`)
* **Phoenix** (`phx.geojson`)
* **Pittsburgh** (`pit.geojson`)
* **Portland, Oregon** (`pdx.geojson`)
* **San Diego** (`san.geojson`)
* **San Francisco Bay Area** (`sf.geojson`)
* **Seattle** (`sea.geojson`)
* **Tel Aviv** (`tlv.geojson`)
* **Toronto** (`tor.geojson`)
* **Washington D.C.** (`dc.geojson`)


