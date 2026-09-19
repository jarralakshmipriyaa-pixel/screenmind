import { useEffect, useRef, useState } from 'react'
import {
  addScreenshot,
  getScreenshots,
  updateScreenshot,
  deleteScreenshot,
} from './database'
import { extractText } from './ocr'
import { cosineSimilarity } from './similarity'
import './App.css'

const categories = [
  'All',
  'Work',
  'Study',
  'Settings',
  'Shopping',
  'Messages',
  'Social',
  'Other',
]

const SEMANTIC_THRESHOLD = 0.65

/* =========================================
   LAZY LOAD AI
   ========================================= */

let embeddingModulePromise = null

async function getEmbeddingModule() {
  if (!embeddingModulePromise) {
    embeddingModulePromise = import('./embedding')
  }

  return embeddingModulePromise
}

async function createEmbedding(text) {
  const {
    createEmbedding: createEmbeddingFunction,
  } =
    await getEmbeddingModule()

  return createEmbeddingFunction(text)
}

/* =========================================
   NORMALIZE TEXT
   ========================================= */

function normalizeSearchText(text) {
  return text
    .toLowerCase()
    .replace(/[-–—]/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/* =========================================
   SEARCH ALIASES
   ========================================= */

/*
  Some logos or stylized words can be
  recognized incorrectly by OCR.

  Example:

  Visual text:
  Unstop

  OCR:
  'stop

  We only use this controlled correction
  for searches beginning with "unst".
*/

function getSearchVariants(searchWord) {
  const word =
    normalizeSearchText(searchWord)

  const variants = [word]

  /*
    Unstop OCR correction.

    unst
    unsto
    unstop

    can all search OCR text such as:

    stop
    'stop
  */

  if (
    word === 'unst' ||
    word === 'unsto' ||
    word === 'unstop' ||
    word.startsWith('unstop')
  ) {
    variants.push(
      'unst',
      'unsto',
      'unstop',
      'stop'
    )
  }

  return [
    ...new Set(variants),
  ]
}

/* =========================================
   LEVENSHTEIN DISTANCE
   ========================================= */

function levenshteinDistance(a, b) {
  const matrix = Array.from(
    { length: b.length + 1 },
    () =>
      Array(a.length + 1).fill(0)
  )

  for (let i = 0; i <= b.length; i++) {
    matrix[i][0] = i
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b[i - 1] === a[j - 1]) {
        matrix[i][j] =
          matrix[i - 1][j]
      } else {
        matrix[i][j] =
          Math.min(
            matrix[i - 1][j] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j - 1] + 1
          )
      }
    }
  }

  return matrix[b.length][a.length]
}

/* =========================================
   OCR-TOLERANT MATCHING
   ========================================= */

function wordsAreSimilar(
  searchWord,
  textWord
) {
  const a =
    normalizeSearchText(searchWord)

  const b =
    normalizeSearchText(textWord)

  if (!a || !b) {
    return false
  }

  /* =======================================
     EXACT MATCH
     ======================================= */

  if (a === b) {
    return true
  }

  /* =======================================
     CONTROLLED SEARCH ALIASES
     ======================================= */

  const searchVariants =
    getSearchVariants(a)

  /*
    If one of the controlled variants
    exactly matches the OCR word,
    accept it.
  */

  if (
    searchVariants.some(
      (variant) =>
        variant === b
    )
  ) {
    return true
  }

  /*
    Also allow a controlled variant
    to be the beginning of a longer
    OCR word.
  */

  if (
    searchVariants.some(
      (variant) =>
        variant.length >= 3 &&
        b.length >= variant.length &&
        b.length <=
          variant.length * 2 &&
        b.startsWith(variant)
    )
  ) {
    return true
  }

  /* =======================================
     NORMAL PARTIAL MATCH
     ======================================= */

  if (
    a.length >= 3 &&
    b.length >= a.length &&
    b.length <= a.length * 2 &&
    b.startsWith(a)
  ) {
    return true
  }

  if (
    b.length >= 3 &&
    a.length >= b.length &&
    a.length <= b.length * 2 &&
    a.startsWith(b)
  ) {
    return true
  }

  /* =======================================
     SAFE CONTAINMENT
     ======================================= */

  const shorterLength =
    Math.min(a.length, b.length)

  const longerLength =
    Math.max(a.length, b.length)

  if (
    shorterLength >= 4 &&
    longerLength <=
      shorterLength * 2
  ) {
    if (
      a.includes(b) ||
      b.includes(a)
    ) {
      return true
    }
  }

  /* =======================================
     FUZZY MATCH
     ======================================= */

  if (
    a.length >= 4 &&
    b.length >= 4
  ) {
    const distance =
      levenshteinDistance(a, b)

    const maxLength =
      Math.max(a.length, b.length)

    const similarity =
      1 -
      distance / maxLength

    if (similarity >= 0.65) {
      return true
    }

    if (
      a.length >= 6 &&
      b.length >= 6 &&
      distance <= 2
    ) {
      return true
    }
  }

  return false
}

