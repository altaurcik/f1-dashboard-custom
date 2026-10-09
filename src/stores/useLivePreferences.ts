"use client";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CameraView } from "@/types/live-view.type";
export type LiveLayout = "stacked" | "side" | "columns";
type Preferences = {
	notifications: boolean;
	desktopNotifications: boolean;
	layout: LiveLayout;
	theme: "dark" | "light";
	compact: boolean;
	sidebar: boolean;
	mode: "2d" | "3d";
	camera: CameraView;
	zoom: number;
	labels: boolean;
	corners: boolean;
	shadows: boolean;
	lighting: "realtime" | "day" | "sunrise" | "sunset" | "night";
	selected: string[];
	update: (partial: Partial<Omit<Preferences, "update" | "select">>) => void;
	select: (number: string) => void;
};
export const useLivePreferences = create<Preferences>()(
	persist(
		(set) => ({
			notifications: true,
			desktopNotifications: false,
			layout: "side",
			theme: "dark",
			compact: false,
			sidebar: true,
			mode: "3d",
			camera: "global",
			zoom: 1,
			labels: true,
			corners: false,
			shadows: true,
			lighting: "realtime",
			selected: [],
			update: (partial) => set(partial),
			select: (number) =>
				set((s) => ({
					selected: s.selected.includes(number)
						? s.selected.filter((value) => value !== number)
						: [...s.selected.slice(-1), number],
				})),
		}),
		{
			name: "live-timing-preferences",
			version: 1,
			// Enable newly positioned codes once for existing preferences; subsequent choices persist.
			migrate: (state) => ({ ...(state as Preferences), labels: true }),
			skipHydration: true,
			partialize: (state) => ({ ...state, selected: [] }),
		},
	),
);
