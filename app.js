const drivers = [
	["LEC", "Charles Leclerc", "Ferrari", "#ed1131", "1:12.351", "-"],
	["VER", "Max Verstappen", "Red Bull Racing", "#4781d7", "1:12.499", "+0.148"],
	["NOR", "Lando Norris", "McLaren", "#f47600", "1:12.541", "+0.190"],
	["PIA", "Oscar Piastri", "McLaren", "#f47600", "1:12.668", "+0.317"],
	["RUS", "George Russell", "Mercedes", "#00d7b6", "1:12.732", "+0.381"],
	["HAM", "Lewis Hamilton", "Ferrari", "#ed1131", "1:12.830", "+0.479"],
	["ANT", "Kimi Antonelli", "Mercedes", "#00d7b6", "1:12.911", "+0.560"],
	["SAI", "Carlos Sainz", "Williams", "#1868db", "1:13.005", "+0.654"],
	["ALB", "Alexander Albon", "Williams", "#1868db", "1:13.084", "+0.733"],
	["HAD", "Isack Hadjar", "Racing Bulls", "#6c98ff", "1:13.117", "+0.766"],
	["GAS", "Pierre Gasly", "Alpine", "#00a1e8", "1:13.290", "+0.939"],
	["LAW", "Liam Lawson", "Racing Bulls", "#6c98ff", "1:13.344", "+0.993"],
	["HUL", "Nico Hulkenberg", "Audi", "#f50537", "1:13.421", "+1.070"],
	["ALO", "Fernando Alonso", "Aston Martin", "#229971", "1:13.487", "+1.136"],
	["OCO", "Esteban Ocon", "Haas", "#9c9fa2", "1:13.552", "+1.201"],
	["BEA", "Oliver Bearman", "Haas", "#9c9fa2", "1:13.809", "+1.458"],
	["COL", "Franco Colapinto", "Alpine", "#00a1e8", "1:13.994", "+1.643"],
	["PER", "Sergio Perez", "Cadillac", "#909090", "1:14.226", "+1.875"],
	["BOT", "Valtteri Bottas", "Cadillac", "#909090", "1:14.604", "+2.253"],
	["STR", "Lance Stroll", "Aston Martin", "#229971", "1:15.019", "+2.668"],
	["BOR", "Gabriel Bortoleto", "Audi", "#f50537", "1:15.241", "+2.890"],
	["LIN", "Arvid Lindblad", "Racing Bulls", "#6c98ff", "1:15.532", "+3.181"],
];

const raceControl = [
	["23:31:08", "RISK OF RAIN FOR QUALIFYING IS 0%", "green"],
	["23:24:22", "GREEN LIGHT - PIT EXIT OPEN", "green"],
	["23:23:05", "CAR 63 TIME DELETED - TRACK LIMITS AT TURN 10", "yellow"],
	["23:29:36", "CAR 63 TIME DELETED - TRACK LIMITS AT TURN 10", "yellow"],
	["23:30:14", "CAR 11 TIME DELETED - TRACK LIMITS AT TURN 10", "yellow"],
];

const radios = [
	["LEC", "23:32", "Garage confirms mode push, target lap now"],
	["VER", "23:31", "Traffic update before final sector"],
	["NOR", "23:30", "Box opposite next lap if needed"],
	["RUS", "23:29", "Recharge on entry, push from line"],
];

const carPositions = [
	[742, 530],
	[640, 356],
	[418, 153],
	[154, 145],
	[121, 404],
	[373, 337],
	[468, 520],
	[774, 535],
];

function renderDrivers() {
	const root = document.querySelector("#drivers");
	root.innerHTML = drivers
		.map(([code, name, team, color, lap, gap], index) => {
			return `
				<article class="driver-row">
					<div class="tag" style="background:${color}">
						${index + 1}
						<span style="color:${color}">${code}</span>
					</div>
					<div class="driver-name">
						<strong>${name}</strong>
						<small>${team}</small>
					</div>
					<div class="lap-time">${lap}</div>
					<div class="gap">${gap}</div>
				</article>
			`;
		})
		.join("");
}

function renderMap() {
	const root = document.querySelector("#cars");
	root.innerHTML = carPositions
		.map(([x, y], index) => {
			const [code, , , color] = drivers[index];
			return `
				<g class="car" transform="translate(${x} ${y})">
					<circle r="13" fill="${color}" />
					<text x="19" y="8" fill="${color}">${code}</text>
				</g>
			`;
		})
		.join("");
}

function renderRaceControl() {
	document.querySelector("#race-control").innerHTML = raceControl
		.map(([time, message, flag]) => {
			return `
				<li class="message">
					<span class="time">${time}</span>
					<strong>${message}</strong>
					<span class="flag-dot ${flag === "yellow" ? "yellow" : ""}"></span>
				</li>
			`;
		})
		.join("");
}

function renderRadios() {
	document.querySelector("#radio").innerHTML = radios
		.map(([code, time, label]) => {
			const driver = drivers.find((item) => item[0] === code);
			const color = driver?.[3] ?? "#777";
			return `
				<li class="radio">
					<div class="tag" style="background:${color}"><span style="color:${color}">${code}</span></div>
					<div class="play">▶</div>
					<div class="wave" title="${label}"></div>
					<span class="time">${time}</span>
				</li>
			`;
		})
		.join("");
}

function tickClock() {
	const clock = document.querySelector("#clock");
	let seconds = 522;
	setInterval(() => {
		seconds = Math.max(0, seconds - 1);
		const m = String(Math.floor(seconds / 60)).padStart(2, "0");
		const s = String(seconds % 60).padStart(2, "0");
		clock.textContent = `00:${m}:${s}`;
	}, 1000);
}

renderDrivers();
renderMap();
renderRaceControl();
renderRadios();
tickClock();
