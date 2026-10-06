// Ghép src/ thành:
//   www/index.html + www/lib/  -> dùng cho app Android (Capacitor) và đưa lên Netlify
//   dist/artifact.html          -> bản publish trên claude.ai (không có doctype, tải thư viện từ cdnjs)
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';

const read = f => readFileSync(new URL('../src/' + f, import.meta.url), 'utf8');
const head = read('head.html'), body = read('body.html');
const js = read('core.js') + '\n' + read('app.js');
const script = `<script>\n${js}\n</script>`;

const full = `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#536A2A">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
${head}
</head>
<body>
${body}
${script}
</body>
</html>
`;

mkdirSync('www/lib', { recursive: true });
mkdirSync('dist', { recursive: true });
writeFileSync('www/index.html', full);
writeFileSync('dist/artifact.html', `${head}\n${body}\n${script}\n`);
for (const f of ['xlsx/dist/xlsx.full.min.js', 'html2canvas/dist/html2canvas.min.js', 'jspdf/dist/jspdf.umd.min.js']) {
  copyFileSync('node_modules/' + f, 'www/lib/' + f.split('/').pop());
}
new Function(js); // báo lỗi cú pháp ngay khi build
console.log('Built www/index.html, www/lib/, dist/artifact.html');
