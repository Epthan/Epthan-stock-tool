"use client";

import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

/** Skins: 灰白 (gray, light), 黑金 (gold, light content + graphite frame), 夜间 (night). */
export type ThemeChoice = "auto" | "gray" | "gold" | "night";
export type Skin = "gray" | "gold" | "night";
type ResolvedTheme = "day" | "night";

type Coordinates = {
  latitude: number;
  longitude: number;
};

type ThemeContextValue = {
  choice: ThemeChoice;
  skin: Skin;
  /** Luminance of the content area; kept for code that only distinguishes light/dark. */
  resolvedTheme: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
};

const storageKey = "stock-tool.theme-choice.v1";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function subscribeTheme(listener: () => void) {
  window.addEventListener("storage", listener);
  window.addEventListener("portfolio-theme-change", listener);
  return () => {
    window.removeEventListener("storage", listener);
    window.removeEventListener("portfolio-theme-change", listener);
  };
}

function readThemeChoice(): ThemeChoice {
  let stored: string | null = null;
  try { stored = window.localStorage.getItem(storageKey); } catch {}
  if (stored === "day") return "gray"; // legacy value
  return stored === "gray" || stored === "gold" || stored === "night" ? stored : "auto";
}

function serverThemeChoice(): ThemeChoice {
  return "auto";
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function toDegrees(value: number) {
  return (value * 180) / Math.PI;
}

function normalizeDegrees(value: number) {
  return ((value % 360) + 360) % 360;
}

function getSunTime(date: Date, coordinates: Coordinates, isSunrise: boolean) {
  const dayStart = new Date(date.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - dayStart.getTime()) / 86_400_000);
  const lngHour = coordinates.longitude / 15;
  const approximateTime = dayOfYear + ((isSunrise ? 6 : 18) - lngHour) / 24;
  const meanAnomaly = 0.9856 * approximateTime - 3.289;
  const trueLongitude = normalizeDegrees(
    meanAnomaly +
      1.916 * Math.sin(toRadians(meanAnomaly)) +
      0.02 * Math.sin(toRadians(2 * meanAnomaly)) +
      282.634,
  );
  let rightAscension = normalizeDegrees(
    toDegrees(Math.atan(0.91764 * Math.tan(toRadians(trueLongitude)))),
  );
  const longitudeQuadrant = Math.floor(trueLongitude / 90) * 90;
  const ascensionQuadrant = Math.floor(rightAscension / 90) * 90;
  rightAscension = (rightAscension + longitudeQuadrant - ascensionQuadrant) / 15;

  const sinDeclination = 0.39782 * Math.sin(toRadians(trueLongitude));
  const cosDeclination = Math.cos(Math.asin(sinDeclination));
  const localHourCosine =
    (Math.cos(toRadians(90.833)) -
      sinDeclination * Math.sin(toRadians(coordinates.latitude))) /
    (cosDeclination * Math.cos(toRadians(coordinates.latitude)));

  if (localHourCosine > 1 || localHourCosine < -1) {
    return null;
  }

  const localHour = isSunrise
    ? 360 - toDegrees(Math.acos(localHourCosine))
    : toDegrees(Math.acos(localHourCosine));
  const localMeanTime =
    localHour / 15 + rightAscension - 0.06571 * approximateTime - 6.622;
  const universalTime = (localMeanTime - lngHour + 24) % 24;
  const time = new Date(date);

  time.setUTCHours(Math.floor(universalTime));
  time.setUTCMinutes(Math.floor((universalTime % 1) * 60));
  time.setUTCSeconds(0, 0);

  return time;
}

function getAutoTheme(date: Date, coordinates: Coordinates | null): ResolvedTheme {
  if (!coordinates) {
    const hour = date.getHours();
    return hour >= 6 && hour < 18 ? "day" : "night";
  }

  const sunrise = getSunTime(date, coordinates, true);
  const sunset = getSunTime(date, coordinates, false);

  if (!sunrise || !sunset) {
    return getAutoTheme(date, null);
  }

  return date >= sunrise && date < sunset ? "day" : "night";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const choice = useSyncExternalStore(subscribeTheme, readThemeChoice, serverThemeChoice);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(null);
  const [now, setNow] = useState(() => new Date());

  const skin: Skin = choice === "auto" ? (getAutoTheme(now, coordinates) === "day" ? "gray" : "night") : choice;
  const resolvedTheme: ResolvedTheme = skin === "night" ? "night" : "day";

  useEffect(() => {
    if (!navigator.geolocation) {
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoordinates({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => undefined,
      { enableHighAccuracy: false, maximumAge: 3_600_000, timeout: 5000 },
    );
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.skin = skin;
    document.documentElement.dataset.themeChoice = choice;
    document.documentElement.style.colorScheme = resolvedTheme === "day" ? "light" : "dark";
  }, [choice, resolvedTheme, skin]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      choice,
      skin,
      resolvedTheme,
      setChoice(nextChoice) {
        try { window.localStorage.setItem(storageKey, nextChoice); } catch {}
        window.dispatchEvent(new Event("portfolio-theme-change"));
      },
    }),
    [choice, resolvedTheme, skin],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }

  return context;
}

/** Inline, pre-hydration script: applies the saved skin before first paint (no flash). */
export const themeBootScript = `(function(){try{var c=localStorage.getItem("${storageKey}");if(c==="day")c="gray";var h=new Date().getHours();var s=(c==="gray"||c==="gold"||c==="night")?c:(h>=6&&h<18?"gray":"night");var d=document.documentElement;d.dataset.skin=s;d.dataset.theme=s==="night"?"night":"day";d.style.colorScheme=s==="night"?"dark":"light";}catch(e){}})();`;
