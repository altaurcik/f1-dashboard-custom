import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MercatorCoordinate, type CustomLayerInterface, type Map as GeographicMap } from "maplibre-gl";
import { useDataStore } from "@/stores/useDataStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { getDriverPositionAt, getPositionTime } from "@/lib/positionTimeline";
import type { SceneSettings } from "@/types/live-view.type";
let modelPromise: Promise<THREE.Group> | null = null;
function loadModel() {
	modelPromise ??= new Promise<THREE.Group>((resolve, reject) =>
		new GLTFLoader().load("/models/f1-2026-simplified.glb", (gltf) => resolve(gltf.scene), undefined, reject),
	);
	return modelPromise;
}
export function createVehicleLayer(
	center: [number, number],
	project: (x: number, y: number) => [number, number] | null,
	options: () => SceneSettings,
): CustomLayerInterface {
	const scene = new THREE.Scene();
	const camera = new THREE.Camera();
	const anchor = MercatorCoordinate.fromLngLat(center, 0);
	const scale = anchor.meterInMercatorCoordinateUnits();
	const transform = new THREE.Matrix4()
		.makeTranslation(anchor.x, anchor.y, anchor.z)
		.scale(new THREE.Vector3(scale, -scale, scale));
	const vehicles = new Map<string, THREE.Group>();
	const previous = new Map<string, [number, number]>();
	const materials = new Set<THREE.Material>();
	let renderer: THREE.WebGLRenderer | undefined;
	let map: GeographicMap;
	let template: THREE.Group | null = null;
	let disposed = false;
	scene.add(new THREE.AmbientLight(0xffffff, 2.4));
	const sun = new THREE.DirectionalLight(0xffffff, 2);
	sun.position.set(300, 400, 500);
	scene.add(sun);
	return {
		id: "live-f1-vehicles",
		type: "custom",
		renderingMode: "3d",
		onAdd(host, gl) {
			map = host;
			renderer = new THREE.WebGLRenderer({ canvas: host.getCanvas(), context: gl, antialias: true });
			renderer.autoClear = false;
			void loadModel()
				.then((model) => {
					if (!disposed) {
						template = model;
						host.triggerRepaint();
					}
				})
				.catch(() => {});
		},
		render(_gl, input) {
			if (!renderer || !template || disposed) return;
			const config = options();
			const showModels = map.getZoom() >= 17 || ["heli", "chase", "onboard"].includes(config.view);
			if (!showModels) return;
			const data = useDataStore.getState();
			const time = getPositionTime(useSettingsStore.getState().delay);
			for (const driver of Object.values(data.state?.DriverList ?? {})) {
				if (!driver.RacingNumber) continue;
				const raw = getDriverPositionAt(driver.RacingNumber, time);
				if (!raw) continue;
				const coordinate = project(raw.X, raw.Y);
				if (!coordinate) continue;
				let vehicle = vehicles.get(driver.RacingNumber);
				if (!vehicle) {
					vehicle = new THREE.Group();
					const model = template.clone(true);
					// The GLB nose points along +Z; align it with map north (+Y) after converting Y-up to Z-up.
					model.rotation.set(Math.PI / 2, Math.PI, 0);
					model.traverse((object) => {
						if (object instanceof THREE.Mesh) {
							const originals = Array.isArray(object.material) ? object.material : [object.material];
							const clones = originals.map((material) => {
								const clone = material.clone();
								materials.add(clone);
								if (clone instanceof THREE.MeshStandardMaterial && material.name === "orange")
									clone.color.set("#" + (driver.TeamColour || "ffffff"));
								return clone;
							});
							object.material = Array.isArray(object.material) ? clones : clones[0];
						}
					});
					vehicle.add(model);
					scene.add(vehicle);
					vehicles.set(driver.RacingNumber, vehicle);
				}
				const point = MercatorCoordinate.fromLngLat(coordinate, 0);
				vehicle.position.set((point.x - anchor.x) / scale, -(point.y - anchor.y) / scale, 0.24);
				const last = previous.get(driver.RacingNumber);
				if (
					last &&
					(data.carsData?.[driver.RacingNumber]?.Channels[2] ?? 0) > 3 &&
					Math.hypot(coordinate[0] - last[0], coordinate[1] - last[1]) > 0.0000001
				)
					vehicle.rotation.z = -Math.atan2(
						(coordinate[0] - last[0]) * Math.cos((coordinate[1] * Math.PI) / 180),
						coordinate[1] - last[1],
					);
				previous.set(driver.RacingNumber, coordinate);
				vehicle.visible =
					!config.driver || ["global", "top"].includes(config.view) || driver.RacingNumber === config.driver;
				const compound = data.state?.TimingAppData?.Lines[driver.RacingNumber]?.Stints?.at(-1)?.Compound;
				const colors = { SOFT: "#ff3333", MEDIUM: "#ffdc18", HARD: "#ffffff", INTERMEDIATE: "#2ac86b", WET: "#3399ff" };
				vehicle.traverse((object) => {
					if (
						object instanceof THREE.Mesh &&
						object.material instanceof THREE.MeshStandardMaterial &&
						object.material.name === "tyre-compound"
					)
						object.material.color.set(compound && compound in colors ? colors[compound] : "#aeb8c8");
				});
			}
			camera.projectionMatrix.fromArray(input.defaultProjectionData.mainMatrix).multiply(transform);
			renderer.resetState();
			renderer.render(scene, camera);
			renderer.resetState();
			// Keep the custom layer animating between incoming position samples.
			map.triggerRepaint();
		},
		onRemove() {
			disposed = true;
			materials.forEach((material) => material.dispose());
			renderer?.dispose();
			scene.clear();
		},
	};
}
