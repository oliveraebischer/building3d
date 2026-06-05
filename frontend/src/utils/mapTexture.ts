import type { ParcelFeature } from '../api/geoAdmin'

export function wgs84ToMercator(lon: number, lat: number): [number, number] {
  return [
    lon * 20037508.34 / 180,
    Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180,
  ]
}

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

export function computeMapUrls(parcel: ParcelFeature): {
  swissUrl: string; cadUrl: string; imgW: number; imgH: number
} {
  const coords = (parcel.geometry.coordinates as [number, number][][]).flat()
  const lngs = coords.map(c => c[0]), lats = coords.map(c => c[1])
  const pad = 1.5
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs)
  const minLat = Math.min(...lats), maxLat = Math.max(...lats)
  const pMinLng = minLng - (maxLng - minLng) * pad
  const pMaxLng = maxLng + (maxLng - minLng) * pad
  const pMinLat = minLat - (maxLat - minLat) * pad
  const pMaxLat = maxLat + (maxLat - minLat) * pad

  const [minX, minY] = wgs84ToMercator(pMinLng, pMinLat)
  const [maxX, maxY] = wgs84ToMercator(pMaxLng, pMaxLat)
  const bbox = `${minX},${minY},${maxX},${maxY}`
  const imgH = 2048
  const imgW = Math.round(imgH * (maxX - minX) / (maxY - minY))

  const wmsBase = 'https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
  const common  = `&CRS=EPSG:3857&WIDTH=${imgW}&HEIGHT=${imgH}&BBOX=${bbox}&STYLES=`
  return {
    swissUrl: `${wmsBase}&LAYERS=ch.swisstopo.swissimage-product&FORMAT=image/jpeg&TRANSPARENT=false${common}`,
    cadUrl:   `${wmsBase}&LAYERS=ch.kantone.cadastralwebmap-farbe&FORMAT=image/png&TRANSPARENT=true${common}`,
    imgW,
    imgH,
  }
}

export function computeMapUrlsFromBbox(
  minLng: number, minLat: number, maxLng: number, maxLat: number,
): { swissUrl: string; cadUrl: string; imgW: number; imgH: number } {
  const [minX, minY] = wgs84ToMercator(minLng, minLat)
  const [maxX, maxY] = wgs84ToMercator(maxLng, maxLat)
  const bbox = `${minX},${minY},${maxX},${maxY}`
  const imgH = 2048
  const imgW = Math.round(imgH * (maxX - minX) / (maxY - minY))
  const wmsBase = 'https://wms.geo.admin.ch/?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap'
  const common  = `&CRS=EPSG:3857&WIDTH=${imgW}&HEIGHT=${imgH}&BBOX=${bbox}&STYLES=`
  return {
    swissUrl: `${wmsBase}&LAYERS=ch.swisstopo.swissimage-product&FORMAT=image/jpeg&TRANSPARENT=false${common}`,
    cadUrl:   `${wmsBase}&LAYERS=ch.kantone.cadastralwebmap-farbe&FORMAT=image/png&TRANSPARENT=true${common}`,
    imgW,
    imgH,
  }
}

type CachedImages = { egrid: string; swissImg: HTMLImageElement; cadImg: HTMLImageElement }
let _cache: CachedImages | null = null

export function setPreloadedMapImages(egrid: string, swissImg: HTMLImageElement, cadImg: HTMLImageElement) {
  _cache = { egrid, swissImg, cadImg }
}

export function getPreloadedMapImages(egrid: string): Omit<CachedImages, 'egrid'> | null {
  return _cache?.egrid === egrid ? { swissImg: _cache.swissImg, cadImg: _cache.cadImg } : null
}
