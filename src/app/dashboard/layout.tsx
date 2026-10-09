"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import LegacyDashboardChrome from "@/components/live/LegacyDashboardChrome";
import { useDataEngine } from "@/hooks/useDataEngine";
import { useWakeLock } from "@/hooks/useWakeLock";
import { useStores } from "@/hooks/useStores";
import { useSocket } from "@/hooks/useSocket";
import { LiveConnectionContext } from "@/components/live/LiveConnection";
export default function DashboardLayout({ children }: { children: ReactNode }) {
	const stores = useStores();
	const { handleInitial, handleUpdate, maxDelay } = useDataEngine(stores);
	const { connected } = useSocket({ handleInitial, handleUpdate });
	useWakeLock();
	const pathname = usePathname();
	return (
		<LiveConnectionContext.Provider value={connected}>
			{pathname === "/dashboard" ? (
				children
			) : (
				<LegacyDashboardChrome connected={connected} maxDelay={maxDelay}>
					{children}
				</LegacyDashboardChrome>
			)}
		</LiveConnectionContext.Provider>
	);
}