/* =========================================
   CHECK SEARCH MATCH
   ========================================= */

function searchWordMatchesText(
  searchWord,
  text
) {
  const variants =
    getSearchVariants(searchWord)

  const textWords =
    normalizeSearchText(text)
      .split(/\s+/)
      .filter(Boolean)

  return variants.some(
    (variant) =>
      textWords.some(
        (textWord) =>
          wordsAreSimilar(
            variant,
            textWord
          )
      )
  )
}

/* =========================================
   HIGHLIGHT TEXT
   ========================================= */

function highlightText(
  text,
  search
) {
  if (!search.trim()) {
    return text
  }

  const searchWords =
    normalizeSearchText(search)
      .split(/\s+/)
      .filter(Boolean)

  if (
    searchWords.length === 0
  ) {
    return text
  }

  const parts =
    text.split(/(\s+)/)

  return parts.map(
    (part, index) => {

      if (/^\s+$/.test(part)) {
        return part
      }

      const cleanedPart =
        normalizeSearchText(part)

      const isMatch =
        searchWords.some(
          (searchWord) =>
            wordsAreSimilar(
              searchWord,
              cleanedPart
            )
        )

      if (isMatch) {
        return (
          <mark key={index}>
            {part}
          </mark>
        )
      }

      return part
    }
  )
}

/* =========================================
   KEYWORD SCORE
   ========================================= */

function calculateKeywordScore(
  text,
  search
) {
  if (
    !text ||
    !search.trim()
  ) {
    return 0
  }

  const searchWords =
    normalizeSearchText(search)
      .split(/\s+/)
      .filter(Boolean)

  if (
    searchWords.length === 0
  ) {
    return 0
  }

  let matchedWords = 0

  for (
    const searchWord of searchWords
  ) {

    if (
      searchWordMatchesText(
        searchWord,
        text
      )
    ) {
      matchedWords++
    }
  }

  return (
    matchedWords /
    searchWords.length
  )
}

/* =========================================
   APP
   ========================================= */

