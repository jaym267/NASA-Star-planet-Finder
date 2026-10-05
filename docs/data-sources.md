# Data sources

Every dataset this project uses is public and free. Nothing here needs an account or API key.

| Source | What it has | How we access it | Used in |
|---|---|---|---|
| [MAST](https://archive.stsci.edu/) (Mikulski Archive for Space Telescopes) | Raw TESS, Kepler, and K2 light curves | `lightkurve` Python library | Phase 1+ |
| [NASA Exoplanet Archive](https://exoplanetarchive.ipac.caltech.edu/) | Every confirmed exoplanet and its properties | TAP API | Phase 2 (known-planet check), Phase 4 |
| Kepler KOI table (via the Exoplanet Archive) | Labeled planet candidates and false positives | TAP API | Phase 3 (training data) |
| [ExoFOP](https://exofop.ipac.caltech.edu/tess/) | TESS Objects of Interest and community follow-up | Website / downloads | Phase 6 |

## Notes on the data

- **Light curve** = a star's brightness measured over time. Values are normalized so 1.0 is the star's normal brightness.
- **Time units**: TESS uses BTJD (Barycentric TESS Julian Date), Kepler uses BKJD. Both are days counted from a fixed starting point.
- **Pipelines**: we prefer the official mission pipelines (SPOC for TESS, the Kepler pipeline for Kepler) because they're the best calibrated.
- **Phase 1 cleanup**: remove missing values, normalize, and clip extreme *upward* outliers (5 sigma). Downward points are kept because a deep transit is a real downward "outlier". Then average points down to at most 5,000 for the chart.
- **Phase 2 cleanup**: also trim the first 0.25 days and last 0.15 days of each continuous stretch of data, and drop stretches shorter than a day. The spacecraft's brightness drifts after every pause to send data home, and BLS mistakes those drifts for transits.

## Credit

This project uses data collected by the TESS and Kepler missions, funded by NASA, and obtained from MAST at the Space Telescope Science Institute.
