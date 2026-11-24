/**
 * Gera build/icon.png (512), build/icon.ico (16–256), build/tray.png/ico,
 * build/installerSidebar.bmp e build/installerHeader.bmp a partir dos SVGs em assets/brand.
 * Requer Playwright/Chromium disponível (usado só em desenvolvimento).
 * Uso: node scripts/generate-icons.cjs
 */
const { chromium } = require('playwright')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const out = (f) => path.join(root, 'build', f)

function ico(pngs) {
  // ICO com imagens PNG embutidas (suportado pelo Windows Vista+)
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(pngs.length, 4)
  const entries = []; let offset = 6 + 16 * pngs.length
  for (const { size, data } of pngs) {
    const e = Buffer.alloc(16)
    e.writeUInt8(size >= 256 ? 0 : size, 0); e.writeUInt8(size >= 256 ? 0 : size, 1)
    e.writeUInt8(0, 2); e.writeUInt8(0, 3); e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6)
    e.writeUInt32LE(data.length, 8); e.writeUInt32LE(offset, 12)
    offset += data.length; entries.push(e)
  }
  return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)])
}

function bmp24(width, height, rgba) {
  // BMP 24 bits (bottom-up) exigido pelo NSIS
  const rowSize = Math.ceil((width * 3) / 4) * 4
  const buf = Buffer.alloc(54 + rowSize * height)
  buf.write('BM', 0); buf.writeUInt32LE(buf.length, 2); buf.writeUInt32LE(54, 10)
  buf.writeUInt32LE(40, 14); buf.writeInt32LE(width, 18); buf.writeInt32LE(height, 22)
  buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(rowSize * height, 34)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const o = 54 + (height - 1 - y) * rowSize + x * 3
      buf[o] = rgba[i + 2]; buf[o + 1] = rgba[i + 1]; buf[o + 2] = rgba[i]
    }
  }
  return buf
}

;(async () => {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  const render = async (svgFile, w, h, bg = 'transparent') => {
    const svg = fs.readFileSync(path.join(root, 'assets/brand', svgFile), 'utf8')
    await page.setViewportSize({ width: w, height: h })
    await page.setContent(`<html><body style="margin:0;background:${bg}"><div style="width:${w}px;height:${h}px">${svg.replace(/width="\d+" height="\d+"/, `width="${w}" height="${h}"`)}</div></body></html>`)
    return page.screenshot({ omitBackground: bg === 'transparent', clip: { x: 0, y: 0, width: w, height: h } })
  }
  const sizes = [16, 24, 32, 48, 64, 128, 256]
  const pngs = []
  for (const s of sizes) pngs.push({ size: s, data: await render('zaion-mark.svg', s, s) })
  fs.writeFileSync(out('icon.ico'), ico(pngs))
  fs.writeFileSync(out('icon.png'), await render('zaion-mark.svg', 512, 512))
  const tray = []
  for (const s of [16, 24, 32, 48]) tray.push({ size: s, data: await render('zaion-tray.svg', s, s) })
  fs.writeFileSync(out('tray.ico'), ico(tray))
  fs.writeFileSync(out('tray.png'), await render('zaion-tray.svg', 32, 32))

  // Imagens do instalador NSIS
  const rawRgba = async (html, w, h) => {
    await page.setViewportSize({ width: w, height: h })
    await page.setContent(html)
    return page.evaluate(async ([w, h]) => {
      const img = document.querySelector('#c')
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const ctx = c.getContext('2d')
      ctx.fillStyle = '#0B1120'; ctx.fillRect(0, 0, w, h)
      const svgImg = new Image(); svgImg.src = 'data:image/svg+xml;base64,' + btoa(img.innerHTML)
      await svgImg.decode(); ctx.drawImage(svgImg, 0, 0, w, h)
      return Array.from(ctx.getImageData(0, 0, w, h).data)
    }, [w, h])
  }
  const mark = fs.readFileSync(path.join(root, 'assets/brand/zaion-mark.svg'), 'utf8').replace(/<title>.*?<\/title>/, '')
  const sidebarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314"><rect width="164" height="314" fill="#0B1120"/><rect y="310" width="164" height="4" fill="#10B981"/><g transform="translate(50 60) scale(1)">${mark.replace(/<svg[^>]*>/, '').replace('</svg>', '')}</g><text x="82" y="160" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="15" font-weight="700" fill="#F8FAFC">Zaion</text><text x="82" y="180" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="11" fill="#94A3B8">Affiliate Studio</text><text x="82" y="280" text-anchor="middle" font-family="Segoe UI, sans-serif" font-size="9" fill="#10B981">Desktop Edition</text></svg>`
  const headerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57"><rect width="150" height="57" fill="#0B1120"/><g transform="translate(96 10) scale(0.58)">${mark.replace(/<svg[^>]*>/, '').replace('</svg>', '')}</g></svg>`
  fs.writeFileSync(out('installerSidebar.bmp'), bmp24(164, 314, await rawRgba(`<div id="c">${sidebarSvg}</div>`, 164, 314)))
  fs.writeFileSync(out('installerHeader.bmp'), bmp24(150, 57, await rawRgba(`<div id="c">${headerSvg}</div>`, 150, 57)))
  await browser.close()
  console.log('Ícones gerados em build/')
})()
