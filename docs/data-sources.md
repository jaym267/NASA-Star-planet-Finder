# Data sources

Every dataset this project uses is public and free. Nothing here needs an account or API key.

| Source | What it has | How we access it | Used in |
|---|---|---|---|
| [MAST](https://archive.stsci.edu/) (Mikulski Archive for Space Telescopes) | Raw TESS, Kepler, and K2 light curves | `lightkurve` Python library | Phase 1+ |
| [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/) | Every confirmed exoplanet and its properties | TAP API | Phase 4 |
| Kepler KOI table (via the Exoplanet Archive) | Labeled planet candidates and false positives | TAP API | Phase 3 (training data) |
| [ExoFOP](https://exofop.ipac.caltech.edu/tess/) | TESS Objects of Interest and community follow-up | Website / downloads | Phase 6 |

## Notes on the data

- **Light curve** = a star's brightness measured over time. Values are normalized so 1.0 is the star's normal brightness.
- **Time units**: TESS uses BTJD (Barycentric TESS Julian Date), Kepler uses BKJD. Both are days counted from a fixed starting point.
- **Pipelines**: we prefer the official mission pipelines (SPOC for TESS, the Kepler pipeline for Kepler) because they're the best calibrated.
- **Phase 1 cleanup**: remove missing values, normalize, and clip extreme outliers (5 sigma). Then average points down to at most 5,000 for the chart.

## Credit

This project uses data collected by the TESS and Kepler missions, funded by NASA, and obtained from MAST at the Space Telescope Science Institute.
