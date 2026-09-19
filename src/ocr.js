import { createWorker } from 'tesseract.js'

/* =========================================
   LOAD IMAGE
   ========================================= */

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const image = new Image()

    image.onload = () => {
      URL.revokeObjectURL(image.src)
      resolve(image)
    }

    image.onerror = () => {
      URL.revokeObjectURL(image.src)
      reject(
        new Error('Could not load image')
      )
    }

    image.src =
      URL.createObjectURL(file)
  })
}

/* =========================================
   CREATE OCR IMAGE
   ========================================= */

async function createOCRImage(
  file,
  options = {}
) {
  const image =
    await loadImage(file)

  /*
    Normal OCR:
    1.5x is faster.

    Detailed OCR:
    can use a larger scale for
    small logos and small text.
  */

  const scale =
    options.scale || 1.5

  const threshold =
    options.threshold ?? false

  const contrast =
    options.contrast ?? 1.25

  const canvas =
    document.createElement('canvas')

  canvas.width =
    Math.round(
      image.width * scale
    )

  canvas.height =
    Math.round(
      image.height * scale
    )

  const context =
    canvas.getContext(
      '2d',
      {
        willReadFrequently: true,
      }
    )

  if (!context) {
    throw new Error(
      'Could not create canvas context'
    )
  }

  /* =====================================
     DRAW UPSCALED IMAGE
     ===================================== */

  context.drawImage(
    image,
    0,
    0,
    canvas.width,
    canvas.height
  )

  /* =====================================
     GET PIXEL DATA
     ===================================== */

  const imageData =
    context.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    )

  const data =
    imageData.data

  /* =====================================
     GRAYSCALE + CONTRAST
     ===================================== */

  for (
    let i = 0;
    i < data.length;
    i += 4
  ) {

    const red =
      data[i]

    const green =
      data[i + 1]

    const blue =
      data[i + 2]

    let gray =
      0.299 * red +
      0.587 * green +
      0.114 * blue

    /*
      Increase contrast.
    */

    gray =
      ((gray - 128) * contrast) +
      128

    gray =
      Math.max(
        0,
        Math.min(
          255,
          gray
        )
      )

    /*
      Optional binary threshold.

      This makes text either black
      or white, which can help
      Tesseract recognize small text.
    */

    if (threshold) {
      gray =
        gray < 175
          ? 0
          : 255
    }

    data[i] = gray
    data[i + 1] = gray
    data[i + 2] = gray
  }

  context.putImageData(
    imageData,
    0,
    0
  )

  /* =====================================
     CONVERT TO PNG
     ===================================== */

  return new Promise(
    (resolve, reject) => {

      canvas.toBlob(
        (blob) => {

          if (blob) {
            resolve(blob)
          } else {
            reject(
              new Error(
                'Image preprocessing failed'
              )
            )
          }

        },
        'image/png'
      )

    }
  )
}

/* =========================================
   CLEAN OCR TEXT
   ========================================= */

function cleanOCRText(text) {
  if (!text) {
    return ''
  }

  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/* =========================================
   ADD UNIQUE OCR LINES
   ========================================= */

function addUniqueLines(
  lines,
  text
) {
  text
    .split('\n')
    .map(
      (line) =>
        line.trim()
    )
    .filter(Boolean)
    .forEach((line) => {

      const normalizedLine =
        line.toLowerCase()

      const exists =
        lines.some(
          (existingLine) =>
            existingLine.toLowerCase() ===
            normalizedLine
        )

      if (!exists) {
        lines.push(line)
      }
    })
}

/* =========================================
   EXTRACT TEXT
   ========================================= */

export async function extractText(
  file,
  detailed = false
) {

  let worker = null

  try {

    worker =
      await createWorker('eng')

    /* =====================================
       FAST OCR IMAGE
       ===================================== */

    const enhancedImage =
      await createOCRImage(
        file,
        {
          scale: 1.5,
          contrast: 1.25,
          threshold: false,
        }
      )

    /* =====================================
       MAIN OCR PASS
       ===================================== */

    /*
      PSM 11 works well for screenshots
      containing text in different
      locations.
    */

    await worker.setParameters({
      tessedit_pageseg_mode: '11',
    })

    const enhancedResult =
      await worker.recognize(
        enhancedImage
      )

    const enhancedText =
      cleanOCRText(
        enhancedResult?.data?.text ||
          ''
      )

    /*
      Normal uploads stop here.

      This keeps the normal upload
      experience fast.
    */

    if (!detailed) {

      console.log(
        'ScreenMind OCR result:',
        enhancedText
      )

      return enhancedText
    }

    /* =====================================
       DETAILED OCR
       ===================================== */

    /*
      Reprocess gets additional OCR
      passes for difficult screenshots.
    */

    /* =====================================
       PASS 1: ORIGINAL IMAGE
       ===================================== */

    await worker.setParameters({
      tessedit_pageseg_mode: '6',
    })

    const originalResult =
      await worker.recognize(file)

    const originalText =
      cleanOCRText(
        originalResult?.data?.text ||
          ''
      )

    /* =====================================
       PASS 2: ENHANCED IMAGE
       ===================================== */

    await worker.setParameters({
      tessedit_pageseg_mode: '6',
    })

    const blockResult =
      await worker.recognize(
        enhancedImage
      )

    const blockText =
      cleanOCRText(
        blockResult?.data?.text ||
          ''
      )

    /* =====================================
       PASS 3: HIGH-RES THRESHOLD
       ===================================== */

    /*
      This is the important new pass.

      It uses:
      - 2.5x enlargement
      - stronger contrast
      - black/white threshold

      This is intended to recover
      small text such as logos.
    */

    const highResolutionImage =
      await createOCRImage(
        file,
        {
          scale: 2.5,
          contrast: 1.4,
          threshold: true,
        }
      )

    await worker.setParameters({
      tessedit_pageseg_mode: '11',
    })

    const highResolutionResult =
      await worker.recognize(
        highResolutionImage
      )

    const highResolutionText =
      cleanOCRText(
        highResolutionResult?.data?.text ||
          ''
      )

    /* =====================================
       PASS 4: HIGH-RES BLOCK OCR
       ===================================== */

    await worker.setParameters({
      tessedit_pageseg_mode: '6',
    })

    const highResolutionBlockResult =
      await worker.recognize(
        highResolutionImage
      )

    const highResolutionBlockText =
      cleanOCRText(
        highResolutionBlockResult
          ?.data?.text ||
          ''
      )

    /* =====================================
       MERGE ALL OCR RESULTS
       ===================================== */

    const lines = []

    addUniqueLines(
      lines,
      enhancedText
    )

    addUniqueLines(
      lines,
      originalText
    )

    addUniqueLines(
      lines,
      blockText
    )

    addUniqueLines(
      lines,
      highResolutionText
    )

    addUniqueLines(
      lines,
      highResolutionBlockText
    )

    const combinedText =
      lines.join('\n').trim()

    /* =====================================
       DEBUG INFORMATION
       ===================================== */

    console.log(
      'ScreenMind detailed OCR:',
      {
        enhancedText,
        originalText,
        blockText,
        highResolutionText,
        highResolutionBlockText,
        combinedText,
      }
    )

    return combinedText

  } catch (error) {

    console.error(
      'OCR failed:',
      error
    )

    throw error

  } finally {

    if (worker) {
      await worker.terminate()
    }
  }
}