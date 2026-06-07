from __future__ import annotations

import base64
import json
import time
import zlib
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


DRIVERS = [
    ("16", "LEC", "Charles Leclerc", "Ferrari", "ED1131"),
    ("1", "NOR", "Lando Norris", "McLaren", "F47600"),
    ("81", "PIA", "Oscar Piastri", "McLaren", "F47600"),
    ("3", "VER", "Max Verstappen", "Red Bull Racing", "4781D7"),
    ("63", "RUS", "George Russell", "Mercedes", "00D7B6"),
    ("44", "HAM", "Lewis Hamilton", "Ferrari", "ED1131"),
    ("12", "ANT", "Kimi Antonelli", "Mercedes", "00D7B6"),
    ("55", "SAI", "Carlos Sainz", "Williams", "1868DB"),
    ("23", "ALB", "Alexander Albon", "Williams", "1868DB"),
    ("6", "HAD", "Isack Hadjar", "Racing Bulls", "6C98FF"),
    ("10", "GAS", "Pierre Gasly", "Alpine", "00A1E8"),
    ("30", "LAW", "Liam Lawson", "Racing Bulls", "6C98FF"),
    ("27", "HUL", "Nico Hulkenberg", "Audi", "F50537"),
    ("14", "ALO", "Fernando Alonso", "Aston Martin", "229971"),
    ("31", "OCO", "Esteban Ocon", "Haas F1 Team", "9C9FA2"),
    ("87", "BEA", "Oliver Bearman", "Haas F1 Team", "9C9FA2"),
    ("43", "COL", "Franco Colapinto", "Alpine", "00A1E8"),
    ("11", "PER", "Sergio Perez", "Cadillac", "909090"),
    ("77", "BOT", "Valtteri Bottas", "Cadillac", "909090"),
    ("18", "STR", "Lance Stroll", "Aston Martin", "229971"),
    ("5", "BOR", "Gabriel Bortoleto", "Audi", "F50537"),
    ("41", "LIN", "Arvid Lindblad", "Racing Bulls", "6C98FF"),
]

LAP_TIMES = [
    "1:12.351",
    "1:12.499",
    "1:12.541",
    "1:12.668",
    "1:12.732",
    "1:12.830",
    "1:12.911",
    "1:13.005",
    "1:13.084",
    "1:13.117",
    "1:13.290",
    "1:13.344",
    "1:13.421",
    "1:13.487",
    "1:13.552",
    "1:13.809",
    "1:13.994",
    "1:14.226",
    "1:14.604",
    "1:15.019",
    "1:15.241",
    "1:15.532",
]


def seconds(lap_time: str) -> float:
    minutes, rest = lap_time.split(":")
    return int(minutes) * 60 + float(rest)


def iso(offset: float = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=offset)).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def deflate_raw_b64(data: Any) -> str:
    raw = json.dumps(data, separators=(",", ":")).encode("utf-8")
    compressor = zlib.compressobj(level=6, wbits=-zlib.MAX_WBITS)
    return base64.b64encode(compressor.compress(raw) + compressor.flush()).decode("ascii")


def driver_list() -> dict[str, dict[str, Any]]:
    result = {}
    for line, (number, tla, full, team, color) in enumerate(DRIVERS, 1):
        first, last = full.split(" ", 1)
        result[number] = {
            "RacingNumber": number,
            "BroadcastName": f"{first[0]} {last}".upper(),
            "FullName": full,
            "Tla": tla,
            "Line": line,
            "TeamName": team,
            "TeamColour": color,
            "FirstName": first,
            "LastName": last,
            "Reference": tla,
            "HeadshotUrl": "",
            "CountryCode": "",
        }
    return result


def sector(status: int, value: str = "", purple: bool = False, green: bool = False) -> dict[str, Any]:
    return {
        "Stopped": False,
        "Value": value,
        "PreviousValue": "",
        "Status": status,
        "OverallFastest": purple,
        "PersonalFastest": green or purple,
        "Segments": [{"Status": status} for _ in range(6)],
    }


