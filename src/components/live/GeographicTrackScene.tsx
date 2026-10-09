"use client";
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { createVehicleLayer } from "@/lib/vehicleLayer";
import { resolveTrackFlags, getTrackFlagTone } from "@/lib/trackFlags";
import { createCircuitFlagSectors, type CircuitFlagZone } from "@/lib/circuitFlagSectors";
import { fetchMap } from "@/lib/fetchMap";
import { useLivePreferences } from "@/stores/useLivePreferences";
import { useReferenceContext } from "./ReferenceContext";
import { getDriverPositionAt, getPositionTime } from "@/lib/positionTimeline";
import { useDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import type { SceneSettings } from "@/types/live-view.type";
import type { FeatureCollection, LineString, Point } from "geojson";

type CircuitGeo = FeatureCollection<LineString | Point> & {
	bbox?: number[];
	turnMarkers?: { number: number; position: number[] }[];
	flagZones?: CircuitFlagZone[];
};
export default function GeographicTrackScene({ settings }: { settings: SceneSettings }) {
	const reference = useReferenceContext();
	const containerRef = useRef<HTMLDivElement>(null);
	const optionsRef = useRef(settings);
	const [error, setError] = useState("");
	useEffect(() => {
		optionsRef.current = settings;
	}, [settings]);
	useEffect(() => {
		const circuit = reference?.circuit;
		const container = containerRef.current;
		if (!circuit || !container) return;
		let cancelled = false;
		let cleanup: (() => void) | undefined;
		const filename = circuit.circuit_track;
		const url = "/api/circuit-geometry?file=" + encodeURIComponent(filename);
		fetch(url)
			.then((response) => {
				if (!response.ok) throw new Error("Circuit geography unavailable");
				return response.json() as Promise<CircuitGeo>;
			})
			.then((geo) => {
				if (cancelled) return;
				if ("available" in geo && geo.available === false) {
					useLivePreferences.getState().update({ mode: "2d" });
					return;
				}
				const track = geo.features.find(
					(feature) => feature.geometry.type === "LineString" && !feature.properties?.role,
				);
				if (!track || track.geometry.type !== "LineString") throw new Error("Circuit outline unavailable");
				const coords = track.geometry.coordinates;
				function smoothLine(points: number[][], closed: boolean) {
					let result = points;
					for (let pass = 0; pass < 2; pass++) {
						const next: number[][] = closed ? [] : [result[0]];
						for (let index = 0; index < result.length - (closed ? 0 : 1); index++) {
							const a = result[index];
							const b = result[(index + 1) % result.length];
							next.push(
								[a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25],
								[a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75],
							);
						}
						if (!closed) next.push(result[result.length - 1]);
						result = next;
					}
					if (closed) result.push(result[0]);
					return result;
				}
				const renderedGeo = {
					...geo,
					features: geo.features.map((feature) =>
						feature.geometry.type === "LineString"
							? {
									...feature,
									geometry: {
										...feature.geometry,
										coordinates: smoothLine(
											feature.geometry.coordinates,
											feature.properties?.closed !== false && feature.properties?.role !== "pit-lane",
										),
									},
								}
							: feature,
					),
				};
				const west = Math.min(...coords.map((point) => point[0]));
				const east = Math.max(...coords.map((point) => point[0]));
				const south = Math.min(...coords.map((point) => point[1]));
				const north = Math.max(...coords.map((point) => point[1]));
				const rawToGeo = (x: number, y: number): [number, number] | null => {
					const { position_x_min: xmin, position_x_max: xmax, position_y_min: ymin, position_y_max: ymax } = circuit;
					if (xmin === null || xmax === null || ymin === null || ymax === null || xmax === xmin || ymax === ymin)
						return null;
					return [
						west + ((x - xmin) / (xmax - xmin)) * (east - west),
						south + ((y - ymin) / (ymax - ymin)) * (north - south),
					];
				};
				const map = new maplibregl.Map({
					container,
					style: "https://tiles.openfreemap.org/styles/positron",
					center: [(west + east) / 2, (south + north) / 2],
					zoom: 14.5,
					pitch: 48,
					bearing: -20,
					attributionControl: { compact: true },
					maxPitch: 85,
					canvasContextAttributes: { antialias: true },
				});
				const bounds: [[number, number], [number, number]] = [
					[west, south],
					[east, north],
				];
				let frame = 0;
				let lastData = 0;
				let lastLighting = "";
				let lastView = "";
				let lastZoom = 0;
				const markers = new Map<string, maplibregl.Marker>();
				const previousCoordinates = new Map<string, [number, number]>();
				let lastFollowBearing = 0;
				map.on("load", () => {
					if (cancelled) return;
					map.fitBounds(bounds, { padding: 42, pitch: 48, bearing: -20, duration: 0 });
					// Quiet geographic context; only circuit overlays and driver markers carry emphasis.
					for (const layer of map.getStyle().layers ?? []) {
						if (layer.type === "symbol") map.setLayoutProperty(layer.id, "visibility", "none");
						if (layer.type === "background") map.setPaintProperty(layer.id, "background-color", "#181818");
						if (layer.type === "fill") {
							map.setPaintProperty(layer.id, "fill-color", /water/.test(layer.id) ? "#1b1b1b" : "#252525");
							map.setPaintProperty(layer.id, "fill-outline-color", "#2d2d2d");
						}
						if (layer.type === "line") {
							map.setPaintProperty(layer.id, "line-color", "#4b4b4b");
							map.setPaintProperty(layer.id, "line-opacity", 0.3);
						}
					}

					map.addSource("circuit", { type: "geojson", data: renderedGeo });
					map.addLayer({
						id: "circuit-edge",
						type: "line",
						source: "circuit",
						filter: ["==", ["geometry-type"], "LineString"],
						layout: { "line-cap": "round", "line-join": "round" },
						paint: {
							"line-color": "#f1f5f9",
							"line-width": ["interpolate", ["exponential", 2], ["zoom"], 12, 3, 16, 15, 20, 200],
						},
					});
					map.addLayer({
						id: "circuit-road",
						type: "line",
						source: "circuit",
						filter: ["==", ["geometry-type"], "LineString"],
						layout: { "line-cap": "round", "line-join": "round" },
						paint: {
							"line-color": "#3f4148",
							"line-width": ["interpolate", ["exponential", 2], ["zoom"], 12, 1, 16, 10, 20, 150],
						},
					});
					const renderedTrack = renderedGeo.features.find(
						(feature) => feature.geometry.type === "LineString" && !feature.properties?.role,
					)!;
					const flagLine = (renderedTrack.geometry as LineString).coordinates;
					map.addSource("circuit-flag-sectors", {
						type: "geojson",
						data: createCircuitFlagSectors(flagLine, geo.flagZones ?? []),
					});
					map.addLayer(
						{
							id: "circuit-local-yellow",
							type: "line",
							source: "circuit-flag-sectors",
							layout: { "line-cap": "butt", "line-join": "round" },
							paint: {
								"line-color": "#eab308",
								"line-opacity": 0,
								"line-width": ["interpolate", ["exponential", 2], ["zoom"], 12, 3, 16, 15, 20, 200],
							},
						},
						"circuit-road",
					);
					if (!geo.flagZones?.length) {
						const key = useDataStore.getState().state?.SessionInfo?.Meeting.Circuit.Key;
						if (key)
							void fetchMap(key).then((geometry) => {
								if (cancelled || !geometry?.marshalSectors.length) return;
								const boundaries = geometry.marshalSectors.map((sector) =>
									rawToGeo(sector.trackPosition.x, sector.trackPosition.y),
								);
								const zones: CircuitFlagZone[] = [];
								boundaries.forEach((entry, index) => {
									const exit = boundaries[(index + 1) % boundaries.length];
									if (entry && exit) zones.push({ number: geometry.marshalSectors[index].number, entry, exit });
								});
								(map.getSource("circuit-flag-sectors") as maplibregl.GeoJSONSource).setData(
									createCircuitFlagSectors(flagLine, zones),
								);
							});
					}
					const style = map.getStyle();
					const building = style.layers?.find(
						(layer) => "source-layer" in layer && layer["source-layer"] === "building",
					);
					if (building && "source" in building)
						map.addLayer({
							id: "circuit-buildings",
							type: "fill-extrusion",
							source: building.source,
							"source-layer": "building",
							minzoom: 13,
							paint: {
								"fill-extrusion-color": "#383838",
								"fill-extrusion-height": ["coalesce", ["get", "render_height"], ["get", "height"], 6],
								"fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
								"fill-extrusion-opacity": 0.75,
								"fill-extrusion-vertical-gradient": false,
							},
						});
					map.addSource("circuit-turns", {
						type: "geojson",
						data: {
							type: "FeatureCollection",
							features: (geo.turnMarkers ?? [])
								.filter((turn) => turn.position?.length >= 2)
								.map((turn) => ({
									type: "Feature",
									geometry: { type: "Point", coordinates: turn.position },
									properties: { label: String(turn.number) },
								})),
						},
					});
					map.addLayer({
						id: "circuit-turn-labels",
						type: "symbol",
						source: "circuit-turns",
						layout: {
							"text-field": ["get", "label"],
							"text-font": ["Noto Sans Regular"],
							"text-size": 12,
							"text-offset": [1, 1],
							visibility: "none",
						},
						paint: { "text-color": "#b8b8b8", "text-halo-color": "#181818", "text-halo-width": 1.5 },
					});
					map.addLayer(
						createVehicleLayer([(west + east) / 2, (south + north) / 2], rawToGeo, () => optionsRef.current),
					);
					const loop = (now: number) => {
						if (cancelled) return;
						const options = optionsRef.current;
						const state = useDataStore.getState();
						const time = getPositionTime(useSettingsStore.getState().delay, now);
						for (const driver of Object.values(state.state?.DriverList ?? {})) {
							if (!driver.RacingNumber) continue;
							const raw = getDriverPositionAt(driver.RacingNumber, time);
							if (!raw) continue;
							const point = rawToGeo(raw.X, raw.Y);
							if (!point) continue;
							let marker = markers.get(driver.RacingNumber);
							if (!marker) {
								const element = document.createElement("div");
								element.className = "live-geographic-car";
								element.style.setProperty("--car-color", "#" + (driver.TeamColour || "ffffff"));
								const dot = document.createElement("i");
								const label = document.createElement("span");
								label.textContent = driver.Tla;
								element.append(dot, label);
								element.dataset.driver = driver.RacingNumber;
								marker = new maplibregl.Marker({
									element,
									anchor: "center",
									pitchAlignment: "viewport",
									rotationAlignment: "viewport",
								})
									.setLngLat(point)
									.addTo(map);
								markers.set(driver.RacingNumber, marker);
							}
							marker.setLngLat(point);
							const element = marker.getElement();
							element.classList.toggle("show-code", options.labels);
							element.classList.toggle("car-selected", driver.RacingNumber === options.driver);
							element.classList.toggle(
								"show-model",
								map.getZoom() >= 17 || ["heli", "chase", "onboard"].includes(options.view),
							);
							if (driver.RacingNumber === options.driver && ["heli", "chase", "onboard"].includes(options.view)) {
								const previous = previousCoordinates.get(driver.RacingNumber);
								if (
									(state.carsData?.[driver.RacingNumber]?.Channels[2] ?? 0) > 3 &&
									previous &&
									Math.hypot(point[0] - previous[0], point[1] - previous[1]) > 0.0000001
								) {
									const angle =
										(Math.atan2(
											(point[0] - previous[0]) * Math.cos((point[1] * Math.PI) / 180),
											point[1] - previous[1],
										) *
											180) /
										Math.PI;
									const delta = ((angle - lastFollowBearing + 540) % 360) - 180;
									lastFollowBearing += delta * 0.06;
								}
								const trailing =
									options.view === "heli" ? 40 / options.zoom : options.view === "chase" ? 18 / options.zoom : 0.7;
								const altitude =
									options.view === "heli" ? 75 / options.zoom : options.view === "chase" ? 4.5 / options.zoom : 1.35;
								const direction = (lastFollowBearing * Math.PI) / 180;
								const eye: [number, number] = [
									point[0] - (Math.sin(direction) * trailing) / (111320 * Math.cos((point[1] * Math.PI) / 180)),
									point[1] - (Math.cos(direction) * trailing) / 111320,
								];
								const pitch = options.view === "onboard" ? 85 : (Math.atan2(trailing, altitude) * 180) / Math.PI;
								map.jumpTo(
									map.calculateCameraOptionsFromCameraLngLatAltRotation(eye, altitude, lastFollowBearing, pitch, 0),
								);
							}
							previousCoordinates.set(driver.RacingNumber, point);
						}
						if (
							(options.view === "global" || options.view === "top" || !options.driver) &&
							(lastView !== options.view || lastZoom !== options.zoom)
						) {
							map.fitBounds(bounds, {
								padding: 42,
								pitch: options.view === "top" ? 0 : 48,
								bearing: options.view === "top" ? 0 : -20,
								duration: 0,
							});
							map.setZoom(map.getZoom() + Math.log2(options.zoom));
						}
						lastView = options.view;
						lastZoom = options.zoom;
						if (now - lastData > 500) {
							map.setLayoutProperty("circuit-turn-labels", "visibility", options.corners ? "visible" : "none");
							if (map.getLayer("circuit-buildings"))
								map.setLayoutProperty("circuit-buildings", "visibility", options.shadows ? "visible" : "none");
							let lighting: string = options.lighting;
							if (lighting === "realtime") {
								const stamp = state.state?.ExtrapolatedClock?.Utc;
								let date = stamp ? new Date(stamp.endsWith("Z") ? stamp : stamp + "Z") : new Date();
								const info = state.state?.SessionInfo;
								const offset = Number(info?.GmtOffset?.split(":")[0] ?? 0);
								if (
									["Finished", "Finalised", "Ends"].includes(state.state?.SessionStatus?.Status || "") &&
									info?.EndDate
								) {
									const suffix =
										info.GmtOffset.startsWith("-") || info.GmtOffset.startsWith("+")
											? info.GmtOffset.slice(0, 6)
											: "+" + info.GmtOffset.slice(0, 5);
									const ending = Date.parse(
										/[Z]|[+-]\d\d:\d\d$/.test(info.EndDate) ? info.EndDate : info.EndDate + suffix,
									);
									if (Number.isFinite(ending)) date = new Date(Math.min(date.getTime(), ending));
								}
								const hour = (date.getUTCHours() + offset + date.getUTCMinutes() / 60 + 24) % 24;
								lighting = hour < 6 || hour >= 19 ? "night" : hour < 7 ? "sunrise" : hour >= 18 ? "sunset" : "day";
							}
							if (lighting !== lastLighting) {
								const night = lighting === "night";
								const warm = lighting === "sunrise" || lighting === "sunset";
								map.setLight({
									anchor: "map",
									color: "#ffffff",
									intensity: night ? 0.12 : warm ? 0.18 : 0.24,
									position: [1.2, warm ? 235 : 210, warm ? 75 : 40],
								});

								lastLighting = lighting;
							}
							const trackStatus = state.state?.TrackStatus?.Status;
							const flags = resolveTrackFlags(state.state?.RaceControlMessages?.Messages);
							const tone = getTrackFlagTone(flags, trackStatus);
							const colors = { clear: "#f1f5f9", yellow: "#eab308", red: "#ef4444", safety: "#fb923c" };
							map.setPaintProperty("circuit-edge", "line-color", colors[tone]);
							const sectors =
								tone === "clear"
									? Array.from(flags.sectors).filter(
											(sector) => getTrackFlagTone(flags, trackStatus, sector) === "yellow",
										)
									: [];
							map.setPaintProperty("circuit-local-yellow", "line-opacity", [
								"case",
								["in", ["get", "sector"], ["literal", sectors]],
								1,
								0,
							]);
							lastData = now;
						}
						frame = requestAnimationFrame(loop);
					};
					frame = requestAnimationFrame(loop);
				});
				const observer = new ResizeObserver(() => {
					map.resize();
					const options = optionsRef.current;
					if (options.view === "global" || options.view === "top" || !options.driver) {
						map.fitBounds(bounds, {
							padding: 42,
							pitch: options.view === "top" ? 0 : 48,
							bearing: options.view === "top" ? 0 : -20,
							duration: 0,
						});
						map.setZoom(map.getZoom() + Math.log2(options.zoom));
					}
				});
				observer.observe(container);
				cleanup = () => {
					cancelAnimationFrame(frame);
					observer.disconnect();
					markers.forEach((marker) => marker.remove());
					map.remove();
				};
			})
			.catch(() => {
				if (!cancelled) setError("Circuit geography is temporarily unavailable. The 2D map remains available.");
			});
		return () => {
			cancelled = true;
			cleanup?.();
		};
	}, [reference?.circuit]);
	return (
		<div ref={containerRef} className="live-geographic-scene" aria-label="Geographic 3D track map">
			{!reference?.circuit && <span className="live-map-error">Loading circuit map…</span>}
			{error && <span className="live-map-error">{error}</span>}
		</div>
	);
}
