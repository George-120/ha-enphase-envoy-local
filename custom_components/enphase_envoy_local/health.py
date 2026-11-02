"""Panel health: compare every microinverter with its neighbours.

Panels on the same roof surface (array in the Enlighten layout) get the same
sun, so a panel that keeps producing clearly less than the good panels next
to it has a problem: shade, dirt, a broken panel or a failing inverter.

The reference is the median of the better half of the roof surface, so one
exceptionally good panel does not make all others look bad, and the score is
capped at 100 %: a panel cannot be healthier than healthy.
"""

from __future__ import annotations

from datetime import datetime
from statistics import median

from .api import EnvoyData

MIN_TODAY_WH = 200  # below this the day has hardly started
MIN_WEEK_WH = 1000
MIN_POWER_W = 50
MIN_GROUP = 3


def array_of(layout: dict | None) -> dict[str, str]:
    """Serial -> roof surface label."""
    out: dict[str, str] = {}
    for arr in (layout or {}).get("arrays") or []:
        for mod in arr.get("modules") or []:
            if mod.get("serial"):
                out[str(mod["serial"])] = arr.get("label") or ""
    return out


def _ratio(value: float | None, ref: float) -> float | None:
    if value is None or not ref:
        return None
    return round(min(value / ref * 100, 100.0), 1)


def _reference(values: list[float]) -> float:
    """Median of the better half: what a good panel on this roof makes."""
    mid = median(values)
    return median([v for v in values if v >= mid])


def apply_health(data: EnvoyData, layout: dict | None, threshold: float) -> None:
    """Fill performance, underperforming and no_output on every inverter."""
    arrays = array_of(layout)
    groups: dict[str, list] = {}
    for serial, inv in data.inverters.items():
        inv.array = arrays.get(serial)
        groups.setdefault(inv.array or "", []).append(inv)

    for members in groups.values():
        if len(members) < MIN_GROUP:
            continue

        def med(attr: str) -> float:
            values = [getattr(i, attr) for i in members if getattr(i, attr) is not None]
            return median(values) if len(values) >= MIN_GROUP else 0.0

        def ref(attr: str) -> float:
            values = [getattr(i, attr) for i in members if getattr(i, attr) is not None]
            return _reference(values) if len(values) >= MIN_GROUP else 0.0

        today, yesterday = ref("energy_today"), ref("energy_yesterday")
        week, power = ref("energy_week"), med("power")
        for inv in members:
            if today >= MIN_TODAY_WH:
                inv.performance = _ratio(inv.energy_today, today)
            elif yesterday >= MIN_TODAY_WH:
                inv.performance = _ratio(inv.energy_yesterday, yesterday)
            if week >= MIN_WEEK_WH:
                inv.performance_week = _ratio(inv.energy_week, week)
                inv.underperforming = inv.performance_week < threshold
            elif inv.performance is not None:
                inv.underperforming = inv.performance < threshold
            if power >= MIN_POWER_W:
                inv.no_output = (inv.power or 0) < 0.1 * power
            else:
                inv.no_output = False


class AlertTracker:
    """Remember since when a condition holds, to alert only when it lasts."""

    def __init__(self) -> None:
        """Initialise."""
        self._since: dict[str, datetime] = {}

    def lasting(self, key: str, active: bool, now: datetime, minimum) -> bool:
        """True when `active` has been true for at least `minimum`."""
        if not active:
            self._since.pop(key, None)
            return False
        start = self._since.setdefault(key, now)
        return now - start >= minimum