def timing_data(tick: int) -> dict[str, Any]:
    fastest = seconds(LAP_TIMES[0])
    lines = {}
    for idx, (number, _tla, _full, _team, _color) in enumerate(DRIVERS):
        pos = idx + 1
        lap = LAP_TIMES[idx]
        diff = seconds(lap) - fastest
        gap = lap if pos == 1 else f"+{diff:.3f}"
        interval = "" if pos == 1 else f"+{max(0.08, diff / 2):.3f}"
        moving = (tick + idx) % 3
        seg_status = [2049, 2051, 2048][moving]
        lines[number] = {
            "GapToLeader": gap,
            "IntervalToPositionAhead": {"Value": interval, "Catching": idx % 5 == 0},
            "Line": pos,
            "Position": str(pos),
            "ShowPosition": True,
            "RacingNumber": number,
            "Retired": False,
            "InPit": idx in {17, 20},
            "PitOut": idx in {6, 11},
            "Stopped": False,
            "Status": 1,
            "Sectors": [
                sector(2049 if idx % 4 else 2051, "18.3" if idx < 12 else "", purple=idx == 0, green=idx % 4 == 1),
                sector(seg_status, "34.7" if idx < 10 else "", purple=idx == 1, green=idx % 3 == 0),
                sector(2048 if idx > 8 else 2049, "19.2" if idx < 8 else "", green=idx % 2 == 0),
            ],
            "Speeds": {
                "I1": {"Value": str(244 + idx), "Status": 0, "OverallFastest": False, "PersonalFastest": False},
                "I2": {"Value": str(261 + idx), "Status": 0, "OverallFastest": False, "PersonalFastest": False},
                "Fl": {"Value": str(278 + idx), "Status": 0, "OverallFastest": False, "PersonalFastest": False},
                "St": {"Value": str(292 + idx), "Status": 0, "OverallFastest": False, "PersonalFastest": False},
            },
            "BestLapTime": {"Value": lap, "Position": pos},
            "LastLapTime": {"Value": lap if idx < 18 else "", "Status": 0, "OverallFastest": idx == 0, "PersonalFastest": idx < 6},
            "NumberOfLaps": 4 + (idx % 6),
            "KnockedOut": idx > 14,
        }
    return {"Lines": lines, "Withheld": False, "SessionPart": 3}


def timing_app_data() -> dict[str, Any]:
    compounds = ["SOFT", "SOFT", "MEDIUM", "SOFT", "MEDIUM", "SOFT"]
    return {
        "Lines": {
            number: {
                "RacingNumber": number,
                "Line": idx + 1,
                "GridPos": str(idx + 1),
                "Stints": [{"Compound": compounds[idx % len(compounds)], "TotalLaps": 4 + idx % 6, "New": "TRUE"}],
            }
            for idx, (number, *_rest) in enumerate(DRIVERS)
        }
    }


def timing_stats(td: dict[str, Any]) -> dict[str, Any]:
    return {
        "Withheld": False,
        "Lines": {
            number: {
                "Line": line["Line"],
                "RacingNumber": number,
                "PersonalBestLapTime": line["BestLapTime"],
                "BestSectors": [
                    {"Value": "18.121", "Position": 1 if line["Line"] == 1 else line["Line"]},
                    {"Value": "34.442", "Position": 1 if line["Line"] == 2 else line["Line"]},
                    {"Value": "19.074", "Position": 1 if line["Line"] == 3 else line["Line"]},
                ],
                "BestSpeeds": {
                    "I1": {"Value": "254", "Position": line["Line"]},
                    "I2": {"Value": "271", "Position": line["Line"]},
                    "Fl": {"Value": "283", "Position": line["Line"]},
                    "St": {"Value": "301", "Position": line["Line"]},
                },
            }
            for number, line in td["Lines"].items()
        },
        "SessionType": "Qualifying",
        "_kf": False,
    }


def car_data(tick: int) -> dict[str, Any]:
    cars = {}
    for idx, (number, *_rest) in enumerate(DRIVERS):
        cars[number] = {
            "Channels": {
                "0": 9000 + idx * 133,
                "2": 180 + ((tick * 7 + idx * 9) % 125),
                "3": 2 + ((tick + idx) % 6),
                "4": (tick * 5 + idx * 11) % 101,
                "5": 1 if (tick + idx) % 7 == 0 else 0,
                "45": 12 if idx < 10 and tick % 4 > 1 else 8,
            }
        }
    return {"Entries": [{"Utc": iso(), "Cars": cars}]}


