import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('installable offline shell', () => {
  it('publishes a valid standalone manifest with install icons', () => {
    const manifest = JSON.parse(
      readFileSync('public/manifest.webmanifest', 'utf8'),
    ) as {
      display: string
      start_url: string
      icons: Array<{ sizes: string; type: string }>
    }

    expect(manifest.display).toBe('standalone')
    expect(manifest.start_url).toBe('/')
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sizes: '192x192', type: 'image/png' }),
        expect.objectContaining({ sizes: '512x512', type: 'image/png' }),
      ]),
    )

    const icon192 = readFileSync('public/icons/draftlens-192.png')
    const icon512 = readFileSync('public/icons/draftlens-512.png')
    expect([icon192.readUInt32BE(16), icon192.readUInt32BE(20)]).toEqual([
      192, 192,
    ])
    expect([icon512.readUInt32BE(16), icon512.readUInt32BE(20)]).toEqual([
      512, 512,
    ])
  })

  it('registers a production service worker with navigation fallback caching', () => {
    const html = readFileSync('index.html', 'utf8')
    const main = readFileSync('src/main.tsx', 'utf8')
    const worker = readFileSync('public/sw.js', 'utf8')

    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"')
    expect(main).toContain("navigator.serviceWorker.register('/sw.js')")
    expect(worker).toContain("request.mode === 'navigate'")
    expect(worker).toContain("caches.match('/')")
    expect(worker).toContain('Promise.allSettled')
    expect(worker).toContain("fetch('/asset-manifest.json')")
    expect(worker).toContain("source === 'src/lib/analyzer.ts'")
    expect(worker).toContain("url.pathname.startsWith('/api/')")
    expect(worker).toContain('isCacheableAsset(url.pathname)')
    expect(worker).not.toContain('Object.values(manifest).flatMap')

    const vercel = readFileSync('vercel.json', 'utf8')
    expect(vercel).toContain('Content-Security-Policy')
    expect(vercel).toContain("frame-ancestors 'none'")

    const viteConfig = readFileSync('vite.config.ts', 'utf8')
    expect(viteConfig).toContain("manifest: 'asset-manifest.json'")
  })
})
