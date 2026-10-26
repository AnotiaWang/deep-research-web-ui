import { marked } from 'marked'
import { z } from 'zod'
import { researchLearningLimits } from '~~/shared/utils/research-learning'

export const reportRevisionSchema = z.object({
  instruction: z.string().trim().min(1).max(2000),
  // Bounded like a learning: it is replayed into the revision prompt and tokenized synchronously.
  targetLearning: z.string().min(1).max(researchLearningLimits.learning),
  firstNewCitation: z.number().int().positive(),
  blocks: z
    .array(
      z.object({
        id: z.number().int().nonnegative(),
        // Report blocks are whole markdown sections, so they get more room than a learning.
        markdown: z.string().min(1).max(20_000),
      }),
    )
    .min(1)
    .max(40),
})

export type ReportRevision = z.infer<typeof reportRevisionSchema>
export interface ReportBlock {
  id: number
  markdown: string
  start: number
  end: number
}

/** Top-level Markdown blocks keep tables and lists intact during a targeted edit. */
export function findCitedReportBlocks(report: string, citation: number): ReportBlock[] {
  if (!Number.isInteger(citation) || citation < 1) return []
  const reference = new RegExp(`\\[${citation}\\](?!\\()`)
  // Marked normalizes CRLF. Map its offsets back to the original imported text.
  const offsets: number[] = []
  let normalized = ''
  for (let index = 0; index < report.length; index++) {
    offsets.push(index)
    if (report[index] === '\r' && report[index + 1] === '\n') index++
    normalized += report[index]
  }
  offsets.push(report.length)
  let cursor = 0
  const blocks: ReportBlock[] = []
  for (const token of marked.lexer(normalized)) {
    const normalizedStart = normalized.indexOf(token.raw, cursor)
    if (normalizedStart < 0) throw new Error('Unable to locate report block.')
    cursor = normalizedStart + token.raw.length
    if (['code', 'html', 'space', 'def'].includes(token.type) || !reference.test(token.raw))
      continue
    const start = offsets[normalizedStart]!
    const end = offsets[cursor]!
    blocks.push({ id: start, markdown: report.slice(start, end), start, end })
  }
  return blocks
}

const patchesSchema = z.object({
  patches: z
    .array(
      z.object({
        id: z.number().int().nonnegative(),
        markdown: z.string().trim().min(1),
      }),
    )
    .min(1)
    .max(40),
})

/** Validate the whole response before changing anything; untouched bytes stay intact. */
export function applyReportRevision(
  report: string,
  blocks: ReportBlock[],
  response: unknown,
  citationCount: number,
) {
  const { patches } = patchesSchema.parse(response)
  const patchMap = new Map(patches.map((patch) => [patch.id, patch.markdown]))
  if (patchMap.size !== patches.length || patchMap.size !== blocks.length) {
    throw new Error('The revision must include each selected block exactly once.')
  }
  for (const block of blocks) {
    const replacement = patchMap.get(block.id)
    if (!replacement || report.slice(block.start, block.end) !== block.markdown) {
      throw new Error('The revision does not match the original report.')
    }
    const citations = [...replacement.matchAll(/\[(\d+)\](?!\()/g)]
    if (
      !citations.length ||
      citations.some((match) => Number(match[1]) < 1 || Number(match[1]) > citationCount)
    ) {
      throw new Error('The revised block contains missing or invalid citations.')
    }
  }
  let updated = report
  for (const block of [...blocks].sort((a, b) => b.start - a.start)) {
    const trailing = block.markdown.match(/[\r\n]*$/)?.[0] ?? ''
    let replacement = patchMap.get(block.id)!.trimEnd()
    if (block.markdown.includes('\r\n')) replacement = replacement.replace(/\r?\n/g, '\r\n')
    updated = updated.slice(0, block.start) + replacement + trailing + updated.slice(block.end)
  }
  return updated
}

export function appendReportSources(
  report: string,
  sources: Array<{ url: string; title?: string }>,
  firstIndex: number,
) {
  const escaped = (value: string) => value.replace(/[\\[\]]/g, '\\$&').replace(/[\r\n]+/g, ' ')
  const entries = sources.map((item, index) => {
    const label = escaped(item.title || item.url)
    try {
      const url = new URL(item.url)
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        return `${firstIndex + index}. [${label}](<${url.href.replace(/>/g, '%3E')}>)`
      }
    } catch {
      /* Imported legacy sources may have an invalid URL. */
    }
    return `${firstIndex + index}. ${label}`
  })
  return entries.length ? `${report.trimEnd()}\n${entries.join('\n')}` : report
}
