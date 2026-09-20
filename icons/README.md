# Auto Advance icons

The approved logo is the circled forward chevron in #00B0FF. Only this design is retained; former triangular/replay logos, unused proposals and transparent-mark variants have been removed.

| Appearance | SVG | PNG prefix |
| --- | --- | --- |
| Light, white chevron | auto-advance.svg | icon-light |
| Dark, navy chevron | auto-advance-dark.svg | icon |
| Disabled light | auto-advance-disabled-light.svg | icon-gray |
| Disabled dark | auto-advance-disabled-dark.svg | icon-gray-dark |

Each PNG variant is provided at 16, 32, 48 and 128 pixels. The toolbar keeps its existing blue-on-supported-pages / gray-on-other-pages behavior. The popup switches SVGs with its light/dark theme. The countdown uses the same circle and chevron geometry inline, inside its progress ring.

Regenerate with `npm run icons` using the development Playwright installation. `PLAYWRIGHT_MODULE` and `CHROME_PATH` can point to an existing runtime, as with the browser tests. This is only development tooling; loading the extension requires no runtime dependencies.

The separate YouTube, Instagram and GitHub service icons and their licenses remain in `brands/`.
