// Inline the Vite build into one HTML body fragment (for hosts that serve a single page, e.g. a claude.ai Artifact).
import { readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2] ?? 'dist/small-subway.html';
const html = readFileSync('dist/index.html', 'utf8');
const asset = (re) => readFileSync('dist' + html.match(re)[1], 'utf8');
const css = asset(/<link rel="stylesheet"[^>]*href="([^"]+)"/);
const js = asset(/<script type="module"[^>]*src="([^"]+)"/);
const body = html.match(/<body>([\s\S]*)<\/body>/)[1].trim();

writeFileSync(
  out,
  `<title>Small Subway</title>
<meta name="description" content="Design a subway for a growing city and keep every station moving." />
<style>${css}</style>
${body}
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>
`,
);
console.log(`wrote ${out}`);