function App() {
  const [search, setSearch] =
    useState(
      localStorage.getItem(
        'screenmind-search'
      ) || ''
    )

  const [
    selectedCategory,
    setSelectedCategory,
  ] = useState('All')

  const [images, setImages] =
    useState([])

  const [
    isProcessing,
    setIsProcessing,
  ] = useState(false)

  const [
    processingStatus,
    setProcessingStatus,
  ] = useState('')

  const [
    isSearching,
    setIsSearching,
  ] = useState(false)

  const [
    searchResults,
    setSearchResults,
  ] = useState(null)

  const [
    reprocessingId,
    setReprocessingId,
  ] = useState(null)

  const [
    selectedImage,
    setSelectedImage,
  ] = useState(null)

  const fileInputRef =
    useRef(null)

  /* =========================================
     SAVE SEARCH
     ========================================= */

  useEffect(() => {
    localStorage.setItem(
      'screenmind-search',
      search
    )
  }, [search])

  /* =========================================
     LOAD SCREENSHOTS
     ========================================= */

  useEffect(() => {
    let objectUrls = []

    async function loadScreenshots() {
      try {
        const savedScreenshots =
          await getScreenshots()

        const imageUrls =
          savedScreenshots.map(
            (screenshot) => {

              const url =
                URL.createObjectURL(
                  screenshot.image
                )

              objectUrls.push(url)

              return {
                id: screenshot.id,
                url,
                file: screenshot.image,
                text:
                  screenshot.extractedText ||
                  '',
                embedding:
                  screenshot.embedding ||
                  [],
                category:
                  screenshot.category ||
                  'Other',
              }
            }
          )

        setImages(imageUrls)

      } catch (error) {
        console.error(
          'Failed to load screenshots:',
          error
        )
      }
    }

    loadScreenshots()

    return () => {
      objectUrls.forEach(
        (url) =>
          URL.revokeObjectURL(url)
      )
    }
  }, [])

  /* =========================================
     BACKGROUND AI EMBEDDING
     ========================================= */

  async function generateBackgroundEmbedding(
    id,
    extractedText
  ) {
    if (!extractedText?.trim()) {
      return
    }

    try {

      const embedding =
        await createEmbedding(
          extractedText
        )

      await updateScreenshot(
        id,
        { embedding }
      )

      setImages(
        (previousImages) =>
          previousImages.map(
            (image) =>
              image.id === id
                ? {
                    ...image,
                    embedding,
                  }
                : image
          )
      )

    } catch (error) {

      console.error(
        'Background AI embedding failed:',
        error
      )
    }
  }

  /* =========================================
     UPLOAD SCREENSHOTS
     ========================================= */

  async function handleImageUpload(
    event
  ) {
    const files =
      Array.from(
        event.target.files
      )

    if (files.length === 0) {
      return
    }

    setIsProcessing(true)

    try {

      for (const file of files) {

        setProcessingStatus(
          `Reading ${file.name}...`
        )

        const extractedText =
          await extractText(file)

        setProcessingStatus(
          `Saving ${file.name}...`
        )

        const id =
          await addScreenshot({
            image: file,
            createdAt:
              new Date().toISOString(),
            extractedText,
            embedding: [],
            category: 'Other',
          })

        const imageUrl =
          URL.createObjectURL(file)

        setImages(
          (previousImages) => [
            ...previousImages,
            {
              id,
              url: imageUrl,
              file,
              text: extractedText,
              embedding: [],
              category: 'Other',
            },
          ]
        )

        /*
          AI runs in the background.
        */

        generateBackgroundEmbedding(
          id,
          extractedText
        )
      }

    } catch (error) {

      console.error(
        'Failed to process screenshot:',
        error
      )

      setProcessingStatus(
        'Failed to process screenshot'
      )

    } finally {

      setIsProcessing(false)
      setProcessingStatus('')
      event.target.value = ''
    }
  }

  /* =========================================
     REPROCESS OCR
     ========================================= */

  async function handleReprocess(
    image
  ) {
    try {

      setReprocessingId(
        image.id
      )

      setProcessingStatus(
        'Improving OCR...'
      )

      const screenshots =
        await getScreenshots()

      const storedScreenshot =
        screenshots.find(
          (screenshot) =>
            screenshot.id ===
            image.id
        )

      if (!storedScreenshot) {
        throw new Error(
          'Screenshot not found'
        )
      }

      const extractedText =
        await extractText(
          storedScreenshot.image,
          true
        )

      await updateScreenshot(
        image.id,
        {
          extractedText,
          embedding: [],
        }
      )

      setImages(
        (previousImages) =>
          previousImages.map(
            (currentImage) =>
              currentImage.id ===
              image.id
                ? {
                    ...currentImage,
                    text:
                      extractedText,
                    embedding: [],
                  }
                : currentImage
          )
      )

      setProcessingStatus(
        'Updating AI understanding...'
      )

      const embedding =
        await createEmbedding(
          extractedText
        )

      await updateScreenshot(
        image.id,
        { embedding }
      )

      setImages(
        (previousImages) =>
          previousImages.map(
            (currentImage) =>
              currentImage.id ===
              image.id
                ? {
                    ...currentImage,
                    embedding,
                  }
                : currentImage
          )
      )

      setProcessingStatus(
        'OCR updated successfully'
      )

    } catch (error) {

      console.error(
        'Failed to reprocess screenshot:',
        error
      )

      setProcessingStatus(
        'Failed to update OCR'
      )

    } finally {

      setTimeout(() => {
        setReprocessingId(null)
        setProcessingStatus('')
      }, 800)
    }
  }

  /* =========================================
     SEARCH
     ========================================= */

  useEffect(() => {
    let cancelled = false

    async function performSearch() {

      const searchText =
        search.trim()

      if (!searchText) {
        setSearchResults(null)
        setIsSearching(false)
        return
      }

      /* =====================================
         KEYWORD SEARCH
         ===================================== */

      const keywordResults =
        images
          .map((image) => {

            const keywordScore =
              calculateKeywordScore(
                image.text,
                searchText
              )

            return {
              ...image,
              keywordScore,
              semanticScore: 0,
              score: keywordScore,
            }
          })
          .filter(
            (image) =>
              image.keywordScore > 0
          )
          .sort(
            (a, b) =>
              b.score - a.score
          )

      /*
        Show keyword results immediately.
      */

      if (!cancelled) {
        setSearchResults(
          keywordResults
        )
      }

      /* =====================================
         AI SEARCH
         ===================================== */

      const imagesWithEmbeddings =
        images.filter(
          (image) =>
            image.embedding &&
            image.embedding.length > 0
        )

      if (
        imagesWithEmbeddings.length === 0
      ) {
        setIsSearching(false)
        return
      }

      setIsSearching(true)

      try {

        const queryEmbedding =
          await createEmbedding(
            searchText
          )

        if (cancelled) {
          return
        }

        const hybridResults =
          images.map((image) => {

            const keywordScore =
              calculateKeywordScore(
                image.text,
                searchText
              )

            let semanticScore = 0

            if (
              image.embedding &&
              image.embedding.length > 0
            ) {
              semanticScore =
                cosineSimilarity(
                  queryEmbedding,
                  image.embedding
                )
            }

            const score =
              keywordScore * 0.4 +
              semanticScore * 0.6

            return {
              ...image,
              keywordScore,
              semanticScore,
              score,
            }
          })

        const relevantResults =
          hybridResults
            .filter((image) => {

              const hasKeywordMatch =
                image.keywordScore > 0

              const hasStrongSemanticMatch =
                image.semanticScore >=
                SEMANTIC_THRESHOLD

              return (
                hasKeywordMatch ||
                hasStrongSemanticMatch
              )
            })
            .sort(
              (a, b) =>
                b.score - a.score
            )

        if (!cancelled) {
          setSearchResults(
            relevantResults
          )
        }

      } catch (error) {

        console.error(
          'AI search failed:',
          error
        )

        if (!cancelled) {
          setSearchResults(
            keywordResults
          )
        }

      } finally {

        if (!cancelled) {
          setIsSearching(false)
        }
      }
    }

    performSearch()

    return () => {
      cancelled = true
    }

  }, [search, images])

  /* =========================================
     CHANGE CATEGORY
     ========================================= */

  async function handleCategoryChange(
    id,
    category
  ) {
    try {

      await updateScreenshot(
        id,
        { category }
      )

      setImages(
        (previousImages) =>
          previousImages.map(
            (image) =>
              image.id === id
                ? {
                    ...image,
                    category,
                  }
                : image
          )
      )

    } catch (error) {

      console.error(
        'Failed to update category:',
        error
      )
    }
  }

  /* =========================================
     DELETE
     ========================================= */

  async function handleDelete(id) {
    try {

      await deleteScreenshot(id)

      setImages(
        (previousImages) =>
          previousImages.filter(
            (image) =>
              image.id !== id
          )
      )

      setSelectedImage(
        (currentImage) =>
          currentImage?.id === id
            ? null
            : currentImage
      )

    } catch (error) {

      console.error(
        'Failed to delete screenshot:',
        error
      )
    }
  }

  /* =========================================
     RESULT ACTIONS
     ========================================= */

  function handleOpenImage(image) {
    setSelectedImage(image)
  }

  function getFileExtension(file) {
    if (file?.name) {
      const parts = file.name.split('.')
      if (parts.length > 1) return parts.pop().toLowerCase()
    }
    if (file?.type) {
      const extension = file.type.split('/')[1]
      if (extension === 'jpeg') return 'jpg'
      if (extension) return extension
    }
    return 'png'
  }

  async function handleDownload(image) {
    try {
      if (!image?.file) throw new Error('Original screenshot is unavailable')
      const extension = getFileExtension(image.file)
      const downloadUrl = URL.createObjectURL(image.file)
      const link = document.createElement('a')
      link.href = downloadUrl
      link.download = image.file.name || `screenmind-${image.id}.${extension}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000)
    } catch (error) {
      console.error('Failed to download screenshot:', error)
    }
  }

  async function handleShare(image) {
    try {
      if (!image?.file) throw new Error('Original screenshot is unavailable')
      const extension = getFileExtension(image.file)
      const fileName = image.file.name || `screenmind-${image.id}.${extension}`
      const shareFile = image.file instanceof File
        ? image.file
        : new File([image.file], fileName, { type: image.file.type || 'image/png' })

      if (navigator.share && navigator.canShare?.({ files: [shareFile] })) {
        await navigator.share({ title: 'ScreenMind Screenshot', text: 'Shared from ScreenMind', files: [shareFile] })
        return
      }

      await handleDownload(image)
    } catch (error) {
      if (error?.name === 'AbortError') return
      console.error('Share failed. Falling back to download:', error)
      await handleDownload(image)
    }
  }

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') setSelectedImage(null)
    }
    if (selectedImage) {
      document.addEventListener('keydown', handleEscape)
      document.body.style.overflow = 'hidden'
    }
    return () => {
      document.removeEventListener('keydown', handleEscape)
      document.body.style.overflow = ''
    }
  }, [selectedImage])

  /* =========================================
     FILTER
     ========================================= */

  const filteredImages =
    (
      searchResults ?? images
    ).filter((image) => {

      return (
        selectedCategory ===
          'All' ||
        image.category ===
          selectedCategory
      )
    })

  /* =========================================
     UI
     ========================================= */

  return (
    <main className="app">

      <header className="header">

        <h1>
          ScreenMind
        </h1>

        <p>
          Find anything from
          your screenshots
        </p>

      </header>

      {/* SEARCH */}

      <section className="search-section">

        <input
          type="text"
          placeholder="Search your screenshots..."
          value={search}
          onChange={(event) =>
            setSearch(
              event.target.value
            )
          }
        />

        <select
          value={
            selectedCategory
          }
          onChange={(event) =>
            setSelectedCategory(
              event.target.value
            )
          }
        >

          {categories.map(
            (category) => (
              <option
                key={category}
                value={category}
              >
                {category}
              </option>
            )
          )}

        </select>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={
            handleImageUpload
          }
          hidden
        />

        <button
          onClick={() =>
            fileInputRef.current?.click()
          }
          disabled={
            isProcessing
          }
        >
          {isProcessing
            ? processingStatus ||
              'Processing...'
            : 'Upload Screenshot'}
        </button>

      </section>

      {/* SCREENSHOTS */}

      <section className="screenshots">

        <div className="screenshots-header">

          <h2>
            {search.trim()
              ? 'Search Results'
              : 'Your Screenshots'}
          </h2>

          <span>
            {isSearching
              ? 'AI searching...'
              : `${filteredImages.length} ${
                  filteredImages.length ===
                  1
                    ? 'screenshot'
                    : 'screenshots'
                }`}
          </span>

        </div>

        {filteredImages.length ===
        0 ? (

          <p>
            {isSearching
              ? 'Searching screenshots...'
              : search.trim()
              ? 'No relevant screenshots found.'
              : 'No screenshots uploaded yet.'}
          </p>

        ) : (

          <div className="screenshot-grid">

            {filteredImages.map(
              (image) => (

                <div
                  key={image.id}
                  className="screenshot-card"
                >

                  {/* IMAGE */}

                  <img
                    src={image.url}
                    alt="Uploaded screenshot"
                    onClick={() => handleOpenImage(image)}
                    style={{ cursor: 'pointer' }}
                    title="Open screenshot"
                  />

                  {/* RELEVANCE */}

                  {searchResults &&
                    image.score !==
                      undefined && (

                    <div className="relevance-box">

                      <div className="relevance-header">

                        <span>
                          Relevance
                        </span>

                        <strong>
                          {Math.min(
                            Math.max(
                              image.score *
                                100,
                              0
                            ),
                            100
                          ).toFixed(0)}
                          %
                        </strong>

                      </div>

                      <div className="relevance-bar">

                        <div
                          className="relevance-fill"
                          style={{
                            width: `${Math.min(
                              Math.max(
                                image.score *
                                  100,
                                0
                              ),
                              100
                            )}%`,
                          }}
                        />

                      </div>

                      <div className="match-details">

                        <span>
                          Keyword:{' '}
                          {(
                            image.keywordScore *
                            100
                          ).toFixed(0)}
                          %
                        </span>

                        {image.embedding &&
                          image.embedding
                            .length >
                            0 && (

                          <span>
                            AI:{' '}
                            {(
                              image.semanticScore *
                              100
                            ).toFixed(0)}
                            %
                          </span>

                        )}

                      </div>

                    </div>

                  )}

                  {/* OCR TEXT */}

                  <div className="ocr-content">

                    <span className="ocr-label">
                      Extracted text
                    </span>

                    <p>
                      {image.text
                        ? highlightText(
                            image.text,
                            search
                          )
                        : 'No text detected'}
                    </p>

                  </div>

                  {/* CATEGORY */}

                  <div className="category-section">

                    <label>
                      Category
                    </label>

                    <select
                      value={
                        image.category
                      }
                      onChange={(event) =>
                        handleCategoryChange(
                          image.id,
                          event.target.value
                        )
                      }
                    >

                      {categories
                        .filter(
                          (category) =>
                            category !==
                            'All'
                        )
                        .map(
                          (category) => (

                            <option
                              key={
                                category
                              }
                              value={
                                category
                              }
                            >
                              {category}
                            </option>

                          )
                        )}

                    </select>

                  </div>

                  {/* RESULT ACTIONS */}

                  <div className="card-actions">
                    <button className="reprocess-button" onClick={() => handleOpenImage(image)}>Open</button>
                    <button className="reprocess-button" onClick={() => handleDownload(image)}>Download</button>
                    <button className="reprocess-button" onClick={() => handleShare(image)}>Share</button>
                  </div>

                  {/* OCR / DELETE ACTIONS */}

                  <div className="card-actions">
                    <button
                      className="reprocess-button"
                      onClick={() => handleReprocess(image)}
                      disabled={reprocessingId === image.id}
                    >
                      {reprocessingId === image.id ? 'Reprocessing...' : 'Reprocess OCR'}
                    </button>
                    <button className="delete-button" onClick={() => handleDelete(image.id)}>Delete</button>
                  </div>

                </div>

              )
            )}

          </div>

        )}

      </section>

      {selectedImage && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot preview"
          onMouseDown={() => setSelectedImage(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', background: 'rgba(0, 0, 0, 0.82)', boxSizing: 'border-box' }}
        >
          <div
            onMouseDown={(event) => event.stopPropagation()}
            style={{ width: 'min(1100px, 100%)', maxHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column', background: '#ffffff', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 24px 80px rgba(0, 0, 0, 0.35)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #e5e7eb' }}>
              <strong style={{ fontSize: '14px', color: '#111827' }}>Screenshot Preview</strong>
              <button onClick={() => setSelectedImage(null)} aria-label="Close preview" style={{ width: '34px', height: '34px', border: '1px solid #d1d5db', borderRadius: '7px', background: '#ffffff', color: '#374151', fontSize: '22px', lineHeight: 1, cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px', background: '#f3f4f6', overflow: 'auto' }}>
              <img src={selectedImage.url} alt="Full screenshot preview" style={{ display: 'block', maxWidth: '100%', maxHeight: 'calc(100vh - 180px)', width: 'auto', height: 'auto', objectFit: 'contain' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', padding: '12px 16px', borderTop: '1px solid #e5e7eb', background: '#ffffff' }}>
              <button className="reprocess-button" onClick={() => handleDownload(selectedImage)} style={{ flex: '0 0 auto' }}>Download</button>
              <button className="reprocess-button" onClick={() => handleShare(selectedImage)} style={{ flex: '0 0 auto' }}>Share</button>
            </div>
          </div>
        </div>
      )}

    </main>
  )
}

export default App;