"""Recorded-style answers of an IQ Gateway (values made up)."""

import base64
import json
import time

SERIAL = "122233344455"

INFO_XML = f"""<?xml version='1.0' encoding='UTF-8'?>
<envoy_info>
  <time>1793650000</time>
  <device>
    <sn>{SERIAL}</sn>
    <pn>800-00654-r08</pn>
    <software>D8.2.4382</software>
    <euaid>4c8675</euaid>
    <seqnum>0</seqnum>
    <apiver>1</apiver>
    <imeter>true</imeter>
  </device>
</envoy_info>"""

INFO_XML_V5 = INFO_XML.replace("D8.2.4382", "R5.0.62")


def make_token(exp_offset: int = 365 * 86400) -> str:
    def b64(obj):
        return base64.urlsafe_b64encode(json.dumps(obj).encode()).decode().rstrip("=")

    return ".".join(
        [
            b64({"alg": "ES256", "kid": "x"}),
            b64({"aud": SERIAL, "enphaseUser": "owner", "exp": int(time.time()) + exp_offset}),
            "c2lnbmF0dXJl",
        ]
    )


def _line(w, v, a, lifetime):
    return {"wNow": w, "rmsVoltage": v, "rmsCurrent": a, "whLifetime": lifetime, "whToday": 1000}


PRODUCTION_METERED = {
    "production": [
        {"type": "inverters", "activeCount": 16, "readingTime": 1793650000, "wNow": 2950, "whLifetime": 0},
        {
            "type": "eim",
            "activeCount": 1,
            "measurementType": "production",
            "readingTime": 1793650010,
            "wNow": 3012.4,
            "whLifetime": 12345678.0,
            "rmsCurrent": 13.2,
            "rmsVoltage": 690.6,
            "whToday": 8123.0,
            "whLastSevenDays": 61234.0,
            "lines": [
                _line(1004.1, 230.1, 4.4, 4100000),
                _line(1003.3, 230.4, 4.4, 4120000),
                _line(1005.0, 230.1, 4.4, 4125678),
            ],
        },
    ],
    "consumption": [
        {
            "type": "eim",
            "activeCount": 1,
            "measurementType": "total-consumption",
            "wNow": 812.0,
            "whLifetime": 9876543.0,
            "whToday": 5432.0,
            "lines": [_line(300, 230, 1.3, 1), _line(250, 230, 1.1, 1), _line(262, 230, 1.2, 1)],
        },
        {
            "type": "eim",
            "activeCount": 1,
            "measurementType": "net-consumption",
            "wNow": -2200.4,
            "whLifetime": 100.0,
            "lines": [_line(-704, 230, 3, 1), _line(-753, 230, 3, 1), _line(-743, 230, 3, 1)],
        },
    ],
    "storage": [{"type": "acb", "activeCount": 0, "wNow": 0, "whNow": 0, "state": "idle"}],
}

PRODUCTION_NOT_METERED = {
    "production": [
        {"type": "inverters", "activeCount": 10, "readingTime": 1793650000, "wNow": -3, "whLifetime": 5000000},
        {"type": "eim", "activeCount": 0, "measurementType": "production", "wNow": 0, "whLifetime": 0, "lines": []},
    ],
    "consumption": [
        {"type": "eim", "activeCount": 0, "measurementType": "total-consumption", "wNow": 0},
    ],
}

API_V1 = {"wattHoursToday": 7000, "wattHoursSevenDays": 50000, "wattHoursLifetime": 5000100, "wattsNow": 0}

INVERTERS = [
    {"serialNumber": "482211000001", "lastReportDate": 1793649900, "devType": 1, "lastReportWatts": 188, "maxReportWatts": 295},
    {"serialNumber": "482211000002", "lastReportDate": 1793649900, "devType": 1, "lastReportWatts": 190, "maxReportWatts": 296},
]
