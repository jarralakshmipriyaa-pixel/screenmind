import { openDB } from 'idb'

const dbPromise = openDB('ScreenMindDB', 1, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('screenshots')) {
      db.createObjectStore('screenshots', {
        keyPath: 'id',
        autoIncrement: true,
      })
    }
  },
})

export async function addScreenshot(screenshot) {
  const db = await dbPromise

  return db.add('screenshots', screenshot)
}

export async function getScreenshots() {
  const db = await dbPromise

  return db.getAll('screenshots')
}

export async function updateScreenshot(id, changes) {
  const db = await dbPromise

  const screenshot = await db.get('screenshots', id)

  if (!screenshot) {
    throw new Error('Screenshot not found')
  }

  await db.put('screenshots', {
    ...screenshot,
    ...changes,
    id,
  })
}

export async function deleteScreenshot(id) {
  const db = await dbPromise

  await db.delete('screenshots', id)
}