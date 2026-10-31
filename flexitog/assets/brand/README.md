# Brand files

`logo.jpg` is the FlexiTog logo (960 x 518, scaled from the 2000 x 1080 original). The build embeds it in
the page: 300 px wide on the home page (220 px on a phone), 180 px on the login card, 26 px high in the
Home link. The aspect ratio is kept.

To change it, put the new file here as `logo.svg`, `logo.png`, `logo.webp` or `logo.jpg` (one file only,
SVG wins) and rebuild with `python tools/build_dashboard.py`. `refrigiwear_logo.<ext>` is read too when no
`logo.<ext>` exists. Without any file the home page shows a 300 px placeholder box.
