import type { ComparisonHistory } from "@/lib/driverComparison";
import type { CarsData, Positions, State } from "@/types/state.type";

import { useDataStore } from "@/stores/useDataStore";

type Fns = {
	updateComparison: (history: ComparisonHistory) => void;
	updateState: (state: State) => void;
	updatePosition: (pos: Positions) => void;
	updateCarData: (car: CarsData) => void;
};

export const useStores = (): Fns => {
	const dataStore = useDataStore();

	return {
		updateComparison: (v) => dataStore.setComparison(v),
		updateState: (v) => dataStore.setState(v),
		updatePosition: (v) => dataStore.setPositions(v),
		updateCarData: (v) => dataStore.setCarsData(v),
	};
};
