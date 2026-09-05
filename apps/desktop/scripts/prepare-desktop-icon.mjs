/**
 * Copy a source PNG into resources/icon.png + icon.ico (taskbar + tray).
 * Uses the image as-is — no background removal.
 *
 * Usage: node scripts/prepare-desktop-icon.mjs <input.png>
 */
import { copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import toIco from 'to-ico'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const resourcesDir = path.join(__dirname, '..', 'resources')

/** @returns {Promise<Buffer>} */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function resizePng(source, size) {
  const zoomedSize = Math.round(size * 1.25)
  const cropOffset = Math.floor((zoomedSize - size) / 2)

  return sharp(source)
    .resize(zoomedSize, zoomedSize, {
      fit: 'cover',
      kernel: sharp.kernel.lanczos3,
      position: 'centre'
    })
    .extract({ left: cropOffset, top: cropOffset, width: size, height: size })
    .sharpen({ sigma: size <= 64 ? 0.6 : 0.35 })
    .png()
    .toBuffer()
}

/** @returns {Promise<void>} */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
async function main() {
  const inputPath = process.argv[2]
  if (!inputPath) {
    console.error('Usage: node scripts/prepare-desktop-icon.mjs <input.png>')
    process.exit(1)
  }

  const pngPath = path.join(resourcesDir, 'icon.png')
  const icoPath = path.join(resourcesDir, 'icon.ico')

  if (path.resolve(inputPath) !== path.resolve(pngPath)) {
    await copyFile(inputPath, pngPath)
  }

  const icoSizes = [16, 24, 32, 48, 64, 128, 256]
  const icoBuffers = await Promise.all(icoSizes.map((size) => resizePng(inputPath, size)))
  const icoBuffer = await toIco(icoBuffers)
  await writeFile(icoPath, icoBuffer)

  console.log(`Wrote ${pngPath}`)
  console.log(`Wrote ${icoPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
