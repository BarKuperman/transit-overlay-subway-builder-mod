# Transit Overlay GeoJSON Format

Transit Overlay loads one GeoJSON file per supported city from the `data/`
folder. The file name must match the lowercase city code used by Subway Builder:

```text
data/nyc.geojson
data/lon.geojson
data/tlv.geojson
```

Each file is a standard GeoJSON `FeatureCollection` containing route geometry
and optional station markers.

## File Structure

```json
{
  "type": "FeatureCollection",
  "features": []
}
```

The mod reads the collection directly into a map GeoJSON source. Route features
and station features live together in the same file.

## Geometry

### Routes

Routes are drawn from `LineString` and `MultiLineString` features.

Coordinates must be standard GeoJSON coordinates in longitude, latitude order:

```text
[longitude, latitude]
```

Example route feature:

```json
{
  "type": "Feature",
  "properties": {
    "route_name": "Red Line",
    "type": "Light Rail",
    "network": "Dankal",
    "color": "#E51937"
  },
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [34.74681487209466, 32.00227992313944],
      [34.747150876180854, 32.00278391761755]
    ]
  }
}
```

### Stations

Stations are `Point` features with `properties.is_station` set to `true`.

Example station feature:

```json
{
  "type": "Feature",
  "properties": {
    "route_name": "Red Line",
    "type": "Light Rail",
    "network": "Dankal",
    "color": "#E51937",
    "is_station": true,
    "station_name": "Allenby"
  },
  "geometry": {
    "type": "Point",
    "coordinates": [34.7701, 32.0624]
  }
}
```

## Required Properties

Use these fields on every route feature and every station feature.

| Property | Type | Meaning |
| --- | --- | --- |
| `route_name` | string | Route display name, such as `"Red Line"` or `"1 Train"`. |
| `type` | string | Transit category, such as `"Subway"`, `"Light Rail"`, `"Commuter Rail"`, or `"Tram"`. |
| `network` | string | Operating network or system, such as `"MTA Subway"` or `"London Underground"`. |
| `color` | string | Route color as a CSS color, preferably a six-digit hex value like `"#E51937"`. |

## Station Properties

| Property | Type | Meaning |
| --- | --- | --- |
| `is_station` | boolean | Must be `true` for station point features. |
| `station_name` | string | Station display name. |

## Optional Draw Order

Route line features may include one of these numeric properties:

- `draw_order`
- `line_order`
- `order`

If one is present, the mod uses it to decide which lines draw above others. If
none is present, the mod computes a deterministic fallback order from route
names.

The mod also applies broad type tiers internally:

| `type` value | Draw behavior |
| --- | --- |
| `"Subway"` | Highest tier. |
| `"Commuter Rail"` | Lowest tier. |
| Any other value | Middle tier. |

## Line Identity

The mod groups features into one toggleable line using this generated ID:

```text
type + "__" + network + "__" + route_name
```

These three properties must match exactly across every route segment and station
for the same line.

## Defaults

The code has fallbacks, but new data should not rely on them.

| Missing property | Fallback |
| --- | --- |
| `route_name` | `"Unnamed Line"` |
| `type` | `"Other"` |
| `network` | `"Unknown"` |
| `color` | `"#9ca3af"` in hover UI, `"#a855f7"` for line paint fallback |
| `station_name` or `name` | Empty station title, displayed as `"Station"` in hover UI |

## Minimal Complete Example

```json
{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": {
        "route_name": "Red Line",
        "type": "Light Rail",
        "network": "Example Transit",
        "color": "#E51937"
      },
      "geometry": {
        "type": "LineString",
        "coordinates": [
          [-73.9901, 40.7301],
          [-73.9812, 40.7375],
          [-73.9724, 40.7450]
        ]
      }
    },
    {
      "type": "Feature",
      "properties": {
        "route_name": "Red Line",
        "type": "Light Rail",
        "network": "Example Transit",
        "color": "#E51937",
        "is_station": true,
        "station_name": "Central"
      },
      "geometry": {
        "type": "Point",
        "coordinates": [-73.9901, 40.7301]
      }
    }
  ]
}
```
