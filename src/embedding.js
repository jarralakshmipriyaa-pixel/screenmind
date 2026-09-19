import { pipeline } from '@huggingface/transformers'

let embeddingModel = null

async function getEmbeddingModel() {
  if (!embeddingModel) {
    embeddingModel = await pipeline(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    )
  }

  return embeddingModel
}

export async function createEmbedding(text) {
  if (!text || !text.trim()) {
    return []
  }

  const model = await getEmbeddingModel()

  const output = await model(text, {
    pooling: 'mean',
    normalize: true,
  })

  return Array.from(output.data)
}