def race_control() -> dict[str, Any]:
    return {
        "Messages": [
            {"Utc": iso(-240), "Lap": 1, "Message": "RISK OF RAIN FOR QUALIFYING IS 0%", "Category": "Other"},
            {"Utc": iso(-190), "Lap": 1, "Message": "GREEN LIGHT - PIT EXIT OPEN", "Category": "Flag", "Flag": "GREEN"},
            {"Utc": iso(-120), "Lap": 3, "Message": "CAR 63 (RUS) TIME 1:33.532 DELETED - TRACK LIMITS AT TURN 10", "Category": "Other"},
            {"Utc": iso(-88), "Lap": 4, "Message": "CAR 11 (PER) TIME 1:30.897 DELETED - TRACK LIMITS AT TURN 10", "Category": "Other"},
            {"Utc": iso(-42), "Lap": 5, "Message": "YELLOW FLAG IN SECTOR 2", "Category": "Flag", "Flag": "YELLOW", "Scope": "Sector", "Sector": 2},
        ]
    }


def team_radio() -> dict[str, Any]:
    return {
        "Captures": [
            {"Utc": iso(-160), "RacingNumber": "16", "Path": "/TeamRadio/LEC_001.mp3"},
            {"Utc": iso(-138), "RacingNumber": "1", "Path": "/TeamRadio/NOR_001.mp3"},
            {"Utc": iso(-96), "RacingNumber": "3", "Path": "/TeamRadio/VER_001.mp3"},
            {"Utc": iso(-52), "RacingNumber": "63", "Path": "/TeamRadio/RUS_001.mp3"},
        ]
    }


def full_state(tick: int = 0) -> dict[str, Any]:
    td = timing_data(tick)
    now = iso()
    return {
        "Heartbeat": {"Utc": now},
        "ExtrapolatedClock": {"Utc": now, "Remaining": "00:08:42.000", "Extrapolating": False},
        "TimingStats": timing_stats(td),
        "TimingAppData": timing_app_data(),
        "WeatherData": {
            "AirTemp": "25",
            "Humidity": "54",
            "Pressure": "1013",
            "Rainfall": "0",
            "TrackTemp": "34",
            "WindDirection": "180",
            "WindSpeed": "2.8",
        },
        "TrackStatus": {"Status": "1", "Message": "Track Clear"},
        "SessionStatus": {"Status": "Started"},
        "DriverList": driver_list(),
        "RaceControlMessages": race_control(),
        "SessionInfo": {
            "Meeting": {
                "Key": 6,
                "Name": "Monaco Grand Prix",
                "OfficialName": "FORMULA 1 GRAND PRIX DE MONACO",
                "Location": "Monte Carlo",
                "Country": {"Key": 6, "Code": "mon", "Name": "Monaco"},
                "Circuit": {"Key": 6, "ShortName": "Monte Carlo"},
            },
            "ArchiveStatus": {"Status": "Generating"},
            "Key": 6,
            "Type": "Qualifying",
            "Name": "Qualifying",
            "StartDate": now,
            "EndDate": iso(900),
            "GmtOffset": "00:00:00",
            "Path": "2026/2026-06-07_Monaco_Grand_Prix/2026-06-07_Qualifying/",
            "Number": 6,
        },
        "SessionData": {"Series": [{"Utc": now, "Lap": 1}], "StatusSeries": [{"Utc": now, "TrackStatus": "1"}]},
        "LapCount": {"CurrentLap": 1, "TotalLaps": 1},
        "TimingData": td,
        "TeamRadio": team_radio(),
        "CarDataZ": deflate_raw_b64(car_data(tick)),
    }


def sse_event(name: str, data: Any) -> bytes:
    return f"event: {name}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n".encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def do_OPTIONS(self) -> None:
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path.startswith("/api/health"):
            self.send_response(200)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
            return

        if not self.path.startswith("/api/realtime"):
            self.send_response(404)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            return

        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Content-Type", "text/event-stream")
        self.end_headers()

        tick = 0
        try:
            self.wfile.write(sse_event("initial", full_state(tick)))
            self.wfile.flush()
            while True:
                tick += 1
                self.wfile.write(sse_event("update", full_state(tick)))
                self.wfile.flush()
                time.sleep(1)
        except (BrokenPipeError, ConnectionResetError):
            pass


if __name__ == "__main__":
    print("Mock realtime listening on http://127.0.0.1:4000/api/realtime")
    ThreadingHTTPServer(("127.0.0.1", 4000), Handler).serve_forever()
