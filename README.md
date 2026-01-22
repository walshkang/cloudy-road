# 🌥️ Cloudy Road

> **"Civilization VI meets Strava."**
> A gamified fitness explorer that tracks your runs and clears the clouds from your city map.

![Status](https://img.shields.io/badge/Status-Phase_1_MVP-blue)
![Stack](https://img.shields.io/badge/Stack-Next.js_|_Supabase_|_Mapbox-black)

## 📖 Context
This is the **Web MVP** version of Cloudy Road.
The goal is to allow a user to upload a GPX file (from Strava/Garmin) and see their "explored area" light up on a dark map of NYC.

## 🛠️ Tech Stack
* **Frontend:** Next.js 14 (App Router), React, Tailwind CSS.
* **Maps:** `react-map-gl` (Mapbox Wrapper), `mapbox-gl`, `@turf/bbox` (Geospatial math).
* **Backend:** Supabase (PostgreSQL + PostGIS).
* **Logic:** Uber H3 (Hexagonal Hierarchical Spatial Index) for efficient "cloud clearing" mechanics.

## 🚀 Getting Started

### 1. Environment Setup
Create a `.env.local` file in the root:
```bash
NEXT_PUBLIC_MAPBOX_TOKEN=pk.eyJ... # Your Public Mapbox Key
NEXT_PUBLIC_SUPABASE_URL=https://...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...