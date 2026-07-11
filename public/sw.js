const CACHE_PREFIX = 'draftlens-shell'
const CACHE_NAME = `${CACHE_PREFIX}-v2`
const CORE_ASSETS = [
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/draftlens-192.png',
  '/icons/draftlens-512.png',
]

async function cacheResponse(cache, request) {
  const response = await fetch(request)
  if (response.ok) await cache.put(request, response.clone())
  return response
}

function isCacheableAsset(pathname) {
  return (
    pathname === '/asset-manifest.json' ||
    CORE_ASSETS.includes(pathname) ||
    pathname.startsWith('/assets/')
  )
}

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME)
  const shellResponse = await fetch(new Request('/', { cache: 'reload' }))
  if (!shellResponse.ok) throw new Error('App shell unavailable')

  const shellMarkup = await shellResponse.clone().text()
  await cache.put('/', shellResponse)

  const discoveredAssets = [...shellMarkup.matchAll(/(?:src|href)="([^"]+)"/gu)]
    .map((match) => match[1])
    .filter((path) => path.startsWith('/'))
  let builtAssets = []
  try {
    const manifestResponse = await fetch('/asset-manifest.json')
    if (manifestResponse.ok) {
      await cache.put('/asset-manifest.json', manifestResponse.clone())
      const manifest = await manifestResponse.json()
      builtAssets = Object.entries(manifest)
        .filter(
          ([source, entry]) =>
            entry.isEntry || source === 'src/lib/analyzer.ts',
        )
        .flatMap(([, entry]) => [
          entry.file,
          ...(entry.css || []),
          ...(entry.assets || []),
        ])
    }
  } catch {
    // The HTML-discovered entry assets still provide the offline app shell.
  }

  const assetPaths = [
    ...new Set([
      ...CORE_ASSETS,
      ...discoveredAssets,
      ...builtAssets.map((path) => `/${path}`),
    ]),
  ]

  await Promise.allSettled(
    assetPaths.map((path) => cacheResponse(cache, path)),
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    precacheAppShell().then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME)
            await cache.put('/', response.clone())
          }
          return response
        })
        .catch(async () => (await caches.match('/')) || Response.error()),
    )
    return
  }

  if (!isCacheableAsset(url.pathname)) return

  event.respondWith(
    caches.match(request).then(
      async (cached) =>
        cached ||
        cacheResponse(
          await caches.open(CACHE_NAME),
          request,
        ),
    ),
  )
})
