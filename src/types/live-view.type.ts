export type CameraView = "global" | "top" | "heli" | "chase" | "onboard";
export type SceneSettings = {
	labels: boolean;
	corners: boolean;
	shadows: boolean;
	lighting: "realtime" | "day" | "sunrise" | "sunset" | "night";
	zoom: number;
	view: CameraView;
	driver: string | null;
};
